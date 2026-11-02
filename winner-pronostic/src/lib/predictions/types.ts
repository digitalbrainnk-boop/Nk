import type { LineOutcome } from "./math";
import type { SelectionRef } from "./markets";

/** Probabilité calculée par un modèle pour une sélection. */
export type MarketProbability = SelectionRef & {
  /** Probabilité que le pari soit gagnant (au moins à moitié pour les lignes asiatiques). */
  probability: number;
  /** Détail pour les paris pouvant être remboursés (lignes entières, asiatiques, « remboursé si nul »). */
  outcome?: LineOutcome;
  /** model = calculé à partir des forces des équipes ; league_average = moyennes de la ligue (moins précis). */
  basis: "model" | "league_average";
};

export type EngineResult = {
  markets: MarketProbability[];
  /** Buts / points attendus (ou probabilité de gagner un set pour le volley). */
  expected: { home: number; away: number };
  /** Matrice des scores (sports à buts), pour la grille des scores exacts. */
  scoreMatrix?: number[][];
};
