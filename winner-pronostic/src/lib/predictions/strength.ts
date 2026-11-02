import type { SportCode } from "@/lib/sports/catalog";
import { clamp } from "./math";

/**
 * Estimation des buts (ou points) attendus de chaque équipe à partir de ses
 * statistiques : forces offensive et défensive à domicile / à l'extérieur
 * (rapportées à la moyenne de la ligue), puis ajustements Elo, forme récente
 * et absences. Chaque ajustement est conservé pour expliquer le pronostic.
 */

export type TeamSplit = { played: number; scored: number; conceded: number };

export type TeamStrengthInput = {
  name: string;
  /** Matchs à domicile (pour l'équipe 1) ou à l'extérieur (pour l'équipe 2). */
  venue: TeamSplit;
  /** Tous les matchs de la saison (repli quand l'échantillon du lieu est faible). */
  overall?: TeamSplit;
  /** Buts marqués / encaissés lors des derniers matchs (du plus récent au plus ancien). */
  recent?: { scored: number[]; conceded: number[]; results?: ("W" | "D" | "L")[] };
  elo?: number | null;
  /** Part des buts de l'équipe marqués par les joueurs absents (0 à 0,6). */
  missingAttack?: number;
  /** Impact des absents en défense (gardien, défenseurs titulaires) : 0 à 0,4. */
  missingDefense?: number;
  absentPlayers?: string[];
};

export type StrengthInput = {
  sport: SportCode;
  /** Moyennes de la ligue par match : buts/points marqués par l'équipe qui reçoit et par celle qui se déplace. */
  league: { homeAvg: number; awayAvg: number };
  home: TeamStrengthInput;
  away: TeamStrengthInput;
};

export type Factor = { key: string; label: string; detail: string; homeMultiplier: number; awayMultiplier: number };

export type StrengthResult = { home: number; away: number; factors: Factor[]; sampleSize: number };

const SPORT_TUNING: Partial<Record<SportCode, { prior: number; elo: number; form: number; bounds: [number, number] }>> = {
  football: { prior: 6, elo: 0.3, form: 0.25, bounds: [0.2, 4.5] },
  ice_hockey: { prior: 8, elo: 0.25, form: 0.2, bounds: [0.8, 6] },
  baseball: { prior: 10, elo: 0.2, form: 0.15, bounds: [1.5, 9] },
  handball: { prior: 6, elo: 0.06, form: 0.15, bounds: [15, 45] },
  basketball: { prior: 8, elo: 0.05, form: 0.15, bounds: [60, 140] },
  rugby: { prior: 6, elo: 0.2, form: 0.15, bounds: [5, 60] },
  american_football: { prior: 4, elo: 0.15, form: 0.15, bounds: [7, 45] },
};

const perGame = (s: TeamSplit, key: "scored" | "conceded") => (s.played > 0 ? s[key] / s.played : NaN);

/** Rapport « force / moyenne de la ligue », ramené vers 1 quand il y a peu de matchs. */
function shrunkRatio(value: number, average: number, played: number, prior: number): number {
  if (!Number.isFinite(value) || average <= 0) return 1;
  return (played * (value / average) + prior) / (played + prior);
}

