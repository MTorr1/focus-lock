import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePattern, patternToRegex, urlMatches, urlMatchesAny } from "./pattern.ts";

const shorts = [parsePattern("youtube.com/shorts/*"), parsePattern("*.youtube.com/shorts/*")].flatMap((pattern) =>
  pattern ? [pattern] : [],
);

test("youtube shorts are blocked and the rest of youtube is not", () => {
  assert.equal(shorts.length, 2);
  const blocked = [
    "https://youtube.com/shorts",
    "https://youtube.com/shorts/abc",
    "https://www.youtube.com/shorts",
    "https://www.youtube.com/shorts/abc?si=1",
    "https://m.youtube.com/shorts/abc",
    "https://www.youtube.com/shorts/",
  ];
  const allowed = [
    "https://www.youtube.com/",
    "https://www.youtube.com/watch?v=abc",
    "https://www.youtube.com/results?search_query=cats",
    "https://youtube.com/feed/subscriptions",
    "https://www.youtube.com/shorts-extra",
    "https://notyoutube.com/shorts",
    "https://www.youtube.com/watch/shorts",
  ];
  for (const url of blocked) assert.equal(urlMatchesAny(url, shorts), true, url);
  for (const url of allowed) assert.equal(urlMatchesAny(url, shorts), false, url);
});

test("a typed site, section, page, and subdomain pattern mean different things", () => {
  const site = parsePattern("reddit.com");
  const section = parsePattern("https://www.youtube.com/shorts/*");
  const page = parsePattern("https://example.com/some/article?utm=1");
  const subs = parsePattern("*.example.com");
  assert.ok(site && section && page && subs);

  assert.equal(urlMatches("https://reddit.com/r/news", site), true);
  assert.equal(urlMatches("https://www.reddit.com/", site), false);
  assert.equal(urlMatches("https://www.youtube.com/shorts/1", section), true);
  assert.equal(urlMatches("https://youtube.com/shorts/1", section), false);
  assert.equal(urlMatches("https://www.youtube.com/watch?v=1", section), false);
  assert.equal(urlMatches("https://example.com/some/article?x=2", page), true);
  assert.equal(urlMatches("https://example.com/some/article/extra", page), false);
  assert.equal(urlMatches("https://a.example.com/anywhere", subs), true);
  assert.equal(urlMatches("https://a.b.example.com/", subs), true);
  assert.equal(urlMatches("https://example.com/", subs), false);
  assert.equal(urlMatches("https://notexample.com/", subs), false);
});

test("a parent-directory url does not stay on the blocked path", () => {
  const section = parsePattern("youtube.com/shorts/*");
  assert.ok(section);
  assert.equal(urlMatches("https://youtube.com/shorts/../watch?v=1", section), false);
});

test("network rules agree with the matcher", () => {
  const samples = [
    "https://youtube.com/shorts/abc",
    "https://www.youtube.com/watch?v=1",
    "https://m.youtube.com/shorts/abc",
    "https://example.com/some/article?x=1",
    "https://example.com/some/article/extra",
    "https://news.example.com/home",
    "https://example.com/",
    "https://www.reddit.com/",
  ];
  const patterns = ["youtube.com/shorts/*", "*.youtube.com/shorts/*", "example.com/some/article", "*.example.com", "reddit.com"].map(
    (raw) => parsePattern(raw),
  );
  for (const pattern of patterns) {
    assert.ok(pattern);
    const regex = new RegExp(patternToRegex(pattern), "i");
    for (const url of samples) assert.equal(regex.test(url), urlMatches(url, pattern), `${url} ${patternToRegex(pattern)}`);
  }
});

test("the manifest exposes the blocking page and both script worlds", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8")) as {
    manifest_version: number;
    permissions: string[];
    host_permissions: string[];
    web_accessible_resources: { resources: string[]; matches: string[] }[];
    content_scripts: { run_at: string; world?: string; js: string[] }[];
  };
  assert.equal(manifest.manifest_version, 3);
  for (const permission of ["declarativeNetRequest", "webNavigation", "storage", "alarms"]) {
    assert.ok(manifest.permissions.includes(permission));
  }
  assert.ok(manifest.host_permissions.includes("<all_urls>"));
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ["blocked.html"]);
  assert.ok(manifest.web_accessible_resources[0].matches.includes("https://*/*"));
  assert.equal(manifest.content_scripts.length, 2);
  assert.ok(manifest.content_scripts.every((script) => script.run_at === "document_start"));
  assert.equal(manifest.content_scripts.filter((script) => script.world === "MAIN").length, 1);
  assert.equal(manifest.content_scripts.filter((script) => script.world === undefined).length, 1);
  assert.deepEqual(
    manifest.content_scripts.map((script) => script.js[0]).sort(),
    ["guard.js", "history-hook.js"],
  );
});
