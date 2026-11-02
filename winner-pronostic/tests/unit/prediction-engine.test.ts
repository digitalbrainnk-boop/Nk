import { describe, expect, it } from "vitest";
import { confidenceScore } from "@/lib/predictions/confidence";
import { computeMarkets, toProbabilityMap } from "@/lib/predictions/engine";
import { GOAL_INTERVALS, footballMarkets, scoreMatrix } from "@/lib/predictions/goals";
import type { Market, Period } from "@/lib/predictions/markets";
import { lineOutcome, normalCdf, poissonVector } from "@/lib/predictions/math";
import { estimateExpectedScores, estimateSetProbability } from "@/lib/predictions/strength";
import type { MarketProbability } from "@/lib/predictions/types";

function finder(markets: MarketProbability[]) {
  return (market: Market, selection: string, line: number | null = null, period: Period = "FT") => {
    const found = markets.find((m) => m.period === period && m.market === market && m.selection === selection && m.line === line);
    if (!found) throw new Error(`Marché introuvable : ${period} ${market} ${line} ${selection}`);
    return found;
  };
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("outils mathématiques", () => {
  it("Poisson et loi normale", () => {
    expect(sum(poissonVector(2.7, 10))).toBeCloseTo(1, 12);
    expect(poissonVector(1.5, 10)[0]).toBeCloseTo(Math.exp(-1.5), 12);
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it("gère les lignes asiatiques (quart de but)", () => {
    const totals = new Map([[0, 0.1], [1, 0.2], [2, 0.3], [3, 0.4]]);
    const over225 = lineOutcome(totals, 2.25, (v, l) => v - l);
    expect(over225.win).toBeCloseTo(0.4, 12); // 3 buts et plus
    expect(over225.halfLoss).toBeCloseTo(0.3, 12); // exactement 2 : moitié remboursée, moitié perdue
    expect(over225.loss).toBeCloseTo(0.3, 12);
    const over2 = lineOutcome(totals, 2, (v, l) => v - l);
    expect(over2.push).toBeCloseTo(0.3, 12);
  });
});

describe("modèle football (Dixon-Coles)", () => {
  const lambda = 1.85;
  const mu = 1.05;
  const { markets, scoreMatrix: matrix } = footballMarkets(lambda, mu);
  const p = finder(markets);

  it("produit une matrice de scores complète", () => {
    expect(sum(matrix.flat())).toBeCloseTo(1, 10);
    const dc = scoreMatrix(1.4, 1.1, -0.1);
    const plain = scoreMatrix(1.4, 1.1, 0);
    expect(dc[1][1]).toBeGreaterThan(plain[1][1]); // plus de 1-1 avec Dixon-Coles
    expect(dc[1][0]).toBeLessThan(plain[1][0]);
  });

  it("garde des marchés cohérents entre eux", () => {
    const home = p("1X2", "1").probability;
    const draw = p("1X2", "X").probability;
    const away = p("1X2", "2").probability;
    expect(home + draw + away).toBeCloseTo(1, 10);
    expect(home).toBeGreaterThan(away);
    expect(p("DC", "1X").probability).toBeCloseTo(home + draw, 10);
    expect(p("TOTAL", "OVER", 2.5).probability + p("TOTAL", "UNDER", 2.5).probability).toBeCloseTo(1, 10);
    expect(p("TOTAL", "OVER", 0.5).probability).toBeCloseTo(1 - matrix[0][0], 10);
    expect(p("HCP", "1", -0.5).probability).toBeCloseTo(home, 10);
    expect(p("HCP", "1", 0).outcome).toMatchObject({ win: expect.closeTo(home, 10), push: expect.closeTo(draw, 10) });
    expect(p("TT1", "OVER", 0.5).probability).toBeCloseTo(1 - p("CLEAN_SHEET", "2").probability, 10);
    expect(p("FIRST_GOAL", "1").probability + p("FIRST_GOAL", "2").probability + p("FIRST_GOAL", "NONE").probability).toBeCloseTo(1, 10);
  });

  it("calcule les combinés à partir de la même matrice", () => {
    const resTotal = ["1", "X", "2"].flatMap((r) => ["OVER", "UNDER"].map((s) => p("RES_TOTAL", `${r}&${s}`, 2.5).probability));
    expect(sum(resTotal)).toBeCloseTo(1, 10);
    const bttsYes = sum(["1", "X", "2"].map((r) => p("RES_BTTS", `${r}&YES`).probability));
    expect(bttsYes).toBeCloseTo(p("BTTS", "YES").probability, 10);
    expect(p("DC_BTTS", "1X&YES").probability).toBeCloseTo(p("RES_BTTS", "1&YES").probability + p("RES_BTTS", "X&YES").probability, 10);
    expect(p("WIN_NIL", "1").probability).toBeLessThan(p("CLEAN_SHEET", "1").probability);
  });

  it("calcule les mi-temps, MT-Fin et les intervalles de temps", () => {
    const htft = markets.filter((m) => m.market === "HTFT");
    expect(htft).toHaveLength(9);
    expect(sum(htft.map((m) => m.probability))).toBeCloseTo(1, 8);
    expect(sum(["1H", "2H", "EQ"].map((s) => p("HIGHEST_HALF", s).probability))).toBeCloseTo(1, 8);
    expect(p("1X2", "1", null, "1H").probability).toBeLessThan(home());
    // Aucun but dans les 6 intervalles = aucun but dans le match (Poisson)
    const noGoal = GOAL_INTERVALS.reduce((acc, i) => acc * p("GOAL_INTERVAL", `${i}:NO`).probability, 1);
    expect(noGoal).toBeCloseTo(Math.exp(-(lambda + mu)), 8);
    const firstHome = sum(GOAL_INTERVALS.map((i) => p("TEAM_FIRST_GOAL_INTERVAL", `1:${i}`).probability));
    expect(firstHome).toBeCloseTo(1 - Math.exp(-lambda), 8);
    function home() {
      return p("1X2", "1").probability;
    }
  });

  it("marque les pénaltys et expulsions comme estimations « moyenne de la ligue »", () => {
    expect(p("PENALTY", "YES").basis).toBe("league_average");
    expect(p("PEN_RED_COMBO", "NEITHER").probability + p("PEN_RED_COMBO", "PEN_OR_RED").probability).toBeCloseTo(1, 10);
  });

  it("ajoute buteurs, corners et cartons quand les données existent", () => {
    const rich = footballMarkets(1.6, 1.2, {
      scorers: [{ id: "9", name: "A. Isak", team: 1, goalShare: 0.35, minutesShare: 0.85 }],
      corners: { home: 5.8, away: 4.4 },
      cards: { home: 1.9, away: 2.2 },
    });
    const q = finder(rich.markets);
    expect(q("SCORER", "P9").probability).toBeCloseTo(1 - Math.exp(-1.6 * 0.35 * 0.85), 10);
    expect(q("CORNERS", "OVER", 9.5).probability + q("CORNERS", "UNDER", 9.5).probability).toBeCloseTo(1, 8);
    expect(q("CARDS", "OVER", 3.5).probability).toBeGreaterThan(0.4);
  });

  it("donne des probabilités symétriques pour deux équipes identiques", () => {
    const q = finder(footballMarkets(1.3, 1.3).markets);
    expect(q("1X2", "1").probability).toBeCloseTo(q("1X2", "2").probability, 10);
  });
});

describe("autres sports", () => {
  it("hockey : vainqueur prolongations incluses ≥ victoire en temps réglementaire", () => {
    const { markets } = computeMarkets("ice_hockey", 3.2, 2.6);
    const p = finder(markets);
    expect(p("ML", "1").probability + p("ML", "2").probability).toBeCloseTo(1, 10);
    expect(p("ML", "1").probability).toBeGreaterThan(p("1X2", "1").probability);
    expect(p("1X2", "1", null, "P1").probability).toBeGreaterThan(0);
  });

  it("baseball : pas de match nul", () => {
    const { markets } = computeMarkets("baseball", 4.6, 4.1);
    expect(markets.some((m) => m.market === "1X2")).toBe(false);
    const p = finder(markets);
    expect(p("ML", "1").probability + p("ML", "2").probability).toBeCloseTo(1, 10);
  });

  it("basketball : loi normale centrée sur les points attendus", () => {
    const { markets } = computeMarkets("basketball", 112, 112);
    const p = finder(markets);
    expect(p("ML", "1").probability).toBeCloseTo(0.5, 6);
    expect(p("TOTAL", "OVER", 224.5).probability).toBeCloseTo(0.488, 2);
    expect(markets.some((m) => m.market === "CS")).toBe(false);
    const strong = finder(computeMarkets("basketball", 118, 106).markets);
    expect(strong("ML", "1").probability).toBeGreaterThan(0.8);
    expect(strong("HCP", "1", -11.5).probability).toBeGreaterThan(0.45);
    expect(strong("HCP", "1", -11.5).probability).toBeLessThan(0.6);
  });

  it("handball : le match nul existe", () => {
    const p = finder(computeMarkets("handball", 29, 29).markets);
    expect(p("1X2", "X").probability).toBeGreaterThan(0.05);
    expect(p("1X2", "X").probability).toBeLessThan(0.12);
  });

  it("volleyball : sets gagnants", () => {
    const p = finder(computeMarkets("volleyball", 0.5, 0.5).markets);
    expect(p("ML", "1").probability).toBeCloseTo(0.5, 10);
    expect(p("TOTAL", "OVER", 4.5).probability).toBeCloseTo(0.375, 10);
    const scores = ["3-0", "3-1", "3-2", "0-3", "1-3", "2-3"].map((s) => p("CS", s).probability);
    expect(sum(scores)).toBeCloseTo(1, 10);
    expect(estimateSetProbability(0.7, 0.4, 0)).toBeGreaterThan(0.7);
    expect(estimateSetProbability(0.6, 0.6, 0)).toBeCloseTo(0.5, 10);
  });

  it("stocke les probabilités sous forme de dictionnaire « période|marché|ligne|sélection »", () => {
    const map = toProbabilityMap(computeMarkets("football", 1.7, 1.1));
    expect(map["FT|1X2||1"]).toBeGreaterThan(0.4);
    expect(map["FT|TOTAL|2.5|OVER"]).toBeGreaterThan(0.4);
    expect(map["1H|BTTS||YES"]).toBeGreaterThan(0);
    expect(Object.keys(map).length).toBeGreaterThan(200);
  });
});

describe("forces des équipes", () => {
  const base = {
    sport: "football" as const,
    league: { homeAvg: 1.55, awayAvg: 1.25 },
    home: { name: "Newcastle", venue: { played: 7, scored: 15, conceded: 6 } },
    away: { name: "Everton", venue: { played: 7, scored: 6, conceded: 12 } },
  };

  it("donne plus de buts à l'attaque forte face à une défense faible", () => {
    const r = estimateExpectedScores(base);
    expect(r.home).toBeGreaterThan(1.8);
    expect(r.away).toBeLessThan(1.1);
    expect(r.factors[0].detail).toMatch(/Newcastle marque 2,14 par match/);
  });

  it("revient vers la moyenne de la ligue sans données", () => {
    const r = estimateExpectedScores({
      ...base,
      home: { name: "A", venue: { played: 0, scored: 0, conceded: 0 } },
      away: { name: "B", venue: { played: 0, scored: 0, conceded: 0 } },
    });
    expect(r.home).toBeCloseTo(1.55, 10);
    expect(r.away).toBeCloseTo(1.25, 10);
  });

  it("tient compte de l'Elo, de la forme et des absences", () => {
    const ref = estimateExpectedScores(base);
    const elo = estimateExpectedScores({ ...base, home: { ...base.home, elo: 1800 }, away: { ...base.away, elo: 1600 } });
    expect(elo.home).toBeGreaterThan(ref.home);
    const injured = estimateExpectedScores({ ...base, home: { ...base.home, missingAttack: 0.4, absentPlayers: ["A. Isak"] } });
    expect(injured.home).toBeLessThan(ref.home);
    expect(injured.factors.find((f) => f.key === "absences")?.detail).toMatch(/Isak/);
    const hot = estimateExpectedScores({
      ...base,
      home: { ...base.home, overall: { played: 14, scored: 25, conceded: 14 }, recent: { scored: [3, 3, 2, 4, 3], conceded: [1, 0, 1, 1, 0], results: ["W", "W", "W", "W", "W"] } },
    });
    expect(hot.home).toBeGreaterThan(ref.home);
    expect(hot.factors.find((f) => f.key === "form")?.detail).toMatch(/WWWWW/);
  });
});

describe("indice de confiance", () => {
  it("baisse pour les marchés exotiques, les moyennes de ligue et le manque de données", () => {
    expect(confidenceScore({ probability: 0.82, market: "1X2" })).toBe(5);
    expect(confidenceScore({ probability: 0.82, market: "CS" })).toBe(4);
    expect(confidenceScore({ probability: 0.82, market: "PENALTY", basis: "league_average" })).toBe(3);
    expect(confidenceScore({ probability: 0.6, market: "TOTAL", sampleSize: 3 })).toBe(2);
    expect(confidenceScore({ probability: 0.6, market: "TOTAL", marketGap: 0.2 })).toBe(2);
    expect(confidenceScore({ probability: 0.2 })).toBe(1);
  });
});
