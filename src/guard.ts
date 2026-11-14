const EVENT = "focus-lock-navigate";

function isWebUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

async function check(): Promise<void> {
  const url = location.href;
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
window.addEventListener(EVENT, () => void check());
document.addEventListener("yt-navigate-finish", () => void check());

export {};
