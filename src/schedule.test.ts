import assert from "node:assert/strict";
import test from "node:test";
import { inDailyWindow, localParts, type Schedule } from "./schedule.ts";
import { apply, blockHits, lastRestrictionEnd, type AppState, type ClockContext, type List } from "./state.ts";

test("london and new york windows follow local clock time across daylight saving", () => {
  const window: Schedule = { days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "17:00", commitmentDate: "2026-12-31" };
  assert.equal(inDailyWindow(new Date("2026-03-29T00:30:00.000Z"), "Europe/London", window), false);
  assert.equal(localParts(new Date("2026-03-29T01:30:00.000Z"), "Europe/London").minutes, 2 * 60 + 30);
  assert.equal(inDailyWindow(new Date("2026-03-29T09:30:00.000Z"), "Europe/London", window), true);
  assert.equal(inDailyWindow(new Date("2026-03-29T17:00:00.000Z"), "Europe/London", window), false);

  const early: Schedule = { days: [0, 1, 2, 3, 4, 5, 6], start: "01:00", end: "02:00", commitmentDate: "2026-12-31" };
  assert.equal(inDailyWindow(new Date("2026-10-25T00:30:00.000Z"), "Europe/London", early), true);
  assert.equal(inDailyWindow(new Date("2026-10-25T01:30:00.000Z"), "Europe/London", early), true);
  assert.equal(inDailyWindow(new Date("2026-10-25T12:00:00.000Z"), "Europe/London", early), false);
  assert.equal(inDailyWindow(new Date("2026-10-25T12:00:00.000Z"), "Europe/London", window), true);

  assert.equal(localParts(new Date("2026-03-08T07:30:00.000Z"), "America/New_York").minutes, 3 * 60 + 30);
  assert.equal(inDailyWindow(new Date("2026-03-08T14:00:00.000Z"), "America/New_York", window), true);
  assert.equal(inDailyWindow(new Date("2026-03-08T21:30:00.000Z"), "America/New_York", window), false);
  assert.equal(inDailyWindow(new Date("2026-11-01T05:30:00.000Z"), "America/New_York", early), true);
  assert.equal(inDailyWindow(new Date("2026-11-01T06:30:00.000Z"), "America/New_York", early), true);
  assert.equal(inDailyWindow(new Date("2026-11-01T15:00:00.000Z"), "America/New_York", window), true);
});

test("a committed schedule cannot be weakened between blocking sessions", () => {
  const now = Date.parse("2026-11-16T22:00:00.000Z");
  const ctx: ClockContext = { now, timeZone: "Europe/London", serverDate: null };
  const state = committed(now);
  assert.equal(inDailyWindow(new Date(now), ctx.timeZone, state.lists[0].schedule!), false);
  assert.equal(apply(state, { type: "clear-schedule", id: "list" }, ctx).ok, false);
  assert.equal(apply(state, { type: "delete-list", id: "list" }, ctx).ok, false);
  assert.equal(apply(state, { type: "remove-pattern", id: "list", pattern: "example.com" }, ctx).ok, false);
  const weaker = apply(state, {
    type: "set-schedule",
    id: "list",
    confirm: true,
    schedule: { days: [1], start: "10:00", end: "17:00", commitmentDate: "2026-11-20" },
  }, ctx);
  assert.equal(weaker.ok, false);
  const stronger = apply(state, {
    type: "set-schedule",
    id: "list",
    confirm: true,
    schedule: { days: [1, 2], start: "09:00", end: "18:00", commitmentDate: "2026-11-21" },
  }, ctx);
  assert.equal(stronger.ok, true);

  const after = Date.parse("2026-11-21T12:00:00.000Z");
  const later: ClockContext = { now: after, timeZone: "Europe/London", serverDate: null };
  assert.equal(apply(state, { type: "clear-schedule", id: "list" }, later).ok, true);
});

test("overlapping lists stay blocked until the last matching end", () => {
  const now = Date.parse("2026-11-16T12:00:00.000Z");
  const ctx: ClockContext = { now, timeZone: "Europe/London", serverDate: null };
  const firstEnd = now + 60_000;
  const secondEnd = now + 120_000;
  const state: AppState = {
    timeSample: { wall: now },
    lists: [
      lockedList("one", "Social", firstEnd, ["www.youtube.com/shorts/*"]),
      lockedList("two", "Video", secondEnd, ["*.youtube.com/shorts/*"]),
      lockedList("three", "News", secondEnd, ["example.com"]),
    ],
  };
  const hits = blockHits("https://www.youtube.com/shorts/abc", state, ctx);
  assert.deepEqual(hits.map((hit) => hit.listName).sort(), ["Social", "Video"]);
  assert.equal(lastRestrictionEnd(hits), secondEnd);
  assert.equal(blockHits("https://www.youtube.com/watch?v=1", state, ctx).length, 0);
  assert.equal(blockHits("https://example.com/story", state, ctx)[0]?.listName, "News");
});

function committed(now: number): AppState {
  const ctx: ClockContext = { now, timeZone: "Europe/London", serverDate: null };
  let result = apply({ lists: [], timeSample: null }, { type: "create-list", id: "list", name: "Work" }, ctx);
  if (!result.ok) throw new Error(result.error);
  result = apply(result.state, { type: "add-pattern", id: "list", pattern: "example.com" }, ctx);
  if (!result.ok) throw new Error(result.error);
  result = apply(result.state, {
    type: "set-schedule",
    id: "list",
    confirm: true,
    schedule: { days: [1], start: "09:00", end: "17:00", commitmentDate: "2026-11-20" },
  }, ctx);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function lockedList(id: string, name: string, lockEnd: number, patterns: string[]): List {
  return { id, name, patterns, revision: 1, updatedAt: lockEnd, lockEnd, schedule: null };
}
