// Formatage des prix, heures et pourcentages.

let digitsBySymbol = {};

export function setDigits(map) { digitsBySymbol = { ...digitsBySymbol, ...map }; }
export function digitsOf(symbol) { return digitsBySymbol[symbol] ?? 2; }

export function price(value, symbol) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digitsOf(symbol));
}

export function pct(value, digits = 2) {
  if (value === null || value === undefined) return '—';
  const s = Number(value).toFixed(digits);
  return `${value > 0 ? '+' : ''}${s} %`;
}

export function time(epochSeconds, withDate = false) {
  const d = new Date(epochSeconds * 1000);
  const opts = { hour: '2-digit', minute: '2-digit' };
  if (withDate) Object.assign(opts, { day: '2-digit', month: '2-digit' });
  return d.toLocaleString('fr-FR', opts);
}

export function ago(epochSeconds) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - epochSeconds));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
