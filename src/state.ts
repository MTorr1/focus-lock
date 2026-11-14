import { decideLockRelease, type TimeSample } from "./clock.ts";
import { parsePattern, urlMatches, type Pattern } from "./pattern.ts";
import {
  commitmentInForce,
  inDailyWindow,
  normalizeSchedule,
  scheduleIsWeaker,
  windowEndInstant,
  type Schedule,
} from "./schedule.ts";

export type List = {
  id: string;
  name: string;
  patterns: string[];
  revision: number;
  updatedAt: number;
  lockEnd: number | null;
  schedule: Schedule | null;
};

export type AppState = {
  lists: List[];
  timeSample: TimeSample | null;
};

export type Command =
  | { type: "create-list"; id: string; name: string }
  | { type: "rename-list"; id: string; name: string }
  | { type: "delete-list"; id: string }
  | { type: "add-pattern"; id: string; pattern: string }
  | { type: "remove-pattern"; id: string; pattern: string }
  | { type: "activate-lock"; id: string; end: number; confirm: boolean }
  | { type: "set-schedule"; id: string; schedule: Schedule; confirm: boolean }
  | { type: "clear-schedule"; id: string };

export type ApplyResult = { ok: true; state: AppState } | { ok: false; error: string };

export type TickResult = { state: AppState; needsServerDate: boolean };

export type BlockHit = {
  listId: string;
  listName: string;
  lockEnd: number | null;
  windowEnd: number | null;
};

export type ClockContext = {
  now: number;
  timeZone: string;
  serverDate: number | null;
};

export function emptyState(): AppState {
  return { lists: [], timeSample: null };
}

export function tick(state: AppState, now: number, serverDate: number | null): TickResult {
  const lastSeenWall = state.timeSample?.wall ?? null;
  let needsServerDate = false;
  let keepSample = false;
  const lists = state.lists.map((list) => {
    if (list.lockEnd === null) return list;
    const decision = decideLockRelease({ end: list.lockEnd, now, lastSeenWall, serverDate });
    if (decision.suspiciousJump && now >= list.lockEnd && serverDate === null) needsServerDate = true;
    if (decision.suspiciousJump && !decision.release) keepSample = true;
    if (!decision.release) return list;
    return { ...list, lockEnd: null, revision: list.revision + 1, updatedAt: now };
  });
  const wall = keepSample && state.timeSample ? state.timeSample.wall : now;
  return { state: { lists, timeSample: { wall } }, needsServerDate };
}

export function apply(state: AppState, command: Command, ctx: ClockContext): ApplyResult {
  switch (command.type) {
    case "create-list":
      return createList(state, command, ctx);
    case "rename-list":
      return renameList(state, command, ctx);
    case "delete-list":
      return deleteList(state, command, ctx);
    case "add-pattern":
      return addPattern(state, command, ctx);
    case "remove-pattern":
      return removePattern(state, command, ctx);
    case "activate-lock":
      return activateLock(state, command, ctx);
    case "set-schedule":
      return setSchedule(state, command, ctx);
    case "clear-schedule":
      return clearSchedule(state, command, ctx);
  }
}

export function blockHits(url: string, state: AppState, ctx: ClockContext): BlockHit[] {
  const hits: BlockHit[] = [];
  for (const list of state.lists) {
    if (!isBlocking(list, state, ctx)) continue;
    const parsed = list.patterns.flatMap((raw) => {
      const pattern = parsePattern(raw);
      return pattern ? [pattern] : [];
    });
    if (!parsed.some((pattern) => urlMatches(url, pattern))) continue;
    hits.push({
      listId: list.id,
      listName: list.name,
      lockEnd: lockIsActive(list, state, ctx) ? list.lockEnd : null,
      windowEnd:
        list.schedule &&
        commitmentInForce(new Date(ctx.now), ctx.timeZone, list.schedule) &&
        inDailyWindow(new Date(ctx.now), ctx.timeZone, list.schedule)
          ? windowEndInstant(new Date(ctx.now), ctx.timeZone, list.schedule)
          : null,
    });
  }
  return hits;
}

export function lastRestrictionEnd(hits: BlockHit[]): number | null {
  const ends = hits.flatMap((hit) => [hit.lockEnd, hit.windowEnd].filter((value): value is number => value !== null));
  if (ends.length === 0) return null;
  return Math.max(...ends);
}

export function enforcedPatterns(state: AppState, ctx: ClockContext): Pattern[] {
  const patterns: Pattern[] = [];
  for (const list of state.lists) {
    if (!isBlocking(list, state, ctx)) continue;
    for (const raw of list.patterns) {
      const pattern = parsePattern(raw);
      if (pattern) patterns.push(pattern);
    }
  }
  return patterns;
}

export function isBlocking(list: List, state: AppState, ctx: ClockContext): boolean {
  if (lockIsActive(list, state, ctx)) return true;
  if (!list.schedule) return false;
  const now = new Date(ctx.now);
  return commitmentInForce(now, ctx.timeZone, list.schedule) && inDailyWindow(now, ctx.timeZone, list.schedule);
}

export function lockIsActive(list: List, state: AppState, ctx: ClockContext): boolean {
  if (list.lockEnd === null) return false;
  return !decideLockRelease({
    end: list.lockEnd,
    now: ctx.now,
    lastSeenWall: state.timeSample?.wall ?? null,
    serverDate: ctx.serverDate,
  }).release;
}

