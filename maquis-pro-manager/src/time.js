// Heure locale du maquis et « journée commerciale » : elle commence à 03 h 00 et se termine
// à 02 h 59 min 59 s le lendemain (heure du Burkina Faso, Africa/Ouagadougou par défaut).
export const TIMEZONE = process.env.MAQUIS_TZ || "Africa/Ouagadougou";
export const DAY_START_HOUR = 3;

// Horloge remplaçable (les tests simulent le passage du temps, par exemple 03 h 00).
let clock = () => Date.now();
export const now = () => clock();
export function setClock(fn) {
  clock = typeof fn === "function" ? fn : () => Date.now();
}

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const pad = (n) => String(n).padStart(2, "0");

export function localParts(ts) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, H: +p.hour, M: +p.minute, S: +p.second };
}

function tzOffset(ts) {
  const p = localParts(ts);
  return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) - Math.floor(ts / 1000) * 1000;
}

// Instant (ms) correspondant à une heure locale donnée.
export function localToUtc(y, m, d, H = 0, M = 0) {
  const guess = Date.UTC(y, m - 1, d, H, M);
  let ts = guess - tzOffset(guess);
  ts = guess - tzOffset(ts);
  return ts;
}

const splitDay = (day) => day.split("-").map(Number);
export const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

export function addDays(day, n) {
  const [y, m, d] = splitDay(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function localDate(ts) {
  const p = localParts(ts);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// Journée commerciale d'un instant : avant 03 h 00, on est encore sur la journée de la veille.
export function businessDay(ts = now()) {
  const p = localParts(ts);
  const day = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return p.H < DAY_START_HOUR ? addDays(day, -1) : day;
}

export function dayBounds(day) {
  const [y, m, d] = splitDay(day);
  const [y2, m2, d2] = splitDay(addDays(day, 1));
  return { start: localToUtc(y, m, d, DAY_START_HOUR), end: localToUtc(y2, m2, d2, DAY_START_HOUR) };
}

// Semaine commerciale : du lundi 03 h 00 au lundi suivant 02 h 59 min 59 s.
export function weekStart(day) {
  const [y, m, d] = splitDay(day);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
  return addDays(day, -((dow + 6) % 7));
}

export function weekBounds(monday) {
  return { start: dayBounds(monday).start, end: dayBounds(addDays(monday, 7)).start };
}

export function isoWeekNumber(day) {
  const [y, m, d] = splitDay(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { year: date.getUTCFullYear(), week: Math.ceil(((date - yearStart) / 86400000 + 1) / 7) };
}

export function weekKey(monday) {
  const { year, week } = isoWeekNumber(monday);
  return `${year}-S${pad(week)}`;
}

export function daysBetween(fromDay, toDay) {
  const out = [];
  for (let d = fromDay; d <= toDay && out.length < 3700; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------- Affichage (français) ----------
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export function fmtDay(day) {
  const [y, m, d] = splitDay(day);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${JOURS[dow]} ${d} ${MOIS[m - 1]} ${y}`;
}
export function fmtDayShort(day) {
  const [y, m, d] = splitDay(day);
  return `${pad(d)}/${pad(m)}/${y}`;
}
export function fmtDateTime(ts) {
  const p = localParts(ts);
  return `${pad(p.d)}/${pad(p.m)}/${p.y} à ${pad(p.H)} h ${pad(p.M)}`;
}
export function fmtTime(ts) {
  const p = localParts(ts);
  return `${pad(p.H)} h ${pad(p.M)}`;
}
