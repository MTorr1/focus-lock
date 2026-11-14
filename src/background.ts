import { pullLists, pushList, refreshSession, signInWithPassword, signUpWithPassword, type Session, type SupabaseConfig } from "./account.ts";
import { fetchServerDate, trustedNow } from "./clock.ts";
import { clearSession, integrateRemote } from "./merge.ts";
import { buildDynamicRules } from "./rules.ts";
import { commitmentInForce, inDailyWindow, windowEndInstant } from "./schedule.ts";
import {
  apply,
  blockHits,
  emptyState,
  enforcedPatterns,
  isBlocking,
  lastRestrictionEnd,
  lockIsActive,
  scheduleCommitted,
  tick,
  type AppState,
  type ClockContext,
  type Command,
  type List,
} from "./state.ts";

type Persisted = {
  state: AppState;
  session: Session | null;
  supabase: SupabaseConfig | null;
  lastSyncError: string | null;
};

const STORAGE_KEY = "focusLock";
const recentBlocks = new Map<number, string>();
let cache: Persisted | null = null;
let cachedAt = 0;

chrome.runtime.onInstalled.addListener(() => void current(true));
chrome.runtime.onStartup.addListener(() => void current(true));
chrome.alarms.onAlarm.addListener(() => void current(true));
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  remember(details.tabId, details.url);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void redirectIfBlocked(details.tabId, details.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void redirectIfBlocked(details.tabId, details.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message as Record<string, unknown>, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "The extension hit an unexpected error.";
      sendResponse({ ok: false, error: text });
    });
  return true;
});

async function handleMessage(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  if (message.type === "check-url" && typeof message.url === "string") {
    const data = await current(false);
    const hits = blockHits(message.url, data.state, context(data));
    if (hits.length > 0 && sender.tab?.id !== undefined) remember(sender.tab.id, message.url);
    return { blocked: hits.length > 0 };
  }

  if (message.type === "block-info") {
    const data = await current(false);
    const url = await blockedUrl(message.url, sender);
    if (!url) return { ok: true, blocked: false, url: null, hits: [], until: null };
    const hits = blockHits(url, data.state, context(data));
    return { ok: true, blocked: hits.length > 0, url, hits, until: lastRestrictionEnd(hits) };
  }

  if (message.type === "get-state") {
    const data = await current(false);
    return { ok: true, ...view(data) };
  }

  if (message.type === "command") {
    let data = await current(false);
    const result = apply(data.state, message.command as Command, context(data));
    if (!result.ok) return result;
    data = await syncCloud({ ...data, state: result.state, lastSyncError: null }, context(data));
    await persist(data);
    await syncRules(data);
    return { ok: true, ...view(data) };
  }

  if (message.type === "save-supabase") {
    const url = typeof message.url === "string" ? message.url.trim() : "";
    const anonKey = typeof message.anonKey === "string" ? message.anonKey.trim() : "";
    if (!url || !anonKey) return { ok: false, error: "Enter the Supabase URL and anon key." };
    const data = await current(false);
    const next = { ...data, supabase: { url, anonKey } };
    await persist(next);
    return { ok: true, ...view(next) };
  }

  if (message.type === "sign-in" || message.type === "sign-up") {
    const data = await current(false);
    if (!data.supabase) return { ok: false, error: "Save the Supabase URL and anon key first." };
    const email = String(message.email ?? "");
    const password = String(message.password ?? "");
    const result =
      message.type === "sign-in"
        ? await signInWithPassword(data.supabase, email, password)
        : await signUpWithPassword(data.supabase, email, password);
    if (!result.ok) return result;
    const next = await syncCloud({ ...data, session: result.value, lastSyncError: null }, context(data));
    await persist(next);
    return { ok: true, ...view(next) };
  }

  if (message.type === "sign-out") {
    const data = clearSession(await current(false));
    await persist(data);
    return { ok: true, ...view(data) };
  }

  return { ok: false, error: "Unknown request." };
}

async function current(force: boolean): Promise<Persisted> {
  if (!force && cache && Date.now() - cachedAt < 15_000) return cache;
  await chrome.alarms.create("tick", { periodInMinutes: 1 });
  const refreshed = await refresh(await load());
  const synced = force ? await syncCloud(refreshed, context(refreshed)) : refreshed;
  await persist(synced);
  await syncRules(synced);
  return synced;
}

