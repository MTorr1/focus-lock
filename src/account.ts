import { commitmentDeadline, type Schedule } from "./schedule.ts";
import type { List } from "./state.ts";

export type Session = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresAt: number;
};

export type SupabaseConfig = { url: string; anonKey: string };

export type AccountResult<T> = { ok: true; value: T } | { ok: false; error: string };

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
};

export async function signInWithPassword(
  config: SupabaseConfig,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountResult<Session>> {
  return requestSession(config, "/auth/v1/token?grant_type=password", { email, password }, email, fetchImpl);
}

export async function signUpWithPassword(
  config: SupabaseConfig,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountResult<Session>> {
  return requestSession(config, "/auth/v1/signup", { email, password }, email, fetchImpl);
}

export async function refreshSession(
  config: SupabaseConfig,
  session: Session,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountResult<Session>> {
  return requestSession(
    config,
    "/auth/v1/token?grant_type=refresh_token",
    { refresh_token: session.refreshToken },
    session.email,
    fetchImpl,
  );
}

export async function pullLists(
  config: SupabaseConfig,
  session: Session,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountResult<List[]>> {
  try {
    const response = await fetchImpl(`${trimUrl(config.url)}/rest/v1/lists?select=*`, {
      headers: authHeaders(config, session),
    });
    if (!response.ok) return { ok: false, error: await errorText(response) };
    const rows = (await response.json()) as RemoteRow[];
    return { ok: true, value: rows.map(rowToList) };
  } catch {
    return { ok: false, error: "Could not reach the account service. Local lists were kept." };
  }
}

export async function pushList(
  config: SupabaseConfig,
  session: Session,
  list: List,
  timeZone: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountResult<true>> {
  try {
    const response = await fetchImpl(`${trimUrl(config.url)}/rest/v1/lists?on_conflict=id`, {
      method: "POST",
      headers: {
        ...authHeaders(config, session),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(listToRow(list, session.userId, timeZone)),
    });
    if (!response.ok) return { ok: false, error: await errorText(response) };
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: "Could not reach the account service. Local lists were kept." };
  }
}

export function listToRow(list: List, userId: string, timeZone: string): RemoteRow {
  return {
    id: list.id,
    user_id: userId,
    name: list.name,
    patterns: list.patterns,
    lock_end: list.lockEnd === null ? null : new Date(list.lockEnd).toISOString(),
    schedule: list.schedule ? scheduleToJson(list.schedule, timeZone) : null,
    revision: list.revision,
    updated_at: new Date(list.updatedAt).toISOString(),
  };
}

export function rowToList(row: RemoteRow): List {
  return {
    id: row.id,
    name: row.name,
    patterns: row.patterns,
    revision: row.revision,
    updatedAt: Date.parse(row.updated_at),
    lockEnd: row.lock_end === null ? null : Date.parse(row.lock_end),
    schedule: row.schedule ? scheduleFromJson(row.schedule) : null,
  };
}

type RemoteSchedule = Schedule & { commitmentEnd: string };

type RemoteRow = {
  id: string;
  user_id: string;
  name: string;
  patterns: string[];
  lock_end: string | null;
  schedule: RemoteSchedule | null;
  revision: number;
  updated_at: string;
};

function scheduleToJson(schedule: Schedule, timeZone: string): RemoteSchedule {
  return { ...schedule, commitmentEnd: new Date(commitmentDeadline(schedule.commitmentDate, timeZone)).toISOString() };
}

function scheduleFromJson(schedule: RemoteSchedule): Schedule {
  return {
    days: schedule.days,
    start: schedule.start,
    end: schedule.end,
    commitmentDate: schedule.commitmentDate,
  };
}

async function requestSession(
  config: SupabaseConfig,
  path: string,
  body: Record<string, string>,
  email: string,
  fetchImpl: typeof fetch,
): Promise<AccountResult<Session>> {
  try {
    const response = await fetchImpl(`${trimUrl(config.url)}${path}`, {
      method: "POST",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, error: await errorText(response) };
    const token = (await response.json()) as TokenResponse;
    if (!token.access_token || !token.user?.id) {
      return { ok: false, error: "The account service did not return a session. Check the email confirmation settings." };
    }
    return {
      ok: true,
      value: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        userId: token.user.id,
        email: token.user.email ?? email,
        expiresAt: Date.now() + token.expires_in * 1000,
      },
    };
  } catch {
    return { ok: false, error: "Could not reach the account service." };
  }
}

function authHeaders(config: SupabaseConfig, session: Session): Record<string, string> {
  return { apikey: config.anonKey, authorization: `Bearer ${session.accessToken}` };
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { msg?: string; message?: string; error_description?: string };
    return body.msg || body.message || body.error_description || `Account request failed (${response.status}).`;
  } catch {
    return text || `Account request failed (${response.status}).`;
  }
}

function trimUrl(url: string): string {
  return url.replace(/\/$/, "");
}