const pct = (x: number) => `${x >= 1 ? "+" : "−"}${Math.abs(Math.round((x - 1) * 100))} %`;
const num = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export function estimateExpectedScores(input: StrengthInput): StrengthResult {
  const tuning = SPORT_TUNING[input.sport] ?? SPORT_TUNING.football!;
  const { league, home, away } = input;
  const factors: Factor[] = [];

  // 1. Forces offensives et défensives selon le lieu du match
  const attackHome = shrunkRatio(perGame(home.venue, "scored"), league.homeAvg, home.venue.played, tuning.prior);
  const defenseAway = shrunkRatio(perGame(away.venue, "conceded"), league.homeAvg, away.venue.played, tuning.prior);
  const attackAway = shrunkRatio(perGame(away.venue, "scored"), league.awayAvg, away.venue.played, tuning.prior);
  const defenseHome = shrunkRatio(perGame(home.venue, "conceded"), league.awayAvg, home.venue.played, tuning.prior);

  let lambda = attackHome * defenseAway * league.homeAvg;
  let mu = attackAway * defenseHome * league.awayAvg;
  factors.push({
    key: "base",
    label: "Attaque et défense",
    detail: `${home.name} marque ${num(perGame(home.venue, "scored") || 0)} par match à domicile, ${away.name} en encaisse ${num(perGame(away.venue, "conceded") || 0)} à l'extérieur (moyenne de la ligue : ${num(league.homeAvg)}).`,
    homeMultiplier: attackHome * defenseAway,
    awayMultiplier: attackAway * defenseHome,
  });

  // 2. Classement Elo (niveau global, adversaires affrontés)
  if (typeof home.elo === "number" && typeof away.elo === "number") {
    const f = Math.exp((tuning.elo * (home.elo - away.elo)) / 400);
    const m = Math.sqrt(f);
    lambda *= m;
    mu /= m;
    factors.push({
      key: "elo",
      label: "Classement Elo",
      detail: `${home.name} ${Math.round(home.elo)} contre ${Math.round(away.elo)} pour ${away.name} : ${pct(m)} pour ${home.name}.`,
      homeMultiplier: m,
      awayMultiplier: 1 / m,
    });
  }

  // 3. Forme récente (derniers matchs, comparés à la moyenne de la saison)
  const formOf = (team: TeamStrengthInput) => {
    if (!team.recent || team.recent.scored.length < 3) return null;
    const season = team.overall ?? team.venue;
    const avgScored = perGame(season, "scored");
    const avgConceded = perGame(season, "conceded");
    const recentScored = team.recent.scored.reduce((a, b) => a + b, 0) / team.recent.scored.length;
    const recentConceded = team.recent.conceded.reduce((a, b) => a + b, 0) / team.recent.conceded.length;
    return {
      attack: clamp(Number.isFinite(avgScored) && avgScored > 0 ? recentScored / avgScored : 1, 0.7, 1.3),
      defense: clamp(Number.isFinite(avgConceded) && avgConceded > 0 ? recentConceded / avgConceded : 1, 0.7, 1.3),
      recentScored,
      recentConceded,
      results: team.recent.results?.join("") ?? "",
    };
  };
  const formHome = formOf(home);
  const formAway = formOf(away);
  if (formHome || formAway) {
    const w = tuning.form;
    const hm = 1 + w * ((formHome?.attack ?? 1) - 1) + w * ((formAway?.defense ?? 1) - 1);
    const am = 1 + w * ((formAway?.attack ?? 1) - 1) + w * ((formHome?.defense ?? 1) - 1);
    lambda *= hm;
    mu *= am;
    const describe = (t: TeamStrengthInput, f: ReturnType<typeof formOf>) =>
      f ? `${t.name}${f.results ? ` (${f.results})` : ""} : ${num(f.recentScored)} marqués et ${num(f.recentConceded)} encaissés par match récemment` : null;
    factors.push({
      key: "form",
      label: "Forme récente",
      detail: [describe(home, formHome), describe(away, formAway)].filter(Boolean).join(" ; ") + ".",
      homeMultiplier: hm,
      awayMultiplier: am,
    });
  }

  // 4. Absences
  const missAttH = clamp(home.missingAttack ?? 0, 0, 0.6);
  const missAttA = clamp(away.missingAttack ?? 0, 0, 0.6);
  const missDefH = clamp(home.missingDefense ?? 0, 0, 0.4);
  const missDefA = clamp(away.missingDefense ?? 0, 0, 0.4);
  if (missAttH || missAttA || missDefH || missDefA) {
    const hm = (1 - 0.6 * missAttH) * (1 + 0.5 * missDefA);
    const am = (1 - 0.6 * missAttA) * (1 + 0.5 * missDefH);
    lambda *= hm;
    mu *= am;
    const list = (t: TeamStrengthInput) => (t.absentPlayers?.length ? `${t.name} : ${t.absentPlayers.join(", ")}` : null);
    factors.push({
      key: "absences",
      label: "Absences",
      detail: [list(home), list(away)].filter(Boolean).join(" ; ") || "Joueurs importants absents.",
      homeMultiplier: hm,
      awayMultiplier: am,
    });
  }

  const [min, max] = tuning.bounds;
  return {
    home: clamp(lambda, min, max),
    away: clamp(mu, min, max),
    factors,
    sampleSize: Math.min(home.venue.played, away.venue.played),
  };
}

/**
 * Volleyball : probabilité que l'équipe 1 gagne un set, par la méthode « log5 »
 * à partir des pourcentages de sets gagnés, plus un léger avantage du terrain.
 */
export function estimateSetProbability(homeSetWinRate: number, awaySetWinRate: number, homeAdvantage = 0.03): number {
  const a = clamp(homeSetWinRate, 0.05, 0.95);
  const b = clamp(awaySetWinRate, 0.05, 0.95);
  const p = (a * (1 - b)) / (a * (1 - b) + b * (1 - a));
  return clamp(p + homeAdvantage, 0.03, 0.97);
}
