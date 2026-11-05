// Noyau de l'application : état, appels au serveur, file d'attente hors connexion,
// navigation, composants d'interface (fenêtres, messages, graphiques).

// replaceChildren ignore les éléments absents (null, false) et accepte des listes imbriquées.
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) {
  return nativeReplace.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
};

export const S = { boot: null, user: null, online: navigator.onLine, pending: 0, failed: 0, unread: 0, listeners: new Set() };
export const ROLE_LABELS = { owner: "Propriétaire", manager: "Gérant", cashier: "Caissier", waiter: "Serveur" };

// ---------- Construction du DOM (texte toujours échappé) ----------
export function h(tag, attrs, ...kids) {
  const el = document.createElementNS(tag === "svg" || attrs?.__svg ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml", tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false || k === "__svg") continue;
      if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "class") el.setAttribute("class", Array.isArray(v) ? v.filter(Boolean).join(" ") : v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "value" && "value" in el) el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const svg = (tag, attrs = {}, ...kids) => h(tag, { ...attrs, __svg: true }, ...kids);

const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  box: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  in: "M12 3v12m0 0l-5-5m5 5l5-5M4 21h16",
  out: "M12 21V9m0 0l-5 5m5-5l5 5M4 3h16",
  cart: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 8H6M9 20.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm9 0a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z",
  cash: "M3 7h18v10H3zM7 7v10M17 7v10M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  clip: "M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12l2 2 4-4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  download: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3",
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  wifi: "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 19.5h.01",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  check: "M5 12l5 5L20 7",
  x: "M18 6L6 18M6 6l12 12",
  back: "M15 18l-6-6 6-6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  moon: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  credit: "M3 6h18v12H3zM3 10h18M7 15h4",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  bottle: "M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3z",
  sync: "M4 4v5h5M20 20v-5h-5M5.6 15A7 7 0 0 0 18 17.6M18.4 9A7 7 0 0 0 6 6.4",
};
export function icon(name, cls = "ico") {
  return svg("svg", { class: cls, viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: ICONS[name] || ICONS.more }));
}

