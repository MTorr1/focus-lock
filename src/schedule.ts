export type Schedule = {
  days: number[];
  start: string;
  end: string;
  commitmentDate: string;
};

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  date: string;
  minutes: number;
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(now: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map = new Map(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  let hour = Number(map.get("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(map.get("minute"));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  const weekday = WEEKDAYS.indexOf(map.get("weekday") ?? "");
  const date = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  return { year, month, day, date, minutes: hour * 60 + minute, weekday };
}

export function normalizeSchedule(input: Schedule): Schedule | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.commitmentDate)) return null;
  const start = normalizeHm(input.start);
  const end = normalizeHm(input.end);
  if (!start || !end || hmToMinutes(end) <= hmToMinutes(start)) return null;
  const days = [...new Set(input.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort(
    (a, b) => a - b,
  );
  if (days.length === 0) return null;
  return { days, start, end, commitmentDate: input.commitmentDate };
}

export function commitmentInForce(now: Date, timeZone: string, schedule: Schedule): boolean {
  return localParts(now, timeZone).date <= schedule.commitmentDate;
}

export function inDailyWindow(now: Date, timeZone: string, schedule: Schedule): boolean {
  const parts = localParts(now, timeZone);
  if (!schedule.days.includes(parts.weekday)) return false;
  const start = hmToMinutes(schedule.start);
  const end = hmToMinutes(schedule.end);
  return parts.minutes >= start && parts.minutes < end;
}

export function scheduleIsWeaker(next: Schedule | null, prev: Schedule): boolean {
  if (!next) return true;
  if (next.commitmentDate < prev.commitmentDate) return true;
  if (next.start > prev.start || next.end < prev.end) return true;
  if (prev.days.some((day) => !next.days.includes(day))) return true;
  return false;
}

/** UTC instant of the local midnight after commitmentDate. The commitment holds through that date. */
export function commitmentDeadline(commitmentDate: string, timeZone: string): number {
  return zonedTimeToUtc(nextCalendarDate(commitmentDate), "00:00", timeZone);
}

export function zonedTimeToUtc(date: string, hm: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = hm.split(":").map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localParts(new Date(utc), timeZone);
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, Math.floor(parts.minutes / 60), parts.minutes % 60);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    const delta = want - got;
    utc += delta;
    if (delta === 0) break;
  }
  return utc;
}

export function windowEndInstant(now: Date, timeZone: string, schedule: Schedule): number {
  return zonedTimeToUtc(localParts(now, timeZone).date, schedule.end, timeZone);
}

function nextCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function normalizeHm(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour, 2)}:${pad(minute, 2)}`;
}

function hmToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
