import type { Market } from "@/lib/predictions/markets";
import type { SportCode } from "@/lib/sports/catalog";
import { expectedValue, oneIn, product } from "./odds";

/**
 * Générateur de coupons (« code de 5 », « code de 10 »…).
 *
 * Objectif : parmi les sélections analysées par le modèle, trouver la
 * combinaison dont la cote totale atteint la cote visée (entre 100 % et 115 %
 * de la cible) et dont la PROBABILITÉ RÉELLE ESTIMÉE est la plus élevée.
 *
 * Méthode : maximiser Σ ln(p) sous la contrainte Σ ln(cote) ≈ ln(cible).
 * C'est un « sac à dos par groupes » (au plus une sélection par événement)
 * résolu exactement par programmation dynamique sur les log-cotes.
 *
 * Bon à savoir : à cote totale égale, empiler beaucoup de petites cotes n'est
 * PAS plus sûr — la marge du bookmaker se multiplie à chaque sélection. Le
 * niveau de risque règle donc surtout la confiance minimale exigée par
 * sélection ; l'optimisation choisit ensuite le bon nombre de sélections.
 */

export type RiskLevel = "prudent" | "equilibre" | "audacieux";

export type Candidate = {
  /** Identifiant unique de la sélection (ex. « 812:TOTAL:2.5:OVER »). */
  key: string;
  eventId: number;
  sport: SportCode;
  competition?: string;
  startsAt: string; // ISO 8601
  home: string;
  away: string;
  market: Market;
  line: number | null;
  selection: string;
  /** Meilleure cote disponible. */
  odd: number;
  /** Probabilité estimée par le modèle. */
  probability: number;
  /** Indice de confiance du modèle, de 1 à 5. */
  confidence: number;
};

export type RiskRule = {
  label: string;
  description: string;
  minProbability: number;
  minConfidence: number;
  minOdd: number;
  maxOdd: number;
  maxLegs: number;
  /** Espérance minimale tolérée par sélection (légèrement négative = proche de la cote juste). */
  minEdge: number;
};

export const RISK_RULES: Record<RiskLevel, RiskRule> = {
  prudent: {
    label: "Prudent",
    description: "Uniquement des sélections très probables, sur lesquelles le modèle est le plus confiant.",
    minProbability: 0.6,
    minConfidence: 4,
    minOdd: 1.12,
    maxOdd: 1.9,
    maxLegs: 8,
    minEdge: -0.03,
  },
  equilibre: {
    label: "Équilibré",
    description: "Un compromis entre probabilité et cote, confiance moyenne à élevée.",
    minProbability: 0.45,
    minConfidence: 3,
    minOdd: 1.15,
    maxOdd: 2.6,
    maxLegs: 10,
    minEdge: -0.05,
  },
  audacieux: {
    label: "Audacieux",
    description: "Accepte des cotes plus hautes et moins de certitude pour viser plus gros.",
    minProbability: 0.3,
    minConfidence: 2,
    minOdd: 1.2,
    maxOdd: 4,
    maxLegs: 12,
    minEdge: -0.08,
  },
};

export type GenerateOptions = {
  targetOdds: number;
  risk: RiskLevel;
  sports?: SportCode[];
  /** Sélections à exclure (pour proposer « un autre code »). */
  excludeKeys?: string[];
  /** Fourchette acceptée autour de la cible (par défaut 1,00 à 1,15 × la cible). */
  tolerance?: { low: number; high: number };
  /** Ignore les événements qui commencent dans moins de N minutes (par défaut 10). */
  minLeadMinutes?: number;
  now?: Date;
};

export type GeneratedCoupon =
  | {
      status: "ok";
      legs: Candidate[];
      totalOdds: number;
      /** Probabilité estimée que TOUTES les sélections passent. */
      probability: number;
      /** Probabilité implicite selon les cotes (marge incluse). */
      impliedProbability: number;
      expectedValue: number;
      oneIn: number;
    }
  | {
      status: "insufficient";
      reason: string;
      eligibleCount: number;
      maxReachableOdds: number;
    };

/** Résolution en log-cote : 0,002 ≈ 0,2 % d'écart de cote. */
const UNIT = 0.002;
const MAX_GROUPS = 120;
const MAX_OPTIONS_PER_EVENT = 4;

export const MIN_TARGET_ODDS = 1.2;
export const MAX_TARGET_ODDS = 1000;

/** Sélections éligibles selon le niveau de risque, les sports et l'heure de début. */
export function eligibleCandidates(candidates: Candidate[], options: GenerateOptions): Candidate[] {
  const rule = RISK_RULES[options.risk];
  const now = (options.now ?? new Date()).getTime();
  const lead = (options.minLeadMinutes ?? 10) * 60_000;
  const excluded = new Set(options.excludeKeys ?? []);
  const sports = options.sports?.length ? new Set(options.sports) : null;

  return candidates.filter(
    (c) =>
      !excluded.has(c.key) &&
      (!sports || sports.has(c.sport)) &&
      Date.parse(c.startsAt) - now >= lead &&
      Number.isFinite(c.odd) &&
      c.odd >= rule.minOdd &&
      c.odd <= rule.maxOdd &&
      c.probability >= rule.minProbability &&
      c.probability < 1 &&
      c.confidence >= rule.minConfidence &&
      expectedValue(c.probability, c.odd) >= rule.minEdge,
  );
}

