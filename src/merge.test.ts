import assert from "node:assert/strict";
import test from "node:test";
import { clearSession, integrateRemote, planSync } from "./merge.ts";
import { listToRow, pullLists, rowToList, signInWithPassword } from "./account.ts";
import type { List } from "./state.ts";

const now = Date.parse("2026-11-16T12:00:00.000Z");
const zone = "Europe/London";

test("an older cloud copy does not replace newer local data", () => {
  const local = list({ revision: 4, patterns: ["example.com"], lockEnd: now + 86_400_000 });
  const remote = list({ revision: 3, patterns: ["other.example"], lockEnd: null });
  const plan = planSync([local], [remote], now, zone);
  assert.deepEqual(plan.merged[0].patterns, ["example.com"]);
  assert.equal(plan.merged[0].lockEnd, local.lockEnd);
  assert.equal(plan.push.length, 1);
});

test("a newer cloud copy cannot clear a local lock or a committed schedule", () => {
  const local = list({
    revision: 2,
    patterns: ["example.com", "news.example/section/*"],
    lockEnd: now + 86_400_000,
    schedule: { days: [1, 2], start: "09:00", end: "17:00", commitmentDate: "2026-12-01" },
  });
  const remote = list({
    revision: 5,
    patterns: ["example.com"],
    lockEnd: null,
    schedule: { days: [1], start: "10:00", end: "16:00", commitmentDate: "2026-11-01" },
  });
  const plan = planSync([local], [remote], now, zone);
  assert.equal(plan.push.length, 1);
  assert.ok(plan.merged[0].revision > remote.revision);
  assert.equal(plan.merged[0].lockEnd, local.lockEnd);
  assert.deepEqual(plan.merged[0].schedule, local.schedule);
  assert.deepEqual(plan.merged[0].patterns.sort(), ["example.com", "news.example/section/*"]);
});

test("a newer unlocked cloud list is accepted", () => {
  const local = list({ revision: 1, patterns: ["example.com"], lockEnd: null });
  const remote = list({ revision: 2, patterns: ["example.com", "other.example"], lockEnd: null, name: "Renamed" });
  const plan = planSync([local], [remote], now, zone);
  assert.equal(plan.push.length, 0);
  assert.equal(plan.merged[0].name, "Renamed");
  assert.deepEqual(plan.merged[0].patterns, remote.patterns);
});

test("a failed cloud read keeps the local lists", () => {
  const local = [list({ revision: 2, lockEnd: now + 1000 })];
  const kept = integrateRemote(local, null, now, zone);
  assert.equal(kept.keptLocal, true);
  assert.equal(kept.merged[0].lockEnd, local[0].lockEnd);
  assert.equal(kept.push.length, 0);
});

test("logging out clears the session and not the lists", () => {
  const stored = { session: { accessToken: "token" }, lists: [list({})] };
  const cleared = clearSession(stored);
  assert.equal(cleared.session, null);
  assert.equal(cleared.lists.length, 1);
  assert.equal(cleared.lists[0].lockEnd, stored.lists[0].lockEnd);
});

test("sign-in uses the hosted auth endpoint and does not keep the password", async () => {
  let body = "";
  const result = await signInWithPassword(
    { url: "https://project.supabase.co", anonKey: "anon" },
    "matt@example.com",
    "correct horse",
    async (input, init) => {
      assert.equal(String(input), "https://project.supabase.co/auth/v1/token?grant_type=password");
      body = String(init?.body);
      return new Response(JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        user: { id: "user-1", email: "matt@example.com" },
      }));
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.accessToken, "access");
    assert.equal("password" in result.value, false);
  }
  assert.equal(JSON.parse(body).email, "matt@example.com");
});

test("rows round-trip and a failed pull reports that local data was kept", async () => {
  const original = list({
    schedule: { days: [1], start: "09:00", end: "17:00", commitmentDate: "2026-12-01" },
  });
  const row = listToRow(original, "user-1", zone);
  const restored = rowToList(row);
  assert.equal(restored.lockEnd, original.lockEnd);
  assert.deepEqual(restored.schedule, original.schedule);
  const failed = await pullLists({ url: "https://project.supabase.co", anonKey: "anon" }, session(), async () => {
    throw new Error("offline");
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.error, /kept/i);
});

function list(overrides: Partial<List>): List {
  return {
    id: "list",
    name: "Work",
    patterns: ["example.com"],
    revision: 1,
    updatedAt: now,
    lockEnd: now + 3_600_000,
    schedule: null,
    ...overrides,
  };
}

function session() {
  return { accessToken: "access", refreshToken: "refresh", userId: "user-1", email: "matt@example.com", expiresAt: now + 3_600_000 };
}
