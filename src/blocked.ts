type Hit = { listId: string; listName: string; lockEnd: number | null; windowEnd: number | null };
type Info = { ok: boolean; blocked?: boolean; url?: string | null; hits?: Hit[]; until?: number | null; error?: string };

const root = document.querySelector("#root");

void show();

async function show(): Promise<void> {
  if (!root) return;
  const params = new URLSearchParams(location.search);
  let info: Info;
  try {
    info = await chrome.runtime.sendMessage({ type: "block-info", url: params.get("url") });
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : "The blocker could not be reached.";
    return;
  }
  root.replaceChildren();
  const title = document.createElement("h1");
  title.textContent = info.blocked ? "This page is restricted" : "This page is not currently restricted";
  root.append(title);
  if (info.url) {
    const address = document.createElement("p");
    address.className = "url";
    address.textContent = info.url;
    root.append(address);
  }
  for (const hit of info.hits ?? []) {
    const item = document.createElement("section");
    const name = document.createElement("h2");
    name.textContent = hit.listName;
    item.append(name);
    const ends = document.createElement("p");
    const parts: string[] = [];
    if (hit.lockEnd !== null) parts.push(`Locked until ${stamp(hit.lockEnd)}.`);
    if (hit.windowEnd !== null) parts.push(`This scheduled block ends at ${stamp(hit.windowEnd)}.`);
    ends.textContent = parts.join(" ") || "This list is blocking this page.";
    item.append(ends);
    root.append(item);
  }
  if (info.blocked && info.until) {
    const until = document.createElement("p");
    until.textContent = `The page stays restricted until ${stamp(info.until)}, when every matching restriction has ended.`;
    root.append(until);
  }
}

function stamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export {};
