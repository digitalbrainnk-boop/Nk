import { clamp, discreteNormal, lineOutcome, probWhere, resolveTies } from "./math";
import type { Period } from "./markets";
import type { MarketProbability } from "./types";

/**
 * Sports « à points » (basketball, handball, rugby, football américain) :
 * l'écart et le total de points suivent approximativement des lois normales
 * centrées sur les points attendus de chaque équipe.
 */

export type PointsSport = "basketball" | "handball" | "rugby" | "american_football";

/** Écarts-types observés (ordre de grandeur des grands championnats). */
export const POINTS_PARAMS: Record<PointsSport, { sdMargin: number; sdTotal: number; sdTeam: number; hasDraw: boolean; halves: boolean }> = {
  basketball: { sdMargin: 12, sdTotal: 18, sdTeam: 11, hasDraw: false, halves: true },
  handball: { sdMargin: 4.5, sdTotal: 5.5, sdTeam: 4, hasDraw: true, halves: true },
  rugby: { sdMargin: 14, sdTotal: 13, sdTeam: 9, hasDraw: true, halves: false },
  american_football: { sdMargin: 13.5, sdTotal: 13.5, sdTeam: 9, hasDraw: false, halves: false },
};

/** Lignes « x,5 » autour d'une valeur attendue (ex. 214,5 … 234,5). */
const halfLinesAround = (center: number, spread: number) => {
  const out: number[] = [];
  const base = Math.floor(center) + 0.5;
  const n = Math.round(spread);
  for (let i = -n; i <= n; i++) out.push(base + i);
  return out;
};

export function pointsMarkets(sport: PointsSport, homePoints: number, awayPoints: number) {
  const params = POINTS_PARAMS[sport];
  const markets: MarketProbability[] = [];
  const push = (period: Period, market: MarketProbability["market"], line: number | null, selection: string, probability: number) =>
    markets.push({ period, market, line, selection, probability: clamp(probability, 0, 1), basis: "model" });

  const periods: { period: Period; factor: number }[] = [{ period: "FT", factor: 1 }];
  if (params.halves) periods.push({ period: "1H", factor: 0.5 });

  for (const { period, factor } of periods) {
    const sdScale = Math.sqrt(factor);
    const expectedMargin = (homePoints - awayPoints) * factor;
    const expectedTotal = (homePoints + awayPoints) * factor;
    const margin = discreteNormal(expectedMargin, params.sdMargin * sdScale);
    const total = discreteNormal(expectedTotal, params.sdTotal * sdScale);

    const home = probWhere(margin, (v) => v > 0);
    const draw = margin.get(0) ?? 0;
    push(period, "1X2", null, "1", home);
    push(period, "1X2", null, "X", draw);
    push(period, "1X2", null, "2", 1 - home - draw);
    if (params.hasDraw) {
      push(period, "DC", null, "1X", home + draw);
      push(period, "DC", null, "12", 1 - draw);
      push(period, "DC", null, "X2", 1 - home);
    }

    // Vainqueur prolongations incluses (FT seulement) : les égalités sont départagées
    const resolved = period === "FT" && !params.hasDraw ? resolveTies(margin, 0.5) : margin;
    if (period === "FT") {
      push(period, "ML", null, "1", probWhere(resolved, (v) => v > 0) + (params.hasDraw ? draw / 2 : 0));
      push(period, "ML", null, "2", probWhere(resolved, (v) => v < 0) + (params.hasDraw ? draw / 2 : 0));
    }

    for (const line of halfLinesAround(-expectedMargin, Math.max(3, params.sdMargin * sdScale * 0.75))) {
      const o1 = lineOutcome(resolved, line, (v, l) => v + l);
      const o2 = lineOutcome(resolved, line, (v, l) => -(v + l));
      push(period, "HCP", line, "1", o1.win);
      push(period, "HCP", line, "2", o2.win);
    }
    for (const line of halfLinesAround(expectedTotal, Math.max(3, params.sdTotal * sdScale * 0.6))) {
      push(period, "TOTAL", line, "OVER", probWhere(total, (v) => v > line));
      push(period, "TOTAL", line, "UNDER", probWhere(total, (v) => v < line));
    }
    const odd = probWhere(total, (v) => Math.abs(v % 2) === 1);
    push(period, "ODD_EVEN", null, "ODD", odd);
    push(period, "ODD_EVEN", null, "EVEN", 1 - odd);

    if (period === "FT") {
      for (const [market, mean] of [["TT1", homePoints], ["TT2", awayPoints]] as const) {
        const dist = discreteNormal(mean, params.sdTeam);
        for (const line of halfLinesAround(mean, Math.max(2, params.sdTeam * 0.6))) {
          push(period, market, line, "OVER", probWhere(dist, (v) => v > line));
          push(period, market, line, "UNDER", probWhere(dist, (v) => v < line));
        }
      }
    }
  }
  return { markets };
}

// ---------------------------------------------------------------------------
// Volleyball : match en 3 sets gagnants, p = probabilité que l'équipe 1 gagne un set
// ---------------------------------------------------------------------------

export function volleyballMarkets(setWinProbability: number) {
  const p = clamp(setWinProbability, 0.02, 0.98);
  const q = 1 - p;
  const scores: Record<string, number> = {
    "3-0": p ** 3,
    "3-1": 3 * p ** 3 * q,
    "3-2": 6 * p ** 3 * q ** 2,
    "0-3": q ** 3,
    "1-3": 3 * q ** 3 * p,
    "2-3": 6 * q ** 3 * p ** 2,
  };
  const markets: MarketProbability[] = [];
  const push = (period: Period, market: MarketProbability["market"], line: number | null, selection: string, probability: number) =>
    markets.push({ period, market, line, selection, probability: clamp(probability, 0, 1), basis: "model" });

  const home = scores["3-0"] + scores["3-1"] + scores["3-2"];
  push("FT", "ML", null, "1", home);
  push("FT", "ML", null, "2", 1 - home);
  for (const [score, prob] of Object.entries(scores)) push("FT", "CS", null, score, prob);
  // Handicap en sets (écart de sets du point de vue de l'équipe 1)
  const margin = new Map<number, number>([
    [3, scores["3-0"]],
    [2, scores["3-1"]],
    [1, scores["3-2"]],
    [-1, scores["2-3"]],
    [-2, scores["1-3"]],
    [-3, scores["0-3"]],
  ]);
  for (const line of [-2.5, -1.5, 1.5, 2.5]) {
    push("FT", "HCP", line, "1", probWhere(margin, (v) => v + line > 0));
    push("FT", "HCP", line, "2", probWhere(margin, (v) => v + line < 0));
  }
  // Nombre total de sets
  const fourOrMore = 1 - scores["3-0"] - scores["0-3"];
  const five = scores["3-2"] + scores["2-3"];
  push("FT", "TOTAL", 3.5, "OVER", fourOrMore);
  push("FT", "TOTAL", 3.5, "UNDER", 1 - fourOrMore);
  push("FT", "TOTAL", 4.5, "OVER", five);
  push("FT", "TOTAL", 4.5, "UNDER", 1 - five);
  push("S1", "ML", null, "1", p);
  push("S1", "ML", null, "2", q);
  return { markets };
}