// ---------- Formats ----------
const sp = (n) => Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export const num = (n) => `${Math.round(n) < 0 ? "-" : ""}${sp(n || 0)}`;
export const money = (n) => `${num(n)} FCFA`;
const TZ = "Africa/Ouagadougou";
const fmtD = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDT = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtT = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const date = (ts) => (ts ? fmtD.format(new Date(ts)) : "—");
export const datetime = (ts) => (ts ? fmtDT.format(new Date(ts)).replace(" ", " à ") : "—");
export const timeOf = (ts) => (ts ? fmtT.format(new Date(ts)) : "—");
export function dayLabel(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}
export const dayShort = (day) => (day ? day.split("-").reverse().join("/") : "");
export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function crates(qty, per, unit = "casier") {
  if (!per || per <= 1) return `${num(qty)} btl`;
  const a = Math.abs(qty);
  const c = Math.floor(a / per);
  const r = a % per;
  const parts = [];
  if (c) parts.push(`${c} ${unit}${c > 1 ? "s" : ""}`);
  if (r || !c) parts.push(`${r} btl`);
  return (qty < 0 ? "-" : "") + parts.join(" + ");
}
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- File d'attente hors connexion (IndexedDB) ----------
const DB_NAME = "maquis-pro";
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("ops", { keyPath: "key" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function store(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("ops", mode);
    const out = fn(t.objectStore("ops"));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}
export const queue = {
  add: (op) => store("readwrite", (s) => s.put(op)),
  all: async () => ((await store("readonly", (s) => s.getAll())) || []).sort((a, b) => a.created - b.created),
  remove: (key) => store("readwrite", (s) => s.delete(key)),
};
export async function refreshQueueCount() {
  try {
    const ops = (await queue.all()).filter((o) => !S.user || o.user_id === S.user.id);
    S.pending = ops.filter((o) => !o.error).length;
    S.failed = ops.filter((o) => o.error).length;
  } catch {
    S.pending = 0;
  }
  emit("queue");
}

// ---------- Appels au serveur ----------
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// offline : l'opération peut être mise en attente et renvoyée plus tard (identifiant unique = pas de doublon).
export async function api(method, url, body, { offline = null } = {}) {
  const headers = { "X-Requested-With": "MaquisPro" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let key = null;
  if (offline) {
    key = uuid();
    headers["Idempotency-Key"] = key;
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
  } catch (e) {
    setOnline(false);
    if (offline) {
      await queue.add({ key, method, url, body, label: offline, created: Date.now(), user_id: S.user?.id, error: null });
      await refreshQueueCount();
      return { queued: true };
    }
    throw new ApiError("Pas de connexion internet. Réessayez quand le réseau revient.", 0);
  }
  if (res.headers.get("X-From-Cache") === "1") setOnline(false);
  else setOnline(true);
  let data = null;
  const type = res.headers.get("content-type") || "";
  if (type.includes("json")) data = await res.json().catch(() => null);
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    emit("unauthorized");
    throw new ApiError(data?.error || "Session expirée : reconnectez-vous.", 401, data);
  }
  if (!res.ok) throw new ApiError(data?.error || `Erreur ${res.status}`, res.status, data);
  return data;
}
export const GET = (url) => api("GET", url);
export const POST = (url, body = {}, opts) => api("POST", url, body, opts);

let syncing = false;
export async function syncQueue() {
  if (syncing || !S.user) return;
  syncing = true;
  try {
    const ops = (await queue.all()).filter((o) => o.user_id === S.user.id && !o.error);
    let sent = 0;
    for (const op of ops) {
      let res;
      try {
        res = await fetch(op.url, {
          method: op.method,
          headers: { "X-Requested-With": "MaquisPro", "Content-Type": "application/json", "Idempotency-Key": op.key, "X-Offline": "1", "X-Occurred-At": String(op.created) },
          body: JSON.stringify(op.body ?? {}),
          credentials: "same-origin",
        });
      } catch {
        setOnline(false);
        break;
      }
      setOnline(true);
      if (res.status === 401) {
        emit("unauthorized");
        break;
      }
      if (res.ok) {
        await queue.remove(op.key);
        sent++;
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => ({}));
        await queue.add({ ...op, error: data.error || `Refusé (${res.status})` });
      } else break;
    }
    if (sent) toast(`${sent} opération(s) enregistrée(s) hors connexion synchronisée(s).`, "good");
  } finally {
    syncing = false;
    await refreshQueueCount();
    if (S.failed) emit("queue");
  }
}

export function setOnline(v) {
  if (S.online === v) return;
  S.online = v;
  emit("online");
  if (v) syncQueue();
}
window.addEventListener("online", () => {
  setOnline(true);
  syncQueue();
});
window.addEventListener("offline", () => setOnline(false));

// ---------- Petits événements internes ----------
export function on(fn) {
  S.listeners.add(fn);
  return () => S.listeners.delete(fn);
}
export function emit(type, data) {
  for (const fn of [...S.listeners]) {
    try {
      fn(type, data);
    } catch (e) {
      console.error(e);
    }
  }
}

// ---------- Messages, fenêtres ----------
let toastBox;
export function toast(msg, type = "") {
  if (!toastBox) document.body.append((toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" })));
  const t = h("div", { class: `toast ${type}` }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), type === "bad" ? 6000 : 3500);
}
export const fail = (e) => toast(e?.message || String(e), "bad");

export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const close = (v) => {
      ov.remove();
      document.removeEventListener("keydown", esc);
      resolve(v);
    };
    const esc = (e) => e.key === "Escape" && close(null);
    const btns = actions.map((a) =>
      h("button", { class: `btn ${a.class || ""}`, type: a.submit ? "submit" : "button", on: { click: async (e) => {
        if (a.submit) return;
        e.preventDefault();
        if (a.onClick) {
          const r = await a.onClick();
          if (r === false) return;
          close(r);
        } else close(a.value ?? null);
      } } }, a.label),
    );
    const form = h("form", { class: "modal", role: "dialog", "aria-modal": "true", on: { submit: async (e) => {
      e.preventDefault();
      const a = actions.find((x) => x.submit);
      if (!a) return;
      const btn = btns[actions.indexOf(a)];
      btn.disabled = true;
      try {
        const r = await a.onClick();
        if (r !== false) close(r);
      } catch (err) {
        fail(err);
      } finally {
        btn.disabled = false;
      }
    } } }, h("h2", null, title), body, actions.length ? h("div", { class: "btnrow end" }, btns) : null);
    const ov = h("div", { class: "overlay", on: { click: (e) => e.target === ov && close(null) } }, form);
    document.addEventListener("keydown", esc);
    document.body.append(ov);
    setTimeout(() => form.querySelector("input, select, textarea")?.focus(), 50);
  });
}

