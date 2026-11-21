import { describe, expect, it } from "vitest";
import { type FinishedGame, buildStrengthInput, computeElo, headToHead, leagueAverages, recentForm, setWinRate, teamSplit } from "@/lib/predictions/history";
import type { Market, Period } from "@/lib/predictions/markets";
import { bestPick } from "@/lib/predictions/pipeline";
import { type SettleInput, couponResult, settleSelection } from "@/lib/predictions/settle";
import { estimateExpectedScores } from "@/lib/predictions/strength";

let id = 0;
const game = (home: number, away: number, hs: number, as: number, day: number, competitionId = 1): FinishedGame => ({
  id: ++id,
  sport: "football",
  competitionId,
  startsAt: new Date(Date.UTC(2026, 8, 1) + day * 86_400_000).toISOString(),
  homeTeamId: home,
  awayTeamId: away,
  homeScore: hs,
  awayScore: as,
});

describe("historique des équipes", () => {
  // Équipe 1 forte, équipe 3 faible
  const history: FinishedGame[] = [
    game(1, 2, 3, 0, 1),
    game(3, 1, 0, 2, 2),
    game(1, 3, 4, 1, 3),
    game(2, 3, 2, 2, 4),
    game(3, 2, 1, 3, 5),
    game(1, 2, 1, 1, 6),
    game(2, 1, 0, 1, 7),
  ];

  it("classe les équipes avec Elo", () => {
    const elo = computeElo(history);
    expect(elo.get(1)!).toBeGreaterThan(elo.get(2)!);
    expect(elo.get(2)!).toBeGreaterThan(elo.get(3)!);
    // Somme constante : Elo redistribue les points
    expect(elo.get(1)! + elo.get(2)! + elo.get(3)!).toBeCloseTo(4500, 6);
  });

  it("calcule les bilans domicile / extérieur, la forme et les confrontations", () => {
    expect(teamSplit(history, 1, "home")).toEqual({ played: 3, scored: 8, conceded: 2 });
    expect(teamSplit(history, 1, "away")).toEqual({ played: 2, scored: 3, conceded: 0 });
    expect(recentForm(history, 1, 3)).toEqual({ scored: [1, 1, 4], conceded: [0, 1, 1], results: ["W", "D", "W"] });
    expect(headToHead(history, 1, 2)).toEqual({ played: 3, homeWins: 2, draws: 1, awayWins: 0, avgGoals: 2 });
  });

  it("utilise les moyennes par défaut quand la ligue a peu de matchs", () => {
    expect(leagueAverages(history, "football", 1)).toMatchObject({ homeAvg: 1.5, awayAvg: 1.2, sample: 7 });
    const many = Array.from({ length: 30 }, (_, i) => game(10 + (i % 5), 20 + (i % 5), 2, 1, i, 9));
    expect(leagueAverages(many, "football", 9)).toMatchObject({ homeAvg: 2, awayAvg: 1 });
  });

  it("donne plus de buts attendus à l'équipe forte", () => {
    const elo = computeElo(history);
    const input = buildStrengthInput({ sport: "football", competitionId: 1, homeTeamId: 1, awayTeamId: 3, homeName: "Fort", awayName: "Faible" }, history, elo);
    const result = estimateExpectedScores(input);
    expect(result.home).toBeGreaterThan(result.away);
    expect(input.home.recent?.results).toEqual(["W", "D", "W", "W", "W"]);
  });

  it("volleyball : part de sets gagnés ramenée vers 50 % avec peu de données", () => {
    const volley: FinishedGame[] = [{ ...game(1, 2, 3, 0, 1), sport: "volleyball" }];
    expect(setWinRate(volley, 1)).toBeCloseTo(8 / 13, 10);
    expect(setWinRate([], 5)).toBe(0.5);
  });
});