async function refresh(data: Persisted): Promise<Persisted> {
  let stepped = tick(data.state, Date.now(), null);
  if (stepped.needsServerDate) stepped = tick(stepped.state, Date.now(), await fetchServerDate());
  return { ...data, state: stepped.state };
}

function context(data: Persisted): ClockContext {
  return { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, serverDate: null };
}

async function syncCloud(data: Persisted, ctx: ClockContext): Promise<Persisted> {
  if (!data.session || !data.supabase) return data;
  let session = data.session;
  if (session.expiresAt < Date.now() + 60_000) {
    const refreshed = await refreshSession(data.supabase, session);
    if (!refreshed.ok) return { ...data, lastSyncError: refreshed.error };
    session = refreshed.value;
  }
  const pulled = await pullLists(data.supabase, session);
  if (!pulled.ok) return { ...data, session, lastSyncError: pulled.error };
  const now = trustedNow(ctx.now, data.state.timeSample?.wall ?? null, ctx.serverDate);
  const plan = integrateRemote(data.state.lists, pulled.value, now, ctx.timeZone);
  let lastSyncError: string | null = null;
  for (const list of plan.push) {
    const pushed = await pushList(data.supabase, session, list, ctx.timeZone);
    if (!pushed.ok) lastSyncError = pushed.error;
  }
  return { ...data, session, lastSyncError, state: { ...data.state, lists: plan.merged } };
}

async function syncRules(data: Persisted): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const next = buildDynamicRules(enforcedPatterns(data.state, context(data)));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: next,
  });
}

async function redirectIfBlocked(tabId: number, url: string): Promise<void> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  const data = await current(false);
  const hits = blockHits(url, data.state, context(data));
  if (hits.length === 0) return;
  remember(tabId, url);
  await chrome.tabs.update(tabId, { url: `${chrome.runtime.getURL("blocked.html")}?url=${encodeURIComponent(url)}` });
}

function remember(tabId: number, url: string): void {
  recentBlocks.set(tabId, url);
  void chrome.storage.session.set({ [`tab:${tabId}`]: url });
}

async function blockedUrl(candidate: unknown, sender: chrome.runtime.MessageSender): Promise<string | null> {
  if (typeof candidate === "string" && candidate) return candidate;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return null;
  const remembered = recentBlocks.get(tabId);
  if (remembered) return remembered;
  const stored = await chrome.storage.session.get(`tab:${tabId}`);
  const value = stored[`tab:${tabId}`];
  return typeof value === "string" ? value : null;
}

function view(data: Persisted) {
  const ctx = context(data);
  return {
    supabaseUrl: data.supabase?.url ?? "",
    supabaseConfigured: data.supabase !== null,
    email: data.session?.email ?? null,
    lastSyncError: data.lastSyncError,
    lists: data.state.lists.map((list) => describeList(list, data.state, ctx)),
  };
}

function describeList(list: List, state: AppState, ctx: ClockContext) {
  const inWindow =
    list.schedule !== null &&
    commitmentInForce(new Date(ctx.now), ctx.timeZone, list.schedule) &&
    inDailyWindow(new Date(ctx.now), ctx.timeZone, list.schedule);
  return {
    ...list,
    lockActive: lockIsActive(list, state, ctx),
    scheduleCommitted: scheduleCommitted(list, ctx),
    blocking: isBlocking(list, state, ctx),
    countdownMs: lockIsActive(list, state, ctx) && list.lockEnd !== null ? Math.max(0, list.lockEnd - ctx.now) : null,
    windowEnd: inWindow && list.schedule ? windowEndInstant(new Date(ctx.now), ctx.timeZone, list.schedule) : null,
  };
}

async function load(): Promise<Persisted> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Persisted | undefined;
  if (!value?.state) return { state: emptyState(), session: null, supabase: null, lastSyncError: null };
  return { ...value, lastSyncError: value.lastSyncError ?? null };
}

async function persist(data: Persisted): Promise<void> {
  cache = data;
  cachedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

void current(true).catch((error: unknown) => {
  console.error(error);
});