export function confirmBox(title, text, { danger = false, ok = "Confirmer", reason = null } = {}) {
  const input = reason ? h("textarea", { required: true, minlength: 5, placeholder: reason }) : null;
  return modal(title, h("div", { class: "form" }, h("p", { class: "text-2" }, text), input ? field(reason, input) : null), [
    { label: "Retour", class: "ghost", value: null },
    { label: ok, class: danger ? "danger fill" : "primary", submit: true, onClick: () => (input ? input.value.trim() || false : true) },
  ]);
}

// ---------- Formulaires ----------
export function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", null, label), input, hint ? h("small", { class: "hint" }, hint) : null);
}
export function input(name, attrs = {}) {
  return h("input", { name, ...attrs });
}
export function select(name, options, value, attrs = {}) {
  return h(
    "select",
    { name, ...attrs },
    options.map((o) => (typeof o === "object" ? h("option", { value: o.value, selected: String(o.value) === String(value ?? "") }, o.label) : h("option", { value: o, selected: o === value }, o))),
  );
}
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else out[el.name] = el.value.trim();
  }
  return out;
}
export function stepper(value, onChange, { min = 0, max = 9999 } = {}) {
  const inp = h("input", { type: "number", inputmode: "numeric", min, max, value });
  const set = (v) => {
    v = Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
    inp.value = v;
    onChange(v);
  };
  inp.addEventListener("change", () => set(inp.value));
  return h("div", { class: "stepper" }, h("button", { type: "button", "aria-label": "Moins", on: { click: () => set(Number(inp.value) - 1) } }, "−"), inp, h("button", { type: "button", "aria-label": "Plus", on: { click: () => set(Number(inp.value) + 1) } }, "+"));
}

// ---------- Mise en page ----------
export function pageHead(title, sub, actions = [], back = null) {
  return h(
    "div",
    { class: "pagehead" },
    h("div", null, back ? h("a", { class: "back", href: back }, icon("back"), "Retour") : null, h("h1", null, title), sub ? h("div", { class: "sub" }, sub) : null),
    actions.length ? h("div", { class: "actions" }, actions) : null,
  );
}
export const card = (title, ...kids) => h("section", { class: "card" }, title ? (typeof title === "string" ? h("h2", null, title) : title) : null, ...kids);
export const stat = (label, value, sub, cls = "") => h("div", { class: `stat ${cls}` }, h("div", { class: "l" }, label), h("div", { class: "v" }, value), sub ? h("div", { class: "s" }, sub) : null);
export const empty = (text, ic = "list") => h("div", { class: "empty" }, icon(ic), h("div", null, text));
export const loader = () => h("div", { class: "loader" }, h("div", { class: "spin" }));
export const chip = (text, cls = "") => h("span", { class: `chip ${cls}` }, text);
export function table(columns, rows, { onRow, foot } = {}) {
  if (!rows.length) return empty("Aucune donnée pour cette période.");
  return h(
    "div",
    { class: "tablewrap" },
    h(
      "table",
      { class: "t" },
      h("thead", null, h("tr", null, columns.map((c) => h("th", { class: c.r ? "r" : "" }, c.label)))),
      h(
        "tbody",
        null,
        rows.map((r, i) => h("tr", { class: onRow ? "click" : "", on: onRow ? { click: () => onRow(r, i) } : undefined }, columns.map((c) => h("td", { class: c.r ? "r" : "" }, c.get(r))))),
      ),
      foot ? h("tfoot", null, h("tr", null, foot.map((f, i) => h("td", { class: columns[i]?.r ? "r" : "" }, f)))) : null,
    ),
  );
}

// ---------- Graphiques (une seule série : bleu ; infobulle au survol et au toucher) ----------
let tipEl;
function showTip(e, text) {
  if (!tipEl) document.body.append((tipEl = h("div", { class: "tip", role: "tooltip" })));
  tipEl.textContent = text;
  const r = e.currentTarget.getBoundingClientRect();
  tipEl.style.left = `${r.left + r.width / 2}px`;
  tipEl.style.top = `${r.top}px`;
  tipEl.hidden = false;
}
const hideTip = () => tipEl && (tipEl.hidden = true);

