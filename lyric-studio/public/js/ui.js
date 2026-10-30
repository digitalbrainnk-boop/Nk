// Petits outils d'interface : création d'éléments, notifications, fenêtres.

/** h("div", { class: "x", onclick: fn }, "texte", enfant…) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "value") el.value = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message, type = "info", ms = 4000) {
  const box = document.getElementById("toasts");
  const el = h("div", { class: `toast ${type}`, role: type === "error" ? "alert" : "status" }, message);
  box.append(el);
  setTimeout(() => el.classList.add("out"), ms);
  setTimeout(() => el.remove(), ms + 400);
}

/** Fenêtre par-dessus la page. actions : [{ label, primary, danger, onClick(close) }] */
export function modal({ title, body, actions = [], wide = false, onClose, closable = true }) {
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape" && closable) close();
  };
  const overlay = h(
    "div",
    { class: "overlay", onmousedown: (e) => e.target === overlay && closable && close() },
    h(
      "div",
      { class: `dialog${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
      h(
        "header",
        {},
        h("h2", {}, title),
        closable && h("button", { class: "icon-btn", title: "Fermer", "aria-label": "Fermer", onclick: close }, "✕"),
      ),
      h("div", { class: "dialog-body" }, body),
      actions.length &&
        h(
          "footer",
          {},
          actions.map((a) =>
            h("button", { class: a.primary ? "btn primary" : a.danger ? "btn danger" : "btn", onclick: () => a.onClick?.(close) }, a.label),
          ),
        ),
    ),
  );
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
  setTimeout(() => overlay.querySelector("input, textarea, select, button.primary")?.focus(), 30);
  return { close, el: overlay };
}

export function confirmBox(message, { ok = "Confirmer", danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title: "Confirmation",
      body: h("p", {}, message),
      onClose: () => !answered && resolve(false),
      actions: [
        { label: "Annuler", onClick: (close) => close() },
        { label: ok, primary: !danger, danger, onClick: (close) => ((answered = true), close(), resolve(true)) },
      ],
    });
  });
}

/** 83.456 -> « 1:23.4 » */
export function fmtTime(s, decimals = 1) {
  if (!Number.isFinite(s)) return "–";
  const neg = s < 0;
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${neg ? "-" : ""}${m}:${sec.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0")}`;
}

export function fmtSize(bytes) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} Go`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1e3))} Ko`;
}

export function debounce(fn, ms) {
  let timer;
  const d = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  d.cancel = () => clearTimeout(timer);
  return d;
}

/** Petite barre de progression réutilisable. */
export function progressBar() {
  const fill = h("div", { class: "progress-fill" });
  const label = h("div", { class: "progress-label" });
  const el = h("div", { class: "progress" }, h("div", { class: "progress-track" }, fill), label);
  return {
    el,
    set(x, text) {
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10}%`;
      if (text !== undefined) label.textContent = text;
    },
  };
}

export function field(label, control, hint) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint && h("small", { class: "hint" }, hint));
}
