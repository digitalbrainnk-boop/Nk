import type { Market } from "./markets";
import type { ReportInput } from "./report";
import { estimateExpectedScores } from "./strength";

/**
 * Exemple FICTIF (statistiques, cotes et joueurs inventés) pour présenter le
 * rapport d'analyse avant la synchronisation des vraies données.
 */
export function exampleFootballReportInput(): ReportInput {
  const strength = estimateExpectedScores({
    sport: "football",
    league: { homeAvg: 1.58, awayAvg: 1.27 },
    home: {
      name: "Newcastle",
      venue: { played: 5, scored: 11, conceded: 4 },
      overall: { played: 10, scored: 18, conceded: 10 },
      recent: { scored: [2, 1, 3, 0, 2], conceded: [0, 1, 1, 1, 0], results: ["W", "D", "W", "L", "W"] },
      elo: 1785,
      missingAttack: 0.12,
      absentPlayers: ["un milieu offensif titulaire (blessé)"],
    },
    away: {
      name: "Everton",
      venue: { played: 5, scored: 5, conceded: 8 },
      overall: { played: 10, scored: 11, conceded: 13 },
      recent: { scored: [1, 0, 2, 1, 0], conceded: [2, 1, 2, 1, 1], results: ["L", "D", "W", "D", "L"] },
      elo: 1640,
      missingDefense: 0.1,
      absentPlayers: ["un défenseur central (suspendu)"],
    },
  });

  const o = (period: "FT" | "1H", market: Market, line: number | null, selection: string, odd: number) => ({
    period,
    market,
    line,
    selection,
    odd,
    bookmaker: "Exemple",
  });

  return {
    sport: "football",
    teams: { home: "Newcastle", away: "Everton" },
    expected: { home: strength.home, away: strength.away },
    strength,
    context: {
      standings: { homeRank: 5, awayRank: 14, homePoints: 18, awayPoints: 11 },
      h2h: { played: 10, homeWins: 6, draws: 2, awayWins: 2, avgGoals: 2.6 },
    },
    options: {
      corners: { home: 6.1, away: 4.3 },
      cards: { home: 1.8, away: 2.1 },
      scorers: [
        { id: "1", name: "M. Traoré", team: 1, goalShare: 0.33, minutesShare: 0.85 },
        { id: "2", name: "S. Koné", team: 1, goalShare: 0.14, minutesShare: 0.7 },
        { id: "3", name: "A. Sawadogo", team: 2, goalShare: 0.3, minutesShare: 0.8 },
      ],
    },
    playerNames: { P1: "M. Traoré", P2: "S. Koné", P3: "A. Sawadogo" },
    odds: [
      o("FT", "1X2", null, "1", 1.6),
      o("FT", "1X2", null, "X", 4.1),
      o("FT", "1X2", null, "2", 5.4),
      o("FT", "DC", null, "1X", 1.14),
      o("FT", "BTTS", null, "YES", 1.85),
      o("FT", "BTTS", null, "NO", 1.95),
      o("FT", "TOTAL", 1.5, "OVER", 1.25),
      o("FT", "TOTAL", 2.5, "OVER", 1.72),
      o("FT", "TOTAL", 2.5, "UNDER", 2.12),
      o("FT", "TT1", 1.5, "OVER", 1.85),
      o("FT", "HCP", -1.5, "1", 2.75),
      o("FT", "RES_TOTAL", 2.5, "1&OVER", 2.45),
      o("FT", "HTFT", null, "1/1", 2.55),
      o("FT", "CS", null, "2-0", 8.5),
      o("FT", "FIRST_GOAL", null, "1", 1.5),
      o("1H", "1X2", null, "1", 2.2),
    ],
  };
}
