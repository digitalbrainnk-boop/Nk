// Outils communs : erreurs, validation des saisies, formats (FCFA, quantités).
export class AppError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (msg, extra) => new AppError(400, msg, extra);
export const forbidden = (msg = "Action non autorisée pour votre compte.") => new AppError(403, msg);
export const notFound = (msg = "Élément introuvable.") => new AppError(404, msg);
export const conflict = (msg) => new AppError(409, msg);

export function str(v, label, { max = 200, required = false, min = 0 } = {}) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string" && typeof v !== "number") throw bad(`${label} : valeur invalide.`);
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (required && !s) throw bad(`${label} est obligatoire.`);
  if (s.length > max) throw bad(`${label} : ${max} caractères au maximum.`);
  if (s && s.length < min) throw bad(`${label} : ${min} caractères au minimum.`);
  return s;
}

export function int(v, label, { min = 0, max = 1e12, required = true, def } = {}) {
  if (v === undefined || v === null || v === "") {
    if (!required) return def ?? null;
    throw bad(`${label} est obligatoire.`);
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw bad(`${label} doit être un nombre entier.`);
  if (n < min) throw bad(`${label} doit être au moins ${min}.`);
  if (n > max) throw bad(`${label} ne peut pas dépasser ${max}.`);
  return n;
}

export function oneOf(v, label, values) {
  if (!values.includes(v)) throw bad(`${label} : valeur non reconnue.`);
  return v;
}

export function arr(v, label, { min = 1, max = 200 } = {}) {
  if (!Array.isArray(v)) throw bad(`${label} : liste attendue.`);
  if (v.length < min) throw bad(`${label} : au moins ${min} élément(s).`);
  if (v.length > max) throw bad(`${label} : ${max} éléments au maximum.`);
  return v;
}

// 12500 -> "12 500 FCFA" (espaces ordinaires : lisibles partout, y compris dans les PDF).
export function money(n) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${v < 0 ? "-" : ""}${s} FCFA`;
}
export function num(n) {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? "-" : ""}${Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

// 125 bouteilles en casiers de 12 -> "10 casiers + 5 bouteilles".
export function cratesLabel(qty, perCrate, unit = "casier") {
  const q = Math.round(qty);
  if (!perCrate || perCrate <= 1) return `${num(q)} bouteille${Math.abs(q) > 1 ? "s" : ""}`;
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  const c = Math.floor(a / perCrate);
  const r = a % perCrate;
  const parts = [];
  if (c) parts.push(`${c} ${unit}${c > 1 ? "s" : ""}`);
  if (r || !c) parts.push(`${r} bouteille${r > 1 ? "s" : ""}`);
  return sign + parts.join(" + ");
}

export const pct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0);

export function variation(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