/** Coût d'une sélection : probabilité perdue par unité de cote gagnée (plus petit = meilleur). */
function efficiency(c: Candidate): number {
  return -Math.log(c.probability) / Math.log(c.odd);
}

export function generateCoupon(candidates: Candidate[], options: GenerateOptions): GeneratedCoupon {
  const target = Math.min(MAX_TARGET_ODDS, Math.max(MIN_TARGET_ODDS, options.targetOdds));
  const rule = RISK_RULES[options.risk];
  const tolerance = options.tolerance ?? { low: 1, high: 1.15 };
  const eligible = eligibleCandidates(candidates, options);

  // Regroupe par événement (au plus une sélection par événement dans le coupon)
  const byEvent = new Map<number, Candidate[]>();
  for (const c of eligible) {
    const list = byEvent.get(c.eventId) ?? [];
    list.push(c);
    byEvent.set(c.eventId, list);
  }
  const groups = [...byEvent.values()]
    .map((options) => options.sort((a, b) => efficiency(a) - efficiency(b)).slice(0, MAX_OPTIONS_PER_EVENT))
    .sort((a, b) => efficiency(a[0]) - efficiency(b[0]))
    .slice(0, MAX_GROUPS);

  const maxReachableOdds = product(
    groups
      .map((g) => Math.max(...g.map((c) => c.odd)))
      .sort((a, b) => b - a)
      .slice(0, rule.maxLegs),
  );

  const low = target * tolerance.low;
  const high = target * tolerance.high;
  const lowB = Math.ceil(Math.log(low) / UNIT);
  const highB = Math.floor(Math.log(high) / UNIT);
  const K = rule.maxLegs;
  const B = highB;
  const width = B + 1;
  const NEG = -Infinity;

  // dp[k * width + b] = meilleure somme de ln(p) avec k sélections et un poids b
  let dp = new Float64Array((K + 1) * width).fill(NEG);
  dp[0] = 0;
  const choices: Uint8Array[] = [];

  for (const group of groups) {
    const next = Float64Array.from(dp); // option « ne rien prendre dans ce groupe »
    const choice = new Uint8Array((K + 1) * width);
    group.forEach((option, index) => {
      const w = Math.max(1, Math.round(Math.log(option.odd) / UNIT));
      const v = Math.log(option.probability);
      for (let k = K - 1; k >= 0; k--) {
        const row = k * width;
        const nextRow = (k + 1) * width;
        for (let b = 0; b + w <= B; b++) {
          const current = dp[row + b];
          if (current === NEG) continue;
          const candidate = current + v;
          if (candidate > next[nextRow + b + w]) {
            next[nextRow + b + w] = candidate;
            choice[nextRow + b + w] = index + 1;
          }
        }
      }
    });
    dp = next;
    choices.push(choice);
  }

  // Meilleur état dans la fourchette de cote ; à égalité, le moins de sélections.
  let best = { value: NEG, k: 0, b: 0 };
  for (let k = 1; k <= K; k++) {
    for (let b = Math.max(0, lowB); b <= B; b++) {
      const value = dp[k * width + b];
      if (value > best.value + 1e-12) best = { value, k, b };
    }
  }

  if (best.value === NEG) {
    return {
      status: "insufficient",
      eligibleCount: eligible.length,
      maxReachableOdds,
      reason:
        eligible.length === 0
          ? "Aucune sélection ne remplit les critères pour le moment."
          : maxReachableOdds < low
            ? `Avec ce niveau de risque, la cote maximale atteignable est d'environ ${maxReachableOdds.toFixed(2)}.`
            : "Impossible d'atteindre exactement cette cote avec les sélections disponibles.",
    };
  }

  // Reconstruction du coupon en remontant les choix
  const legs: Candidate[] = [];
  let { k, b } = best;
  for (let g = groups.length - 1; g >= 0 && k > 0; g--) {
    const picked = choices[g][k * width + b];
    if (picked > 0) {
      const option = groups[g][picked - 1];
      legs.push(option);
      k -= 1;
      b -= Math.max(1, Math.round(Math.log(option.odd) / UNIT));
    }
  }
  legs.sort((a, b2) => Date.parse(a.startsAt) - Date.parse(b2.startsAt));

  const totalOdds = product(legs.map((l) => l.odd));
  const probability = product(legs.map((l) => l.probability));
  return {
    status: "ok",
    legs,
    totalOdds,
    probability,
    impliedProbability: 1 / totalOdds,
    expectedValue: probability * totalOdds - 1,
    oneIn: oneIn(probability),
  };
}
