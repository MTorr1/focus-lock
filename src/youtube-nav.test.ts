import assert from "node:assert/strict";
import test from "node:test";
import { isYouTubeHost, pathIsShortsSection, shortsCheckUrl, shortsIdFromUrl } from "./youtube-nav.ts";

test("shorts paths are recognised on youtube hosts", () => {
  assert.equal(pathIsShortsSection("/shorts"), true);
  assert.equal(pathIsShortsSection("/shorts/"), true);
  assert.equal(pathIsShortsSection("/shorts/abc"), true);
  assert.equal(pathIsShortsSection("/watch"), false);
  assert.equal(pathIsShortsSection("/"), false);
});

test("a home-page watch url is checked as shorts when a video id is known", () => {
  const home = "https://www.youtube.com/";
  assert.equal(shortsCheckUrl(home, "abc123"), "https://www.youtube.com/shorts/abc123");
  assert.equal(shortsCheckUrl("https://www.youtube.com/feed/trending", "abc123"), "https://www.youtube.com/shorts/abc123");
  assert.equal(shortsCheckUrl("https://www.youtube.com/shorts/abc123", "abc123"), "https://www.youtube.com/shorts/abc123");
  assert.equal(shortsCheckUrl("https://www.youtube.com/watch?v=abc123", "abc123"), "https://www.youtube.com/shorts/abc123");
  assert.equal(shortsCheckUrl("https://example.com/", "abc123"), "https://example.com/");
});

test("shorts ids are parsed from urls", () => {
  assert.equal(shortsIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share"), "dQw4w9WgXcQ");
  assert.equal(isYouTubeHost("www.youtube.com"), true);
  assert.equal(isYouTubeHost("m.youtube.com"), true);
  assert.equal(shortsIdFromUrl("https://www.youtube.com/watch?v=x"), null);
});