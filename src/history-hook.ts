const EVENT = "focus-lock-navigate";

function fire(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

function wrap(name: "pushState" | "replaceState"): void {
  const original = history[name];
  if (typeof original !== "function") return;
  history[name] = function (this: History, ...args: Parameters<History["pushState"]>) {
    const result = original.apply(this, args);
    fire();
    return result;
  };
}

try {
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", fire);
} catch {
  // A page that froze history still gets the service worker's navigation listener.
}

export {};
