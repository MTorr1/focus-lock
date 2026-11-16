const EVENT = "focus-lock-navigate";

type HistoryFn = History["pushState"];

function fire(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

function wrap(name: "pushState" | "replaceState"): void {
  const original = history[name] as HistoryFn & { __focusLockWrapped?: boolean };
  if (typeof original !== "function" || original.__focusLockWrapped) return;
  const wrapped = function (this: History, ...args: Parameters<History["pushState"]>) {
    const result = original.apply(this, args);
    fire();
    return result;
  } as HistoryFn & { __focusLockWrapped?: boolean };
  wrapped.__focusLockWrapped = true;
  history[name] = wrapped;
}

function ensureWrapped(): void {
  wrap("pushState");
  wrap("replaceState");
}

try {
  ensureWrapped();
  window.addEventListener("popstate", fire);
  document.addEventListener("yt-navigate-finish", fire, true);
  document.addEventListener("yt-page-data-updated", fire, true);
  window.setInterval(ensureWrapped, 1500);
} catch {
  // A page that froze history still gets the service worker's navigation listener.
}

export {};