export function scheduleCommitted(list: List, ctx: ClockContext): boolean {
  if (!list.schedule) return false;
  return commitmentInForce(new Date(ctx.now), ctx.timeZone, list.schedule);
}

function createList(state: AppState, command: Extract<Command, { type: "create-list" }>, ctx: ClockContext): ApplyResult {
  const name = command.name.trim();
  if (!name || name.length > 80) return fail("Give the list a name of 1 to 80 characters.");
  if (state.lists.some((list) => list.id === command.id)) return fail("That list already exists.");
  const list: List = {
    id: command.id,
    name,
    patterns: [],
    revision: 1,
    updatedAt: ctx.now,
    lockEnd: null,
    schedule: null,
  };
  return ok({ ...state, lists: [...state.lists, list] });
}

function renameList(state: AppState, command: Extract<Command, { type: "rename-list" }>, ctx: ClockContext): ApplyResult {
  const name = command.name.trim();
  if (!name || name.length > 80) return fail("Give the list a name of 1 to 80 characters.");
  return updateList(state, command.id, ctx, (list) => ({ ...list, name }));
}

function deleteList(state: AppState, command: Extract<Command, { type: "delete-list" }>, ctx: ClockContext): ApplyResult {
  const list = findList(state, command.id);
  if (!list) return fail("That list no longer exists.");
  if (protectedList(list, state, ctx)) return fail("This list is locked until its commitment ends.");
  return ok({ ...state, lists: state.lists.filter((item) => item.id !== command.id) });
}

function addPattern(state: AppState, command: Extract<Command, { type: "add-pattern" }>, ctx: ClockContext): ApplyResult {
  if (!parsePattern(command.pattern)) return fail("That entry is not a site, a section ending in /*, or a page URL.");
  return updateList(state, command.id, ctx, (list) => {
    if (list.patterns.includes(command.pattern.trim())) return fail("That entry is already on the list.");
    if (list.patterns.length >= 100) return fail("A list can hold 100 entries.");
    return { ...list, patterns: [...list.patterns, command.pattern.trim()] };
  });
}

function removePattern(
  state: AppState,
  command: Extract<Command, { type: "remove-pattern" }>,
  ctx: ClockContext,
): ApplyResult {
  return updateList(state, command.id, ctx, (list) => {
    if (protectedList(list, state, ctx)) return fail("You cannot remove a URL while this list is locked or committed.");
    if (!list.patterns.includes(command.pattern)) return fail("That entry is not on the list.");
    return { ...list, patterns: list.patterns.filter((pattern) => pattern !== command.pattern) };
  });
}

function activateLock(
  state: AppState,
  command: Extract<Command, { type: "activate-lock" }>,
  ctx: ClockContext,
): ApplyResult {
  if (!command.confirm) return fail("Confirm that you are committing until the end time.");
  if (!Number.isFinite(command.end) || command.end <= ctx.now) return fail("Choose an end time in the future.");
  return updateList(state, command.id, ctx, (list) => {
    if (list.patterns.length === 0) return fail("Add at least one URL before locking the list.");
    if (lockIsActive(list, state, ctx) && list.lockEnd !== null && command.end < list.lockEnd) {
      return fail("You cannot shorten a lock that is already active.");
    }
    return { ...list, lockEnd: command.end };
  });
}

function setSchedule(
  state: AppState,
  command: Extract<Command, { type: "set-schedule" }>,
  ctx: ClockContext,
): ApplyResult {
  if (!command.confirm) return fail("Confirm that you are committing to this schedule until its end date.");
  const schedule = normalizeSchedule(command.schedule);
  if (!schedule) return fail("Choose at least one day, a start time before the end time, and an end date.");
  if (schedule.commitmentDate < localDate(ctx)) return fail("The commitment end date cannot be in the past.");
  return updateList(state, command.id, ctx, (list) => {
    if (list.patterns.length === 0) return fail("Add at least one URL before committing to a schedule.");
    if (list.schedule && scheduleCommitted(list, ctx) && scheduleIsWeaker(schedule, list.schedule)) {
      return fail("You cannot weaken a schedule until its commitment end date.");
    }
    return { ...list, schedule };
  });
}

function clearSchedule(
  state: AppState,
  command: Extract<Command, { type: "clear-schedule" }>,
  ctx: ClockContext,
): ApplyResult {
  return updateList(state, command.id, ctx, (list) => {
    if (!list.schedule) return fail("This list has no schedule.");
    if (scheduleCommitted(list, ctx)) return fail("You cannot turn off a schedule until its commitment end date.");
    return { ...list, schedule: null };
  });
}

function protectedList(list: List, state: AppState, ctx: ClockContext): boolean {
  return lockIsActive(list, state, ctx) || scheduleCommitted(list, ctx);
}

function updateList(
  state: AppState,
  id: string,
  ctx: ClockContext,
  change: (list: List) => List | ApplyResult,
): ApplyResult {
  const list = findList(state, id);
  if (!list) return fail("That list no longer exists.");
  const changed = change(list);
  if ("ok" in changed) return changed;
  const next: List = { ...changed, revision: list.revision + 1, updatedAt: ctx.now };
  return ok({ ...state, lists: state.lists.map((item) => (item.id === id ? next : item)) });
}

function findList(state: AppState, id: string): List | undefined {
  return state.lists.find((list) => list.id === id);
}

function localDate(ctx: ClockContext): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ctx.now));
}

function ok(state: AppState): ApplyResult {
  return { ok: true, state };
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}
