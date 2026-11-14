type Schedule = { days: number[]; start: string; end: string; commitmentDate: string };
type ListView = {
  id: string;
  name: string;
  patterns: string[];
  lockEnd: number | null;
  schedule: Schedule | null;
  lockActive: boolean;
  scheduleCommitted: boolean;
  blocking: boolean;
  countdownMs: number | null;
  windowEnd: number | null;
};
type View = {
  ok: boolean;
  error?: string;
  lists?: ListView[];
  email?: string | null;
  supabaseUrl?: string;
  supabaseConfigured?: boolean;
  lastSyncError?: string | null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const errorBox = document.querySelector<HTMLParagraphElement>("#error");
const listsRoot = document.querySelector<HTMLElement>("#lists");
const accountStatus = document.querySelector<HTMLParagraphElement>("#account-status");

document.querySelector<HTMLFormElement>("#create-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const name = String(new FormData(form).get("name") ?? "");
  void send({ type: "command", command: { type: "create-list", id: crypto.randomUUID(), name } }, () => form.reset());
});

document.querySelector<HTMLFormElement>("#config-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void send({ type: "save-supabase", url: String(data.get("url") ?? ""), anonKey: String(data.get("anonKey") ?? "") });
});

document.querySelector<HTMLFormElement>("#auth-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const submitter = event.submitter as HTMLButtonElement | null;
  void send({
    type: submitter?.value === "sign-up" ? "sign-up" : "sign-in",
    email: String(data.get("email") ?? ""),
    password: String(data.get("password") ?? ""),
  });
});

document.querySelector("#sign-out")?.addEventListener("click", () => void send({ type: "sign-out" }));

let renderedShape = "";

void refresh();
window.setInterval(() => void refresh(), 1000);

async function refresh(): Promise<void> {
  const view = (await chrome.runtime.sendMessage({ type: "get-state" })) as View;
  const shape = listShape(view);
  const editing = document.activeElement instanceof HTMLElement && listsRoot?.contains(document.activeElement) === true;
  if (shape !== renderedShape && !editing) render(view);
  else updateStatuses(view);
}

async function send(message: unknown, after?: () => void): Promise<void> {
  const view = (await chrome.runtime.sendMessage(message)) as View;
  if (!view.ok) {
    showError(view.error ?? "That change was rejected.");
    return;
  }
  showError("");
  after?.();
  render(view);
}

function updateStatuses(view: View): void {
  if (!listsRoot || !accountStatus) return;
  if (view.lastSyncError) showError(view.lastSyncError);
  for (const list of view.lists ?? []) {
    const status = listsRoot.querySelector(`[data-list="${CSS.escape(list.id)}"] .status`);
    if (status) status.textContent = statusText(list);
  }
  accountStatus.textContent = accountText(view);
}

function listShape(view: View): string {
  return JSON.stringify(
    (view.lists ?? []).map((list) => ({
      id: list.id,
      name: list.name,
      patterns: list.patterns,
      lockActive: list.lockActive,
      scheduleCommitted: list.scheduleCommitted,
      schedule: list.schedule,
      blocking: list.blocking,
    })),
  );
}

function accountText(view: View): string {
  if (view.email) return `Logged in as ${view.email}. Logging out does not unlock a list.`;
  if (view.supabaseConfigured) return "Connection saved. Log in when you want lists stored with your account.";
  return "No account connected. Lists stay on this Mac.";
}

function render(view: View): void {
  if (!listsRoot || !accountStatus) return;
  if (view.lastSyncError) showError(view.lastSyncError);
  listsRoot.replaceChildren();
  for (const list of view.lists ?? []) listsRoot.append(renderList(list));
  const urlInput = document.querySelector<HTMLInputElement>("#config-form input[name=url]");
  if (urlInput && document.activeElement !== urlInput) urlInput.value = view.supabaseUrl ?? "";
  accountStatus.textContent = accountText(view);
  renderedShape = listShape(view);
}

function renderList(list: ListView): HTMLElement {
  const section = document.createElement("section");
  section.className = "list";
  section.dataset.list = list.id;
  const title = document.createElement("h2");
  title.textContent = list.name;
  section.append(title);
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = statusText(list);
  section.append(status);

  const patterns = document.createElement("ul");
  for (const pattern of list.patterns) {
    const item = document.createElement("li");
    item.textContent = `${pattern} `;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Remove";
    remove.disabled = list.lockActive || list.scheduleCommitted;
    remove.addEventListener("click", () => {
      void send({ type: "command", command: { type: "remove-pattern", id: list.id, pattern } });
    });
    item.append(remove);
    patterns.append(item);
  }
  section.append(patterns);

  section.append(patternForm(list));
  if (!list.lockActive) section.append(lockForm(list));
  section.append(scheduleForm(list));
  const removeList = document.createElement("button");
  removeList.type = "button";
  removeList.className = "secondary";
  removeList.textContent = "Delete list";
  removeList.disabled = list.lockActive || list.scheduleCommitted;
  removeList.addEventListener("click", () => {
    void send({ type: "command", command: { type: "delete-list", id: list.id } });
  });
  section.append(removeList);
  return section;
}

