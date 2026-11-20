// Petits utilitaires d'interface : échappement HTML, dates, toasts, boîtes de dialogue, icônes.

export const $ = (selector, root = document) => root.querySelector(selector);

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Tout texte venant de WhatsApp passe par ici avant d'être inséré dans la page. */
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const STATUS_LABELS = {
  idle: "Hors ligne",
  connecting: "Connexion…",
  qr: "QR code à scanner",
  pairing: "Code à saisir",
  open: "Connectée",
  reconnecting: "Reconnexion…",
  logged_out: "Déliée",
  error: "Erreur",
};

export const formatPhone = (digits) => (digits ? `+${digits}` : "");

const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long" });
const shortDateFmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const longDateFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function dayDiff(ts) {
  const a = new Date(ts);
  const b = new Date();
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

export const formatClock = (ts) => timeFmt.format(ts);

/** Heure pour la liste des discussions : 14:05, Hier, lundi, 03/11/26. */
export function formatListTime(ts) {
  if (!ts) return "";
  const diff = dayDiff(ts);
  if (diff === 0) return timeFmt.format(ts);
  if (diff === 1) return "Hier";
  if (diff < 7) return weekdayFmt.format(ts);
  return shortDateFmt.format(ts);
}

/** Séparateur de jour dans une conversation. */
export function formatDay(ts) {
  const diff = dayDiff(ts);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return longDateFmt.format(ts);
}

export function initials(name) {
  const parts = String(name || "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?").slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** Couleur d'avatar stable pour un identifiant. */
export function avatarColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 45%)`;
}

// --- Toasts ---------------------------------------------------------------

export function toast(message, { type = "info", duration = 4000, action } = {}) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      el.remove();
    });
    el.append(btn);
  }
  box.append(el);
  if (duration) setTimeout(() => el.remove(), duration);
  return el;
}

// --- Boîtes de dialogue -----------------------------------------------------

function openDialog(build) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    dialog.append(form);
    const getValue = build(form);
    let result = null;
    form.addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return; // Annuler
      event.preventDefault();
      result = getValue();
      dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    form.querySelector("input")?.focus();
  });
}

function dialogButtons(confirmLabel, danger) {
  return `<div class="dialog-actions">
    <button type="submit" value="cancel" class="btn btn-ghost" formnovalidate>Annuler</button>
    <button type="submit" value="ok" class="btn ${danger ? "btn-danger" : "btn-primary"}">${esc(confirmLabel)}</button>
  </div>`;
}

/** Demande une confirmation ; résout true/false. */
export async function confirmDialog({ title, message, confirmLabel = "Confirmer", danger = false }) {
  const ok = await openDialog((form) => {
    form.innerHTML = `<h2>${esc(title)}</h2><p>${esc(message)}</p>${dialogButtons(confirmLabel, danger)}`;
    return () => true;
  });
  return ok === true;
}

/** Demande une valeur ; résout la chaîne saisie ou null si annulé. */
export function promptDialog({ title, message = "", label, value = "", placeholder = "", inputMode = "text", confirmLabel = "Valider", required = true }) {
  return openDialog((form) => {
    form.innerHTML = `<h2>${esc(title)}</h2>
      ${message ? `<p>${esc(message)}</p>` : ""}
      <label class="field"><span>${esc(label)}</span>
        <input name="value" value="${esc(value)}" placeholder="${esc(placeholder)}" inputmode="${esc(inputMode)}" autocomplete="off" ${required ? "required" : ""}>
      </label>
      ${dialogButtons(confirmLabel)}`;
    return () => form.elements.value.value.trim();
  });
}

// --- Icônes (SVG en ligne) -------------------------------------------------

const svg = (path, extra = "") =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;

export const icons = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  lines: svg('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  qr: svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
  key: svg('<path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
  pause: svg('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'),
  play: svg('<path d="M5 3l14 9-14 9V3z"/>'),
  unlink: svg('<path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
};
