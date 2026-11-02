/** Outils sur les cotes décimales et les probabilités. */

/** Marge moyenne d'un bookmaker sur un marché à 2 ou 3 issues (≈ 5 à 8 %). */
export const DEFAULT_MARGIN = 0.06;

/** Probabilité « implicite » d'une cote (marge du bookmaker incluse). */
export function impliedProbability(odd: number): number {
  return 1 / odd;
}

/** Marge du bookmaker sur un marché complet : somme des 1/cote − 1. */
export function bookmakerMargin(odds: number[]): number {
  return odds.reduce((sum, o) => sum + 1 / o, 0) - 1;
}

/** Probabilités « justes » d'un marché complet (marge retirée proportionnellement). */
export function fairProbabilities(odds: number[]): number[] {
  const total = odds.reduce((sum, o) => sum + 1 / o, 0);
  return odds.map((o) => 1 / o / total);
}

/** Estimation de la probabilité juste d'une seule cote, sans connaître les autres issues. */
export function estimateFairProbability(odd: number, margin = DEFAULT_MARGIN): number {
  return Math.min(0.99, 1 / odd / (1 + margin));
}

/** Espérance de gain pour 1 misé : p × cote − 1 (positif = « value bet »). */
export function expectedValue(probability: number, odd: number): number {
  return probability * odd - 1;
}

export function product(values: number[]): number {
  return values.reduce((acc, v) => acc * v, 1);
}

/** « 1 chance sur N » (arrondi lisible). */
export function oneIn(probability: number): number {
  if (probability <= 0) return Infinity;
  const n = 1 / probability;
  return n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
}

export function roundOdd(odd: number): number {
  return Math.round(odd * 100) / 100;
}