describe("règlement des résultats", () => {
  const base = (period: Period, market: Market, line: number | null, selection: string, over: Partial<SettleInput> = {}): SettleInput => ({
    sport: "football",
    ref: { period, market, line, selection },
    status: "finished",
    homeScore: 2,
    awayScore: 1,
    periodScores: { ht: [1, 1], ft: [2, 1] },
    incidents: null,
    ...over,
  });

  it.each([
    ["FT", "1X2", null, "1", "won"],
    ["FT", "1X2", null, "X", "lost"],
    ["FT", "DC", null, "X2", "lost"],
    ["FT", "TOTAL", 2.5, "OVER", "won"],
    ["FT", "TOTAL", 3, "UNDER", "void"],
    ["FT", "TT2", 0.5, "OVER", "won"],
    ["FT", "HCP", -1.5, "1", "lost"],
    ["FT", "HCP", -1, "1", "void"],
    ["FT", "HCP", 1.5, "2", "lost"], // équipe 1 +1,5 : l'équipe 2 (−1,5) perd sur un 2-1
    ["FT", "HCP", -1.5, "2", "won"], // équipe 2 +1,5 gagne sur un 2-1
    ["FT", "BTTS", null, "YES", "won"],
    ["FT", "CS", null, "2-1", "won"],
    ["FT", "ODD_EVEN", null, "ODD", "won"],
    ["FT", "RES_TOTAL", 2.5, "1&OVER", "won"],
    ["FT", "DC_BTTS", null, "1X&YES", "won"],
    ["FT", "HTFT", null, "X/1", "won"],
    ["FT", "SCORE_BOTH_HALVES", null, "YES", "won"],
    ["FT", "TEAM_SCORE_BOTH_HALVES", null, "2:YES", "lost"],
    ["FT", "WIN_EITHER_HALF", null, "1", "won"],
    ["FT", "HIGHEST_HALF", null, "1H", "won"], // 1-1 à la pause, 1-0 en 2e mi-temps
    ["FT", "WIN_NIL", null, "1", "lost"],
    ["1H", "1X2", null, "X", "won"],
    ["2H", "TOTAL", 0.5, "OVER", "won"],
    ["2H", "1X2", null, "1", "won"],
  ] as const)("%s %s %s %s → %s", (period, market, line, selection, expected) => {
    expect(settleSelection(base(period, market, line, selection))).toBe(expected);
  });

  it("ignore les prolongations pour les marchés du temps réglementaire (football)", () => {
    const aet = base("FT", "1X2", null, "X", { homeScore: 3, awayScore: 2, periodScores: { ht: [0, 0], ft: [2, 2], et: [1, 0] } });
    expect(settleSelection(aet)).toBe("won");
  });

  it("utilise le score final pour le vainqueur et le temps réglementaire pour le 1X2 (hockey)", () => {
    const hockey = (market: Market, selection: string) =>
      settleSelection({
        sport: "ice_hockey",
        ref: { period: "FT", market, line: null, selection },
        status: "finished",
        homeScore: 4,
        awayScore: 3,
        periodScores: { p1: [1, 1], p2: [1, 1], p3: [1, 1], ot: [1, 0] },
        incidents: null,
      });
    expect(hockey("ML", "1")).toBe("won");
    expect(hockey("1X2", "X")).toBe("won");
  });

  it("règle premier but, intervalles, pénaltys et cartons avec les faits de match", () => {
    const incidents = [
      { minute: 12, extraMinute: null, type: "Goal", detail: "Normal Goal", side: 2 as const },
      { minute: 55, extraMinute: null, type: "Goal", detail: "Penalty", side: 1 as const },
      { minute: 80, extraMinute: null, type: "Goal", detail: "Normal Goal", side: 1 as const },
      { minute: 85, extraMinute: null, type: "Card", detail: "Red Card", side: 2 as const },
    ];
    const s = (market: Market, selection: string) => settleSelection(base("FT", market, null, selection, { incidents }));
    expect(s("FIRST_GOAL", "2")).toBe("won");
    expect(s("GOAL_INTERVAL", "1-15:YES")).toBe("won");
    expect(s("GOAL_INTERVAL", "16-30:YES")).toBe("lost");
    expect(s("TEAM_FIRST_GOAL_INTERVAL", "1:46-60")).toBe("won");
    expect(s("PENALTY", "YES")).toBe("won");
    expect(s("PEN_RED_COMBO", "PEN_AND_RED")).toBe("won");
    // Sans faits de match : impossible à déterminer
    expect(settleSelection(base("FT", "FIRST_GOAL", null, "1"))).toBeNull();
  });

  it("rembourse les matchs annulés et attend les matchs non terminés", () => {
    expect(settleSelection(base("FT", "1X2", null, "1", { status: "cancelled" }))).toBe("void");
    expect(settleSelection(base("FT", "1X2", null, "1", { status: "live" }))).toBeNull();
    expect(settleSelection(base("FT", "CORNERS", 9.5, "OVER"))).toBeNull();
  });

  it("calcule le résultat d'un coupon", () => {
    expect(couponResult(["won", "won"])).toBe("won");
    expect(couponResult(["won", "pending"])).toBe("pending");
    expect(couponResult(["pending", "lost"])).toBe("lost");
    expect(couponResult(["void", "won"])).toBe("won");
    expect(couponResult(["void", "void"])).toBe("void");
  });
});

describe("choix du pronostic publié", () => {
  const probabilities = {
    "FT|1X2||1": 0.62,
    "FT|DC||1X": 0.84,
    "FT|TOTAL|2.5|OVER": 0.58,
    "FT|TOTAL|2|OVER": 0.7, // ligne entière : exclue
    "FT|CS||1-0": 0.12, // marché exotique : exclu
    "FT|DNB||1": 0.76, // remboursable : exclu
  };

  it("choisit la sélection la plus solide avec une cote utile", () => {
    const pick = bestPick(probabilities, [
      { key: "FT|1X2||1", odd: 1.75, bookmaker: "1xBet" },
      { key: "FT|DC||1X", odd: 1.15, bookmaker: "1xBet" }, // cote trop basse (< 1,25)
      { key: "FT|TOTAL|2.5|OVER", odd: 1.8, bookmaker: "1xBet" },
      { key: "FT|1X2||1", odd: 1.8, bookmaker: "Bet365" },
    ]);
    expect(pick).toMatchObject({ key: "FT|1X2||1", odd: 1.8, bookmaker: "Bet365" });
    expect(pick!.edge).toBeCloseTo(0.62 * 1.8 - 1, 10);
  });

  it("sans cotes, garde le marché classique le plus sûr", () => {
    expect(bestPick(probabilities, [])?.key).toBe("FT|DC||1X");
  });

  it("ne publie rien si aucune sélection ne convient", () => {
    expect(bestPick({ "FT|1X2||1": 0.3 }, [{ key: "FT|1X2||1", odd: 2, bookmaker: "x" }])).toBeNull();
  });
});
