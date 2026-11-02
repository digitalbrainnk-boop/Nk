import { MARKET_INFO, type Market } from "./markets";

/**
 * Indice de confiance (1 à 5) d'une sélection : il combine la probabilité,
 * la quantité de données (matchs joués), le type de marché, la source du
 * calcul et l'accord entre notre modèle et le marché des bookmakers.
 */
export type ConfidenceInput = {
  probability: number;
  market?: Market;
  /** Nombre de matchs disponibles pour l'équipe la moins documentée. */
  sampleSize?: number;
  basis?: "model" | "league_average";
  /** Écart entre notre probabilité et la probabilité juste du bookmaker. */
  marketGap?: number | null;
  /** Ancien paramètre : espérance de gain (gardé pour compatibilité). */
  edge?: number | null;
};

export function confidenceScore(input: ConfidenceInput): number {
  const p = input.probability;
  let score = p >= 0.8 ? 5 : p >= 0.68 ? 4 : p >= 0.55 ? 3 : p >= 0.42 ? 2 : 1;
  if (input.sampleSize !== undefined && input.sampleSize < 6) score -= 1;
  if (input.market && MARKET_INFO[input.market].kind === "exotic") score -= 1;
  if (input.basis === "league_average") score -= 1;
  if (input.marketGap !== undefined && input.marketGap !== null && Math.abs(input.marketGap) > 0.12) score -= 1;
  if (input.edge !== undefined && input.edge !== null && input.edge < -0.05) score -= 1;
  return Math.max(1, Math.min(5, score));
}

/** Compatibilité : ancienne signature (probabilité, espérance). */
export function confidenceFrom(probability: number, edge: number | null): number {
  return confidenceScore({ probability, edge });
}
