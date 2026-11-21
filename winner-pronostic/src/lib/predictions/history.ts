import type { SportCode } from "@/lib/sports/catalog";
import type { MatchContext } from "./report";
import type { StrengthInput, TeamSplit } from "./strength";

/**
 * Statistiques calculées à partir de l'historique des matchs terminés :
 * classement Elo, forces à domicile / à l'extérieur, forme récente,
 * moyennes de la ligue et confrontations directes. Fonctions pures.
 */

export type FinishedGame = {
  id: number;
  sport: SportCode;
  competitionId: number;
  startsAt: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
};

const ELO_PARAMS: Record<SportCode, { k: number; homeAdvantage: number; marginScale: number }> = {
  football: { k: 20, homeAdvantage: 60, marginScale: 1 },
  ice_hockey: { k: 14, homeAdvantage: 40, marginScale: 1 },
  handball: { k: 16, homeAdvantage: 60, marginScale: 4 },
  basketball: { k: 12, homeAdvantage: 80, marginScale: 8 },
  volleyball: { k: 16, homeAdvantage: 40, marginScale: 1 },
  rugby: { k: 18, homeAdvantage: 60, marginScale: 7 },
  baseball: { k: 8, homeAdvantage: 25, marginScale: 2 },
  american_football: { k: 14, homeAdvantage: 55, marginScale: 7 },
  tennis: { k: 20, homeAdvantage: 0, marginScale: 1 },
};

/** Classement Elo de chaque équipe après tous les matchs (ordre chronologique). */
export function computeElo(games: FinishedGame[], initial = 1500): Map<number, number> {
  const ratings = new Map<number, number>();
  const sorted = [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const g of sorted) {
    const p = ELO_PARAMS[g.sport];
    const rh = ratings.get(g.homeTeamId) ?? initial;
    const ra = ratings.get(g.awayTeamId) ?? initial;
    const expected = 1 / (1 + 10 ** ((ra - rh - p.homeAdvantage) / 400));
    const result = g.homeScore > g.awayScore ? 1 : g.homeScore === g.awayScore ? 0.5 : 0;
    const margin = Math.abs(g.homeScore - g.awayScore) / p.marginScale;
    const multiplier = Math.min(2.5, Math.log(margin + 1) + 1);
    const delta = p.k * multiplier * (result - expected);
    ratings.set(g.homeTeamId, rh + delta);
    ratings.set(g.awayTeamId, ra - delta);
  }
  return ratings;
}

/** Moyennes par défaut (marqués par l'équipe qui reçoit / qui se déplace) si l'historique est trop court. */
export const DEFAULT_LEAGUE_AVERAGES: Record<SportCode, { homeAvg: number; awayAvg: number }> = {
  football: { homeAvg: 1.5, awayAvg: 1.2 },
  ice_hockey: { homeAvg: 3.2, awayAvg: 2.9 },
  handball: { homeAvg: 29, awayAvg: 27.5 },
  basketball: { homeAvg: 112, awayAvg: 109 },
  volleyball: { homeAvg: 1.9, awayAvg: 1.6 },
  rugby: { homeAvg: 25, awayAvg: 20 },
  baseball: { homeAvg: 4.6, awayAvg: 4.3 },
  american_football: { homeAvg: 23.5, awayAvg: 21.5 },
  tennis: { homeAvg: 1.5, awayAvg: 1.5 },
};

export function leagueAverages(history: FinishedGame[], sport: SportCode, competitionId: number) {
  const games = history.filter((g) => g.competitionId === competitionId);
  if (games.length < 20) return { ...DEFAULT_LEAGUE_AVERAGES[sport], sample: games.length };
  const homeAvg = games.reduce((s, g) => s + g.homeScore, 0) / games.length;
  const awayAvg = games.reduce((s, g) => s + g.awayScore, 0) / games.length;
  return { homeAvg, awayAvg, sample: games.length };
}

