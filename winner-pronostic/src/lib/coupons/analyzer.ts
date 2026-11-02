import { DEFAULT_MARGIN, estimateFairProbability, expectedValue, oneIn, product } from "./odds";

/**
 * Analyse d'un coupon saisi par l'utilisateur.
 *
 * Pour chaque sélection on utilise la probabilité du modèle quand l'événement
 * est connu de l'application ; sinon une estimation tirée de la cote (marge
 * du bookmaker retirée). Le résultat est volontairement honnête : la chance
 * réelle de gagner, les sélections fragiles et ce que changerait leur retrait.
 */

export type AnalyzerLeg = {
  label: string;
  odd: number;
  /** Probabilité du modèle si l'événement est analysé par l'application. */
  probability?: number | null;
  /** Identifiant d'événement pour détecter les doublons. */
  eventKey?: string;
  startsAt?: string;
};

export type LegVerdict = "solide" | "correct" | "risque" | "a_eviter";

export type AnalyzedLeg = AnalyzerLeg & {
  impliedProbability: number;
  /** Probabilité retenue pour l'analyse (modèle, sinon estimation depuis la cote). */
  usedProbability: number;
  source: "modele" | "cote";
  edge: number | null;
  verdict: LegVerdict;
  reason: string;
};

export type CouponVerdict = "bon" | "moyen" | "faible" | "tres_faible";

export type Suggestion = {
  removeIndex: number;
  label: string;
  newOdds: number;
  newProbability: number;
};

export type CouponAnalysis = {
  legs: AnalyzedLeg[];
  totalOdds: number;
  impliedProbability: number;
  estimatedProbability: number;
  oneIn: number;
  /** Part des sélections analysées par le modèle (0 à 1). */
  modelCoverage: number;
  weakestIndex: number;
  verdict: CouponVerdict;
  headline: string;
  warnings: string[];
  suggestions: Suggestion[];
};

export const MAX_ANALYZED_LEGS = 30;

const pct = (p: number) => `${Math.round(p * 100)} %`;

function judgeLeg(leg: AnalyzerLeg, margin: number): AnalyzedLeg {
  const impliedProbability = 1 / leg.odd;
  const hasModel = typeof leg.probability === "number" && leg.probability > 0 && leg.probability < 1;
  const usedProbability = hasModel ? (leg.probability as number) : estimateFairProbability(leg.odd, margin);
  const edge = hasModel ? expectedValue(usedProbability, leg.odd) : null;

  let verdict: LegVerdict;
  let reason: string;
  if (edge !== null) {
    if (edge < -0.12 || usedProbability < 0.25) {
      verdict = "a_eviter";
      reason = `Notre modèle ne donne que ${pct(usedProbability)} de chances : la cote est trop basse pour le risque.`;
    } else if (usedProbability >= 0.7 && edge >= -0.02) {
      verdict = "solide";
      reason = `${pct(usedProbability)} de chances selon notre modèle${edge > 0.03 ? ", et la cote est intéressante" : ""}.`;
    } else if (usedProbability >= 0.5 && edge >= -0.05) {
      verdict = "correct";
      reason = `${pct(usedProbability)} de chances selon notre modèle.`;
    } else {
      verdict = "risque";
      reason = `Seulement ${pct(usedProbability)} de chances selon notre modèle.`;
    }
  } else if (leg.odd <= 1.35) {
    verdict = "solide";
    reason = `Cote basse : environ ${pct(usedProbability)} de chances selon le bookmaker.`;
  } else if (leg.odd <= 1.8) {
    verdict = "correct";
    reason = `Environ ${pct(usedProbability)} de chances selon le bookmaker.`;
  } else if (leg.odd <= 3) {
    verdict = "risque";
    reason = `Cote élevée : environ ${pct(usedProbability)} de chances selon le bookmaker.`;
  } else {
    verdict = "a_eviter";
    reason = `Très incertain : environ ${pct(usedProbability)} de chances selon le bookmaker.`;
  }

  return { ...leg, impliedProbability, usedProbability, source: hasModel ? "modele" : "cote", edge, verdict, reason };
}

function couponVerdict(p: number): { verdict: CouponVerdict; headline: string } {
  const chance = `environ 1 chance sur ${oneIn(p).toLocaleString("fr-FR")}`;
  if (p >= 0.4) return { verdict: "bon", headline: `Coupon raisonnable : ${chance} de passer.` };
  if (p >= 0.2) return { verdict: "moyen", headline: `Coupon moyen : ${chance} de passer.` };
  if (p >= 0.08) return { verdict: "faible", headline: `Coupon risqué : ${chance} de passer.` };
  return { verdict: "tres_faible", headline: `Coupon très risqué : ${chance} de passer.` };
}

export function analyzeCoupon(input: AnalyzerLeg[], options: { margin?: number; now?: Date } = {}): CouponAnalysis {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const now = (options.now ?? new Date()).getTime();
  const legs = input.slice(0, MAX_ANALYZED_LEGS).map((leg) => judgeLeg(leg, margin));

  const totalOdds = product(legs.map((l) => l.odd));
  const estimatedProbability = product(legs.map((l) => l.usedProbability));
  const modelCoverage = legs.length ? legs.filter((l) => l.source === "modele").length / legs.length : 0;

  let weakestIndex = -1;
  legs.forEach((leg, i) => {
    if (weakestIndex === -1 || leg.usedProbability < legs[weakestIndex].usedProbability) weakestIndex = i;
  });

  const warnings: string[] = [];
  if (input.length > MAX_ANALYZED_LEGS) warnings.push(`Seules les ${MAX_ANALYZED_LEGS} premières sélections ont été analysées.`);
  const keys = legs.map((l) => l.eventKey).filter(Boolean);
  if (new Set(keys).size !== keys.length) {
    warnings.push("Deux sélections portent sur le même match : elles sont liées et souvent refusées par les bookmakers.");
  }
  if (legs.some((l) => l.startsAt && Date.parse(l.startsAt) <= now)) {
    warnings.push("Au moins un match a déjà commencé : la cote a pu changer.");
  }
  if (legs.length > 8) {
    warnings.push(`${legs.length} sélections : chaque sélection ajoutée multiplie la marge du bookmaker et réduit vos chances.`);
  }
  if (legs.length > 0 && modelCoverage < 1) {
    warnings.push(
      modelCoverage === 0
        ? "Analyse basée sur les cotes uniquement : ces matchs ne sont pas encore couverts par notre modèle."
        : "Certaines sélections sont analysées à partir des cotes seulement (matchs non couverts par notre modèle).",
    );
  }

  // Suggestions : retirer les sélections fragiles, des plus faibles aux moins faibles
  const suggestions: Suggestion[] = legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => legs.length > 1 && (leg.verdict === "risque" || leg.verdict === "a_eviter"))
    .sort((a, b) => a.leg.usedProbability - b.leg.usedProbability)
    .slice(0, 2)
    .map(({ leg, index }) => ({
      removeIndex: index,
      label: leg.label,
      newOdds: totalOdds / leg.odd,
      newProbability: estimatedProbability / leg.usedProbability,
    }));

  const { verdict, headline } = couponVerdict(estimatedProbability);
  return {
    legs,
    totalOdds,
    impliedProbability: legs.length ? 1 / totalOdds : 0,
    estimatedProbability,
    oneIn: oneIn(estimatedProbability),
    modelCoverage,
    weakestIndex,
    verdict,
    headline,
    warnings,
    suggestions,
  };
}
