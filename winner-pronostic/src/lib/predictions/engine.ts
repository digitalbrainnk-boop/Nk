import type { SportCode } from "@/lib/sports/catalog";
import { type FootballOptions, baseballMarkets, footballMarkets, hockeyMarkets } from "./goals";
import { MARKETS_BY_SPORT, type ProbabilityMap, probabilityKey } from "./markets";
import { pointsMarkets, volleyballMarkets } from "./points";
import type { EngineResult } from "./types";

export const MODEL_VERSION: Record<SportCode, string> = {
  football: "dixon-coles-v1",
  ice_hockey: "poisson-v1",
  baseball: "poisson-v1",
  basketball: "normal-points-v1",
  handball: "normal-points-v1",
  rugby: "normal-points-v1",
  american_football: "normal-points-v1",
  volleyball: "sets-v1",
  tennis: "sets-v1",
};

/**
 * Calcule les probabilités de tous les marchés d'un événement.
 * `expectedHome` / `expectedAway` : buts ou points attendus ; pour le volley et
 * le tennis, `expectedHome` est la probabilité que l'équipe 1 gagne un set.
 */
export function computeMarkets(
  sport: SportCode,
  expectedHome: number,
  expectedAway: number,
  options: FootballOptions = {},
): EngineResult {
  let result: { markets: EngineResult["markets"]; scoreMatrix?: number[][] };
  switch (sport) {
    case "football":
      result = footballMarkets(expectedHome, expectedAway, options);
      break;
    case "ice_hockey":
      result = hockeyMarkets(expectedHome, expectedAway);
      break;
    case "baseball":
      result = baseballMarkets(expectedHome, expectedAway);
      break;
    case "basketball":
    case "handball":
    case "rugby":
    case "american_football":
      result = pointsMarkets(sport, expectedHome, expectedAway);
      break;
    case "volleyball":
    case "tennis":
      result = volleyballMarkets(expectedHome);
      break;
  }
  const allowed = new Set(MARKETS_BY_SPORT[sport]);
  return {
    markets: result.markets.filter((m) => allowed.has(m.market)),
    expected: { home: expectedHome, away: expectedAway },
    scoreMatrix: result.scoreMatrix,
  };
}

/** Dictionnaire à stocker dans predictions.probabilities (4 décimales). */
export function toProbabilityMap(result: EngineResult): ProbabilityMap {
  const map: ProbabilityMap = {};
  for (const m of result.markets) {
    if (m.probability > 0.0001 && m.probability < 0.9999) map[probabilityKey(m)] = Math.round(m.probability * 10000) / 10000;
  }
  return map;
}