/** Bilan d'une équipe à domicile ou à l'extérieur (derniers matchs, même compétition si possible). */
export function teamSplit(history: FinishedGame[], teamId: number, venue: "home" | "away" | "all", competitionId?: number, max = 19): TeamSplit {
  const pick = (games: FinishedGame[]) =>
    games
      .filter((g) => (venue === "home" ? g.homeTeamId === teamId : venue === "away" ? g.awayTeamId === teamId : g.homeTeamId === teamId || g.awayTeamId === teamId))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, max);
  let games = competitionId !== undefined ? pick(history.filter((g) => g.competitionId === competitionId)) : [];
  if (games.length < 4) games = pick(history);
  const split: TeamSplit = { played: 0, scored: 0, conceded: 0 };
  for (const g of games) {
    const isHome = g.homeTeamId === teamId;
    split.played += 1;
    split.scored += isHome ? g.homeScore : g.awayScore;
    split.conceded += isHome ? g.awayScore : g.homeScore;
  }
  return split;
}

/** Forme sur les n derniers matchs (du plus récent au plus ancien). */
export function recentForm(history: FinishedGame[], teamId: number, n = 5) {
  const games = history
    .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, n);
  const scored: number[] = [];
  const conceded: number[] = [];
  const results: ("W" | "D" | "L")[] = [];
  for (const g of games) {
    const isHome = g.homeTeamId === teamId;
    const s = isHome ? g.homeScore : g.awayScore;
    const c = isHome ? g.awayScore : g.homeScore;
    scored.push(s);
    conceded.push(c);
    results.push(s > c ? "W" : s === c ? "D" : "L");
  }
  return { scored, conceded, results };
}

/** Confrontations directes (victoires comptées pour l'équipe 1 et l'équipe 2 du match à venir). */
export function headToHead(history: FinishedGame[], homeTeamId: number, awayTeamId: number, n = 10): NonNullable<MatchContext["h2h"]> {
  const games = history
    .filter((g) => (g.homeTeamId === homeTeamId && g.awayTeamId === awayTeamId) || (g.homeTeamId === awayTeamId && g.awayTeamId === homeTeamId))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, n);
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let goals = 0;
  for (const g of games) {
    goals += g.homeScore + g.awayScore;
    const winner = g.homeScore > g.awayScore ? g.homeTeamId : g.homeScore < g.awayScore ? g.awayTeamId : null;
    if (winner === homeTeamId) homeWins += 1;
    else if (winner === awayTeamId) awayWins += 1;
    else draws += 1;
  }
  return { played: games.length, homeWins, draws, awayWins, avgGoals: games.length ? goals / games.length : 0 };
}

export type UpcomingEvent = {
  sport: SportCode;
  competitionId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeName: string;
  awayName: string;
};

/** Données d'entrée du modèle de forces pour un match à venir. */
export function buildStrengthInput(event: UpcomingEvent, history: FinishedGame[], elo: Map<number, number>): StrengthInput {
  const league = leagueAverages(history, event.sport, event.competitionId);
  const homeForm = recentForm(history, event.homeTeamId);
  const awayForm = recentForm(history, event.awayTeamId);
  return {
    sport: event.sport,
    league: { homeAvg: league.homeAvg, awayAvg: league.awayAvg },
    home: {
      name: event.homeName,
      venue: teamSplit(history, event.homeTeamId, "home", event.competitionId),
      overall: teamSplit(history, event.homeTeamId, "all", event.competitionId),
      recent: homeForm.scored.length ? homeForm : undefined,
      elo: elo.get(event.homeTeamId) ?? null,
    },
    away: {
      name: event.awayName,
      venue: teamSplit(history, event.awayTeamId, "away", event.competitionId),
      overall: teamSplit(history, event.awayTeamId, "all", event.competitionId),
      recent: awayForm.scored.length ? awayForm : undefined,
      elo: elo.get(event.awayTeamId) ?? null,
    },
  };
}

/** Volleyball : part des sets gagnés par une équipe sur ses derniers matchs. */
export function setWinRate(history: FinishedGame[], teamId: number, max = 20): number {
  const games = history
    .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, max);
  let won = 0;
  let total = 0;
  for (const g of games) {
    const isHome = g.homeTeamId === teamId;
    won += isHome ? g.homeScore : g.awayScore;
    total += g.homeScore + g.awayScore;
  }
  // Retour vers 50 % quand il y a peu de sets joués
  return (won + 5) / (total + 10);
}
