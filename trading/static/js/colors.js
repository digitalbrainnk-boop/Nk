// Code couleur unique de l'application (graphique, listes, légende).

export const PATTERN_COLORS = {
  double: '#d946ef',    // doubles / triples sommets et creux
  hs: '#f97316',        // tête-épaules
  triangle: '#3b82f6',  // triangles, élargissement
  wedge: '#eab308',     // biseaux
  channel: '#8b5cf6',   // canaux, rectangles
  flag: '#06b6d4',      // drapeaux, fanions
};

export const FAMILY_LABELS = {
  double: 'Doubles / triples sommets & creux',
  hs: 'Tête-épaules',
  triangle: 'Triangles',
  wedge: 'Biseaux',
  channel: 'Canaux & rectangles',
  flag: 'Drapeaux & fanions',
};

export const LEVEL_COLORS = {
  support: '#22c55e',
  resistance: '#f43f5e',
  htf: '#e2e8f0',
};

export const DIR_COLORS = {
  bullish: '#22c55e',
  bearish: '#f43f5e',
  neutral: '#94a3b8',
};

export const EMA_COLORS = {
  ema20: 'rgba(245, 158, 11, 0.75)',
  ema50: 'rgba(20, 184, 166, 0.75)',
  ema200: 'rgba(148, 163, 184, 0.8)',
};

export const RISK_COLORS = { faible: '#22c55e', modere: '#f59e0b', eleve: '#f43f5e' };
export const RISK_LABELS = { faible: 'Faible', modere: 'Modéré', eleve: 'Élevé' };

export const STATUS_LABELS = { forming: 'En formation', confirmed: 'Confirmée', failed: 'Échouée' };
export const TYPE_LABELS = { reversal: 'Retournement', breakout: 'Cassure', rejection: 'Rejet', pattern: 'Figure' };

export function withAlpha(hex, alpha) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Couleur de tendance pour un score de -1 à +1. */
export function trendColor(score) {
  if (score >= 0.2) return DIR_COLORS.bullish;
  if (score <= -0.2) return DIR_COLORS.bearish;
  return DIR_COLORS.neutral;
}
