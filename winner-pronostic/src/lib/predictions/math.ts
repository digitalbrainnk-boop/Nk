/** Outils mathématiques des modèles de probabilités. */

export const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** Probabilités de Poisson P(X = 0..max), la dernière case regroupant la queue (somme = 1). */
export function poissonVector(lambda: number, max: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda);
  let cumulative = 0;
  for (let k = 0; k < max; k++) {
    out.push(p);
    cumulative += p;
    p = (p * lambda) / (k + 1);
  }
  out.push(Math.max(0, 1 - cumulative));
  return out;
}

/** Fonction de répartition de la loi normale centrée réduite (erreur < 1,5e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Loi discrète sur les entiers approchant une loi normale (correction de
 * continuité) : utilisée pour les écarts et totaux de points (basket, hand…).
 */
export function discreteNormal(mean: number, sd: number): Map<number, number> {
  const out = new Map<number, number>();
  const from = Math.floor(mean - 6 * sd);
  const to = Math.ceil(mean + 6 * sd);
  let total = 0;
  for (let k = from; k <= to; k++) {
    const p = normalCdf((k + 0.5 - mean) / sd) - normalCdf((k - 0.5 - mean) / sd);
    if (p > 1e-12) {
      out.set(k, p);
      total += p;
    }
  }
  for (const [k, p] of out) out.set(k, p / total);
  return out;
}

/** Loi d'une fonction d'une matrice de probabilités (scores domicile × extérieur). */
export function distributionOf(matrix: number[][], f: (h: number, a: number) => number): Map<number, number> {
  const out = new Map<number, number>();
  matrix.forEach((row, h) => row.forEach((p, a) => out.set(f(h, a), (out.get(f(h, a)) ?? 0) + p)));
  return out;
}

export function sumWhere(matrix: number[][], predicate: (h: number, a: number) => boolean): number {
  let total = 0;
  matrix.forEach((row, h) => row.forEach((p, a) => {
    if (predicate(h, a)) total += p;
  }));
  return total;
}

export function probWhere(dist: Map<number, number>, predicate: (v: number) => boolean): number {
  let total = 0;
  for (const [v, p] of dist) if (predicate(v)) total += p;
  return total;
}

/** Produit de deux lois indépendantes en matrice [i][j] = p(i)·q(j). */
export function outer(p: number[], q: number[]): number[][] {
  return p.map((pi) => q.map((qj) => pi * qj));
}

/**
 * Déplace la masse des égalités (prolongations, tirs au but, manches
 * supplémentaires) vers +1 / −1 selon la part de victoires de l'équipe à domicile.
 */
export function resolveTies(margin: Map<number, number>, homeShare = 0.5): Map<number, number> {
  const out = new Map(margin);
  const tie = out.get(0) ?? 0;
  out.delete(0);
  out.set(1, (out.get(1) ?? 0) + tie * homeShare);
  out.set(-1, (out.get(-1) ?? 0) + tie * (1 - homeShare));
  return out;
}

// ---------------------------------------------------------------------------
// Lignes asiatiques et lignes entières : gagné, à moitié gagné, remboursé…
// ---------------------------------------------------------------------------
export type LineOutcome = { win: number; halfWin: number; push: number; halfLoss: number; loss: number };

/**
 * Résultat d'un pari « marge + ligne » : value(v) donne la marge du pari pour
 * une issue v (ex. total − ligne pour un « plus de »). Les lignes .25 / .75
 * sont partagées en deux demi-mises sur les lignes voisines.
 */
export function lineOutcome(dist: Map<number, number>, line: number, margin: (v: number, line: number) => number): LineOutcome {
  const quarter = Math.abs(Math.round(line * 4) % 2) === 1;
  const lines = quarter ? [line - 0.25, line + 0.25] : [line];
  const result: LineOutcome = { win: 0, halfWin: 0, push: 0, halfLoss: 0, loss: 0 };
  for (const [v, p] of dist) {
    const scores = lines.map((l) => Math.sign(Math.round(margin(v, l) * 1000) / 1000));
    if (scores.length === 1) {
      if (scores[0] > 0) result.win += p;
      else if (scores[0] === 0) result.push += p;
      else result.loss += p;
    } else {
      const sum = scores[0] + scores[1];
      if (sum === 2) result.win += p;
      else if (sum === 1) result.halfWin += p;
      else if (sum === 0) result.push += p; // les deux remboursés (impossible : lignes distantes de 0,5)
      else if (sum === -1) result.halfLoss += p;
      else result.loss += p;
    }
  }
  return result;
}

/** Espérance de gain d'un pari à ligne pour 1 misé à la cote `odd`. */
export function lineExpectedValue(o: LineOutcome, odd: number): number {
  return o.win * (odd - 1) + o.halfWin * ((odd - 1) / 2) - o.halfLoss * 0.5 - o.loss;
}
