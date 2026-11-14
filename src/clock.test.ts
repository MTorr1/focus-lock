import assert from "node:assert/strict";
import test from "node:test";
import { decideLockRelease, fetchServerDate, SUSPICIOUS_JUMP_MS, trustedNow } from "./clock.ts";
import { apply, emptyState, tick, type AppState, type ClockContext } from "./state.ts";

const END = 1_000_000;
const zone = "Europe/London";

test("a backward jump keeps the lock and does not move its end", () => {
  const state = locked(END, END - 60_000);
  const now = END - 5 * 60_000;
  const decision = decideLockRelease({ end: END, now, lastSeenWall: state.timeSample?.wall ?? null, serverDate: null });
  assert.equal(decision.backwardJump, true);
  assert.equal(decision.release, false);
  const stepped = tick(state, now, null);
  assert.equal(stepped.state.lists[0].lockEnd, END);
});

test("smooth offline time past the end releases the lock", () => {
  const state = locked(END, END - 60_000);
  const stepped = tick(state, END + 30_000, null);
  assert.equal(stepped.needsServerDate, false);
  assert.equal(stepped.state.lists[0].lockEnd, null);
});

test("a large forward jump does not release the lock until a server date agrees", () => {
  const state = locked(END, END - 60_000);
  const now = END + SUSPICIOUS_JUMP_MS + 60_000;
  const offline = tick(state, now, null);
  assert.equal(offline.needsServerDate, true);
  assert.equal(offline.state.lists[0].lockEnd, END);
  const tooSoon = tick(state, now, END - 1);
  assert.equal(tooSoon.state.lists[0].lockEnd, END);
  const confirmed = tick(state, now, END + 1);
  assert.equal(confirmed.state.lists[0].lockEnd, null);
});

test("an active lock rejects removal, deletion, and a shorter end", () => {
  const ctx: ClockContext = { now: END - 60_000, timeZone: zone, serverDate: null };
  let state = locked(END, ctx.now);
  assert.equal(apply(state, { type: "remove-pattern", id: "list", pattern: "youtube.com/shorts/*" }, ctx).ok, false);
  assert.equal(apply(state, { type: "delete-list", id: "list" }, ctx).ok, false);
  const shorter = apply(state, { type: "activate-lock", id: "list", end: ctx.now + 1000, confirm: true }, ctx);
  assert.equal(shorter.ok, false);
  const added = apply(state, { type: "add-pattern", id: "list", pattern: "example.com" }, ctx);
  assert.equal(added.ok, true);
  if (added.ok) state = added.state;
  assert.equal(state.lists[0].lockEnd, END);
  assert.ok(state.lists[0].patterns.includes("example.com"));
});

test("a lock cannot start without confirmation or a future end", () => {
  const now = 5_000;
  const ctx: ClockContext = { now, timeZone: zone, serverDate: null };
  const state = withPattern(now);
  assert.equal(apply(state, { type: "activate-lock", id: "list", end: now + 10_000, confirm: false }, ctx).ok, false);
  assert.equal(apply(state, { type: "activate-lock", id: "list", end: now - 1, confirm: true }, ctx).ok, false);
});

test("trusted time ignores a suspicious jump when no server date is available", () => {
  assert.equal(trustedNow(10_000, 0, null), 10_000);
  assert.equal(trustedNow(SUSPICIOUS_JUMP_MS + 5_000, 0, null), 0);
  assert.equal(trustedNow(SUSPICIOUS_JUMP_MS + 5_000, 0, 123), 123);
});

test("a missing date header or a network failure leaves the clock unconfirmed", async () => {
  const missing = await fetchServerDate(async () => new Response(null, { status: 204 }));
  assert.equal(missing, null);
  const found = await fetchServerDate(async () => new Response(null, { headers: { date: "Fri, 13 Nov 2026 15:00:00 GMT" } }));
  assert.equal(found, Date.parse("Fri, 13 Nov 2026 15:00:00 GMT"));
  const offline = await fetchServerDate(async () => {
    throw new Error("offline");
  });
  assert.equal(offline, null);
});

function locked(end: number, seen: number): AppState {
  return {
    lists: [
      {
        id: "list",
        name: "Social",
        patterns: ["youtube.com/shorts/*"],
        revision: 2,
        updatedAt: seen,
        lockEnd: end,
        schedule: null,
      },
    ],
    timeSample: { wall: seen },
  };
}

function withPattern(now: number): AppState {
  const created = apply(emptyState(), { type: "create-list", id: "list", name: "Social" }, { now, timeZone: zone, serverDate: null });
  if (!created.ok) throw new Error(created.error);
  const added = apply(created.state, { type: "add-pattern", id: "list", pattern: "example.com" }, { now, timeZone: zone, serverDate: null });
  if (!added.ok) throw new Error(added.error);
  return added.state;
}
