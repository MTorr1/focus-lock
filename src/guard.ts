import { shortsCheckUrl, shortsVideoIdFromDocument } from "./youtube-nav.ts";

const EVENT = "focus-lock-navigate";

function isWebUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function resolveCheckUrl(): string {
  const href = location.href;
  if (!isWebUrl(href)) return href;
  try {
    const page = new URL(href);
    const videoId = shortsVideoIdFromDocument(document, page.origin);
    return shortsCheckUrl(href, videoId);
  } catch {
    return href;
  }
}

let checkTimer: number | undefined;
let lastRun = 0;

function scheduleCheck(): void {
  window.clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => {
    const now = Date.now();
    if (now - lastRun < 200) {
      scheduleCheck();
      return;
    }
    lastRun = now;
    void check();
  }, 60);
}

async function check(): Promise<void> {
  const url = resolveCheckUrl();
  if (!isWebUrl(url)) return;
  let response: { blocked?: boolean } | undefined;
  try {
    response = await chrome.runtime.sendMessage({ type: "check-url", url });
  } catch {
    return;
  }
  if (!response?.blocked) return;
  const destination = `${chrome.runtime.getURL("blocked.html")}?url=${encodeURIComponent(url)}`;
  location.replace(destination);
}

void check();
window.addEventListener(EVENT, scheduleCheck);
document.addEventListener("yt-navigate-finish", scheduleCheck, true);
document.addEventListener("yt-page-data-updated", scheduleCheck, true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleCheck();
});

if (location.hostname.includes("youtube.com")) {
  const observer = new MutationObserver(() => scheduleCheck());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export {};