export function columnChart(items, { valueFmt = num, height = 180, label = "Graphique" } = {}) {
  const W = 640;
  const pad = { l: 8, r: 8, t: 18, b: 26 };
  const max = Math.max(...items.map((i) => i.value), 1);
  const slot = (W - pad.l - pad.r) / Math.max(items.length, 1);
  const bw = Math.max(6, Math.min(34, slot * 0.62));
  const ih = height - pad.t - pad.b;
  const best = items.reduce((a, b, i) => (b.value > items[a].value ? i : a), 0);
  const g = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${height}`, role: "img", "aria-label": label });
  const grid = svg("g", { class: "grid" });
  for (let k = 0; k <= 3; k++) {
    const y = pad.t + (ih * k) / 3;
    grid.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y }));
  }
  g.append(grid);
  items.forEach((it, i) => {
    const x = pad.l + i * slot + (slot - bw) / 2;
    const bh = (it.value / max) * ih;
    const y = pad.t + ih - bh;
    const r = Math.min(4, bw / 2, bh);
    const d = bh > 0 ? `M${x},${pad.t + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${pad.t + ih} Z` : "";
    const hit = svg("rect", { class: "hit", x: pad.l + i * slot, y: pad.t, width: slot, height: ih + pad.b, tabindex: 0 });
    const tip = `${it.full || it.label} : ${valueFmt(it.value)}`;
    hit.addEventListener("mouseenter", (e) => showTip(e, tip));
    hit.addEventListener("focus", (e) => showTip(e, tip));
    hit.addEventListener("touchstart", (e) => showTip(e, tip), { passive: true });
    hit.addEventListener("mouseleave", hideTip);
    hit.addEventListener("blur", hideTip);
    g.append(hit, svg("path", { class: "bar", d }), svg("title", null, tip));
    if (items.length <= 16) g.append(svg("text", { class: "lbl", x: pad.l + i * slot + slot / 2, y: height - 8, "text-anchor": "middle" }, it.label));
    if (i === best && it.value > 0) g.append(svg("text", { class: "val", x: x + bw / 2, y: y - 5, "text-anchor": "middle" }, valueFmt(it.value)));
  });
  g.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: pad.t + ih, y2: pad.t + ih, stroke: "var(--muted)", "stroke-width": 1 }));
  return g;
}
document.addEventListener("scroll", hideTip, { passive: true });
document.addEventListener("touchend", () => setTimeout(hideTip, 1500), { passive: true });

export function barList(items, { valueFmt = num } = {}) {
  if (!items.length) return empty("Rien à afficher pour cette période.", "chart");
  const max = Math.max(...items.map((i) => i.value), 1);
  return h(
    "div",
    { class: "hbars" },
    items.map((it) =>
      h("div", { class: "hbar", title: `${it.label} : ${valueFmt(it.value)}` }, h("div", { class: "n" }, it.label), h("div", { class: "tr" }, h("div", { class: "fl", style: { width: `${Math.max(1.5, (it.value / max) * 100)}%` } })), h("div", { class: "v" }, valueFmt(it.value))),
    ),
  );
}

// ---------- Téléchargement, impression, partage ----------
export function downloadUrl(url) {
  const a = h("a", { href: url, download: "" });
  document.body.append(a);
  a.click();
  a.remove();
}
export async function shareFile(url, filename, text) {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename, text });
      return true;
    }
  } catch (e) {
    if (e?.name === "AbortError") return true;
  }
  return false;
}
export function whatsappText(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}
export function emailText(subject, text) {
  location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

// ---------- Navigation ----------
export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}
export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
export const today = () => S.boot?.business_day || new Date().toISOString().slice(0, 10);
export function productName(p) {
  const brand = String(p?.brand || "").trim();
  const name = String(p?.name || "").trim();
  if (!brand) return name;
  return name.toLowerCase().includes(brand.toLowerCase()) ? name : `${brand} — ${name}`;
}
export function photo(p, cls = "") {
  return p.photo ? h("img", { src: `/media/products/${p.photo}`, alt: "", loading: "lazy", class: cls }) : h("span", null, (p.brand || "?").slice(0, 2).toUpperCase());
}