function patternForm(list: ListView): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `<label>URL or pattern <input name="pattern" required placeholder="youtube.com/shorts/*" /></label><button type="submit">Add</button>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const pattern = String(new FormData(form).get("pattern") ?? "");
    void send({ type: "command", command: { type: "add-pattern", id: list.id, pattern } }, () => form.reset());
  });
  const hint = document.createElement("p");
  hint.textContent = "A site blocks that host only. A path ending in /* blocks that section. Add *.youtube.com/shorts/* as well as youtube.com/shorts/* if you want www and other subdomains.";
  form.append(hint);
  return form;
}

function lockForm(list: ListView): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `<label>Lock until <input name="end" type="datetime-local" required /></label><label><input name="confirm" type="checkbox" /> I understand I cannot turn this off, delete the list, or remove URLs until that time.</label><button type="submit">Lock list</button>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    if (!data.get("confirm")) {
      showError("Confirm that you are committing until the end time.");
      return;
    }
    const end = new Date(String(data.get("end"))).getTime();
    const agreed = window.confirm("You are committing to this lock until the end time you chose. You will not be able to turn it off, delete the list, or remove blocked URLs before then.");
    if (!agreed) return;
    void send({ type: "command", command: { type: "activate-lock", id: list.id, end, confirm: true } });
  });
  return form;
}

function scheduleForm(list: ListView): HTMLElement {
  const form = document.createElement("form");
  const days = document.createElement("div");
  days.className = "days";
  for (let day = 0; day < 7; day += 1) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.name = "day";
    box.value = String(day);
    if (list.schedule?.days.includes(day)) box.checked = true;
    label.append(box, document.createTextNode(DAY_NAMES[day]));
    days.append(label);
  }
  form.append(days);
  const start = document.createElement("input");
  start.type = "time";
  start.name = "start";
  start.required = true;
  start.value = list.schedule?.start ?? "09:00";
  const end = document.createElement("input");
  end.type = "time";
  end.name = "end";
  end.required = true;
  end.value = list.schedule?.end ?? "17:00";
  const commitment = document.createElement("input");
  commitment.type = "date";
  commitment.name = "commitmentDate";
  commitment.required = true;
  commitment.value = list.schedule?.commitmentDate ?? "";
  form.append(labeled("Start", start), labeled("End", end), labeled("Commit until", commitment));
  const confirm = document.createElement("label");
  const confirmBox = document.createElement("input");
  confirmBox.type = "checkbox";
  confirmBox.name = "confirm";
  confirm.append(confirmBox, document.createTextNode(" I understand I cannot weaken this schedule until the end date, including between blocking sessions."));
  form.append(confirm);
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = list.scheduleCommitted ? "Update schedule" : "Commit schedule";
  form.append(save);
  if (list.schedule && !list.scheduleCommitted) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "secondary";
    clear.textContent = "Remove schedule";
    clear.addEventListener("click", () => void send({ type: "command", command: { type: "clear-schedule", id: list.id } }));
    form.append(clear);
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    if (!data.get("confirm")) {
      showError("Confirm that you are committing to this schedule until its end date.");
      return;
    }
    const agreed = window.confirm("You are committing to this schedule until the end date, including times when the block is not active. You will not be able to delete it, turn it off, or make it weaker before that date.");
    if (!agreed) return;
    const schedule = {
      days: data.getAll("day").map((day) => Number(day)),
      start: String(data.get("start") ?? ""),
      end: String(data.get("end") ?? ""),
      commitmentDate: String(data.get("commitmentDate") ?? ""),
    };
    void send({ type: "command", command: { type: "set-schedule", id: list.id, schedule, confirm: true } });
  });
  return form;
}

function labeled(text: string, input: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(document.createTextNode(text), input);
  return label;
}

function statusText(list: ListView): string {
  const parts: string[] = [];
  if (list.blocking) parts.push("Blocking now");
  else parts.push("Not blocking now");
  if (list.lockActive && list.countdownMs !== null) parts.push(`locked for ${formatRemaining(list.countdownMs)}`);
  if (list.scheduleCommitted && list.schedule) {
    parts.push(`schedule committed through ${list.schedule.commitmentDate}`);
    if (list.windowEnd) parts.push(`this session ends ${stamp(list.windowEnd)}`);
  }
  return `${parts.join(". ")}.`;
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function stamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function showError(message: string): void {
  if (!errorBox) return;
  errorBox.hidden = message.length === 0;
  errorBox.textContent = message;
}

export {};
