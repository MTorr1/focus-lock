import { commitmentInForce, scheduleIsWeaker, type Schedule } from "./schedule.ts";
import type { List } from "./state.ts";

export type SyncPlan = { merged: List[]; push: List[] };

export function planSync(local: List[], remote: List[], now: number, timeZone: string): SyncPlan {
  const remoteById = new Map(remote.map((list) => [list.id, list]));
  const merged: List[] = [];
  const push: List[] = [];

  for (const item of local) {
    const other = remoteById.get(item.id);
    remoteById.delete(item.id);
    if (!other) {
      merged.push(item);
      push.push(item);
      continue;
    }
    const pair = mergePair(item, other, now, timeZone);
    merged.push(pair.list);
    if (pair.push) push.push(pair.list);
  }

  for (const item of remoteById.values()) merged.push(item);
  return { merged, push };
}

export function integrateRemote(local: List[], remote: List[] | null, now: number, timeZone: string): SyncPlan & { keptLocal: boolean } {
  if (remote === null) return { merged: local, push: [], keptLocal: true };
  return { ...planSync(local, remote, now, timeZone), keptLocal: false };
}

export function clearSession<T extends { session: unknown }>(data: T): T {
  return { ...data, session: null };
}

function mergePair(local: List, remote: List, now: number, timeZone: string): { list: List; push: boolean } {
  if (remote.revision < local.revision) return { list: local, push: true };
  if (remote.revision === local.revision) {
    return sameBody(local, remote) ? { list: local, push: false } : { list: local, push: true };
  }
  if (!remoteWeakensActive(local, remote, now, timeZone)) return { list: remote, push: false };
  return {
    list: {
      ...stricter(local, remote),
      revision: remote.revision + 1,
      updatedAt: Math.max(local.updatedAt, remote.updatedAt, now),
    },
    push: true,
  };
}

function remoteWeakensActive(local: List, remote: List, now: number, timeZone: string): boolean {
  const lockActive = local.lockEnd !== null && local.lockEnd > now;
  if (lockActive && (remote.lockEnd === null || (local.lockEnd !== null && remote.lockEnd < local.lockEnd))) return true;
  if (lockActive && missingPattern(local.patterns, remote.patterns)) return true;
  if (local.schedule && commitmentInForce(new Date(now), timeZone, local.schedule)) {
    if (scheduleIsWeaker(remote.schedule, local.schedule)) return true;
    if (missingPattern(local.patterns, remote.patterns)) return true;
  }
  return false;
}

function stricter(local: List, remote: List): List {
  const lockEnd = laterLock(local.lockEnd, remote.lockEnd);
  const schedule = stricterSchedule(local.schedule, remote.schedule);
  return {
    ...remote,
    id: local.id,
    patterns: [...new Set([...local.patterns, ...remote.patterns])],
    lockEnd,
    schedule,
  };
}

function laterLock(local: number | null, remote: number | null): number | null {
  if (local === null) return remote;
  if (remote === null) return local;
  return Math.max(local, remote);
}

function stricterSchedule(local: Schedule | null, remote: Schedule | null): Schedule | null {
  if (!local) return remote;
  if (!remote || scheduleIsWeaker(remote, local)) return local;
  return remote;
}

function missingPattern(left: string[], right: string[]): boolean {
  return left.some((pattern) => !right.includes(pattern));
}

function sameBody(left: List, right: List): boolean {
  return (
    left.name === right.name &&
    left.lockEnd === right.lockEnd &&
    samePatterns(left.patterns, right.patterns) &&
    JSON.stringify(left.schedule) === JSON.stringify(right.schedule)
  );
}

function samePatterns(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const other = new Set(right);
  return left.every((pattern) => other.has(pattern));
}
