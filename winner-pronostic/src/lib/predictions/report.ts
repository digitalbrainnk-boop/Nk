import { estimateFairProbability } from "@/lib/coupons/odds";
import { type SportCode, getSport } from "@/lib/sports/catalog";
import { confidenceScore } from "./confidence";
import { computeMarkets } from "./engine";
import type { FootballOptions } from "./goals";
import { type LineOutcome, lineExpectedValue } from "./math";
import { MARKET_INFO, type Market, type Period, type SelectionRef, isPushFree, probabilityKey, selectionLabel } from "./markets";
import type { StrengthResult } from "./strength";
import type { MarketProbability } from "./types";

/**
 * Rapport d'analyse complet d'un match : lecture du match, buts attendus,
 * meilleures sélections, value bets et probabilités de TOUS les marchés,
 * regroupés comme chez les bookmakers.
 */

export type ReportOdds = SelectionRef & { odd: number; bookmaker?: string };

export type MatchContext = {
  standings?: { homeRank: number; awayRank: number; homePoints: number; awayPoints: number } | null;
  h2h?: { played: number; homeWins: number; draws: number; awayWins: number; avgGoals: number } | null;
};

export type ReportInput = {
  sport: SportCode;
  teams: { home: string; away: string };
  expected: { home: number; away: number };
  strength?: Pick<StrengthResult, "factors" | "sampleSize"> | null;
  context?: MatchContext;
  odds?: ReportOdds[];
  options?: FootballOptions;
  playerNames?: Record<string, string>;
};

export type ReportRow = {
  ref: SelectionRef;
  label: string;
  probability: number;
  fairOdd: number;
  outcome?: LineOutcome;
  bestOdd?: number;
  bookmaker?: string;
  edge: number | null;
  isValue: boolean;
  confidence: number;
  basis: MarketProbability["basis"];
};

export type ReportGroup = { id: string; title: string; note?: string; rows: ReportRow[] };

export type Insight = { icon: string; title: string; text: string };

export type MatchReport = {
  sport: SportCode;
  teams: { home: string; away: string };
  expected: { home: number; away: number };
  unit: string;
  headline: string;
  insights: Insight[];
  topPicks: ReportRow[];
  valueBets: ReportRow[];
  likelyScores: { score: string; probability: number }[];
  groups: ReportGroup[];
  marketCount: number;
};

type GroupDef = { id: string; title: string; note?: string; match: (m: MarketProbability) => boolean; sortByProbability?: boolean; limit?: number };

const isQuarter = (line: number | null) => line !== null && Math.abs(Math.round(line * 4) % 2) === 1;
const ft = (m: MarketProbability, ...markets: Market[]) => m.period === "FT" && markets.includes(m.market);

const GROUPS: GroupDef[] = [
  { id: "1x2", title: "1X2", match: (m) => ft(m, "1X2") },
  { id: "ml", title: "Vainqueur (prolongations incluses)", match: (m) => ft(m, "ML") },
  { id: "dc", title: "Double chance", match: (m) => ft(m, "DC") },
  { id: "btts", title: "Deux équipes vont marquer", match: (m) => ft(m, "BTTS") },
  { id: "total", title: "Total", match: (m) => ft(m, "TOTAL") && !isQuarter(m.line) },
  { id: "total-asian", title: "Total asiatique", match: (m) => ft(m, "TOTAL") && isQuarter(m.line) },
  { id: "tt1", title: "Total 1", match: (m) => ft(m, "TT1") && !isQuarter(m.line) },
  { id: "tt2", title: "Total 2", match: (m) => ft(m, "TT2") && !isQuarter(m.line) },
  { id: "tt-asian", title: "Équipe asiatique Total 1 et 2", match: (m) => ft(m, "TT1", "TT2") && isQuarter(m.line) },
  { id: "hcp", title: "Handicap", match: (m) => ft(m, "HCP") && !isQuarter(m.line) },
  { id: "hcp-asian", title: "Handicap asiatique", match: (m) => ft(m, "HCP") && isQuarter(m.line) },
  { id: "dnb", title: "Remboursé si match nul", match: (m) => ft(m, "DNB") },
  { id: "res-total", title: "Résultat + Total", match: (m) => ft(m, "RES_TOTAL") },
  { id: "res-btts", title: "1X2 + Chaque équipe va marquer", match: (m) => ft(m, "RES_BTTS") },
  { id: "dc-btts", title: "Double chance + Les deux équipes vont marquer", match: (m) => ft(m, "DC_BTTS") },
  { id: "dc-total", title: "Double chance + Total", match: (m) => ft(m, "DC_TOTAL") },
  { id: "cs", title: "Score exact", match: (m) => ft(m, "CS"), sortByProbability: true, limit: 16 },
  { id: "htft", title: "MT-Fin", match: (m) => ft(m, "HTFT"), sortByProbability: true },
  { id: "1h", title: "1re mi-temps", match: (m) => m.period === "1H" && m.market !== "CS" },
  { id: "2h", title: "2e mi-temps", match: (m) => m.period === "2H" && m.market !== "CS" },
  { id: "periods", title: "Périodes", match: (m) => m.period === "P1" || m.period === "P2" || m.period === "P3" },
  { id: "sets", title: "1er set", match: (m) => m.period === "S1" },
  {
    id: "halves",
    title: "Spéciaux mi-temps",
    match: (m) => ft(m, "SCORE_BOTH_HALVES", "TEAM_SCORE_BOTH_HALVES", "WIN_BOTH_HALVES", "WIN_EITHER_HALF", "DRAW_BOTH_HALVES", "HIGHEST_HALF"),
  },
  { id: "first-goal", title: "Premier but", match: (m) => ft(m, "FIRST_GOAL") },
  { id: "intervals", title: "But dans l'intervalle de temps", match: (m) => ft(m, "GOAL_INTERVAL") },
  { id: "team-intervals", title: "Premier but de l'équipe dans l'intervalle", match: (m) => ft(m, "TEAM_FIRST_GOAL_INTERVAL") },
  { id: "specials", title: "Spéciaux", match: (m) => ft(m, "WIN_NIL", "CLEAN_SHEET", "DRAW_GOALS", "ODD_EVEN") },
  {
    id: "penalties",
    title: "Pénalty et expulsion",
    note: "Estimation à partir des moyennes de la ligue : moins précise que les autres marchés.",
    match: (m) => ft(m, "PENALTY", "RED_CARD", "PEN_RED_COMBO"),
  },
  { id: "corners", title: "Corners et cartons", match: (m) => ft(m, "CORNERS", "CARDS") },
  { id: "scorers", title: "Joueur va marquer un but à tout moment", match: (m) => ft(m, "SCORER"), sortByProbability: true },
];

const pct = (p: number) => `${Math.round(p * 100)} %`;
const num = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export function buildMatchReport(input: ReportInput): MatchReport {
  const sport = getSport(input.sport);
  const engine = computeMarkets(input.sport, input.expected.home, input.expected.away, input.options);
  const unit = input.sport === "volleyball" ? "sets" : sport.scoreUnit;

  // Meilleure cote disponible pour chaque sélection
  const bestOdds = new Map<string, { odd: number; bookmaker?: string }>();
  for (const o of input.odds ?? []) {
    const key = probabilityKey(o);
    if (!bestOdds.has(key) || bestOdds.get(key)!.odd < o.odd) bestOdds.set(key, { odd: o.odd, bookmaker: o.bookmaker });
  }

  const rows: ReportRow[] = engine.markets.map((m) => {
    const ref: SelectionRef = { period: m.period, market: m.market, line: m.line, selection: m.selection };
    const best = bestOdds.get(probabilityKey(ref));
    const edge = best ? (m.outcome ? lineExpectedValue(m.outcome, best.odd) : m.probability * best.odd - 1) : null;
    const confidence = confidenceScore({
      probability: m.probability,
      market: m.market,
      sampleSize: input.strength?.sampleSize,
      basis: m.basis,
      marketGap: best ? m.probability - estimateFairProbability(best.odd) : null,
    });
    return {
      ref,
      label: selectionLabel(ref, input.teams, unit, input.playerNames),
      probability: m.probability,
      fairOdd: m.probability > 0 ? 1 / m.probability : Infinity,
      outcome: m.outcome,
      bestOdd: best?.odd,
      bookmaker: best?.bookmaker,
      edge,
      isValue: edge !== null && edge >= 0.05 && confidence >= 3,
      confidence,
      basis: m.basis,
    };
  });

  const groups: ReportGroup[] = [];
  for (const def of GROUPS) {
    let groupRows = rows.filter((r) => def.match({ ...r.ref, probability: r.probability, basis: r.basis }));
    if (def.sortByProbability) groupRows = [...groupRows].sort((a, b) => b.probability - a.probability);
    if (def.limit) groupRows = groupRows.slice(0, def.limit);
    if (groupRows.length) groups.push({ id: def.id, title: def.title, note: def.note, rows: groupRows });
  }

  // Meilleures sélections : marchés fiables, ni trop évidentes (cote < 1,08) ni trop risquées
  const usedMarkets = new Set<string>();
  const topPicks = rows
    .filter(
      (r) =>
        (r.ref.period === "FT" || r.ref.period === "1H") &&
        MARKET_INFO[r.ref.market].kind !== "exotic" &&
        r.ref.market !== "DNB" &&
        isPushFree(r.ref.line) &&
        r.probability >= 0.6 &&
        r.probability <= 0.92,
    )
    .sort((a, b) => b.confidence - a.confidence || b.probability - a.probability)
    .filter((r) => {
      const family = `${r.ref.period}:${r.ref.market}`;
      if (usedMarkets.has(family)) return false;
      usedMarkets.add(family);
      return true;
    })
    .slice(0, 6);

  const valueBets = rows
    .filter((r) => r.isValue)
    .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
    .slice(0, 5);

  const likelyScores = rows
    .filter((r) => r.ref.period === "FT" && r.ref.market === "CS")
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 6)
    .map((r) => ({ score: r.ref.selection, probability: r.probability }));

  const find = (period: Period, market: Market, selection: string, line: number | null = null) =>
    rows.find((r) => r.ref.period === period && r.ref.market === market && r.ref.selection === selection && r.ref.line === line);

  return {
    sport: input.sport,
    teams: input.teams,
    expected: input.expected,
    unit,
    headline: headlineOf(input, find),
    insights: insightsOf(input, unit, likelyScores, find),
    topPicks,
    valueBets,
    likelyScores,
    groups,
    marketCount: rows.length,
  };
}

type Finder = (period: Period, market: Market, selection: string, line?: number | null) => ReportRow | undefined;

function headlineOf(input: ReportInput, find: Finder): string {
  const { home, away } = input.teams;
  const pHome = (find("FT", "1X2", "1") ?? find("FT", "ML", "1"))?.probability ?? 0.5;
  const pAway = (find("FT", "1X2", "2") ?? find("FT", "ML", "2"))?.probability ?? 0.5;
  let text: string;
  if (pHome >= 0.6) text = `Net avantage ${home}`;
  else if (pHome >= 0.47) text = `Léger avantage ${home}`;
  else if (pAway >= 0.6) text = `Net avantage ${away}`;
  else if (pAway >= 0.47) text = `Léger avantage ${away}`;
  else text = "Match très équilibré";
  if (input.sport === "football") {
    const over = find("FT", "TOTAL", "OVER", 2.5)?.probability ?? 0.5;
    text += over >= 0.58 ? ", match ouvert" : over <= 0.42 ? ", match fermé" : "";
  }
  return text;
}

function insightsOf(input: ReportInput, unit: string, scores: MatchReport["likelyScores"], find: Finder): Insight[] {
  const { home, away } = input.teams;
  const out: Insight[] = [];
  const isSets = input.sport === "volleyball" || input.sport === "tennis";

  if (!isSets) {
    out.push({
      icon: "🎯",
      title: `${unit[0].toUpperCase()}${unit.slice(1)} attendus`,
      text: `${home} ${num(input.expected.home)} – ${num(input.expected.away)} ${away}.`,
    });
  } else {
    out.push({ icon: "🎯", title: "Rapport de force", text: `${home} gagne un set environ ${pct(input.expected.home)} du temps.` });
  }

  for (const f of input.strength?.factors ?? []) {
    out.push({ icon: { base: "⚔️", elo: "📈", form: "🔥", absences: "🚑" }[f.key] ?? "📊", title: f.label, text: f.detail });
  }

  const s = input.context?.standings;
  if (s) {
    out.push({
      icon: "🏆",
      title: "Classement",
      text: `${home} ${s.homeRank}e (${s.homePoints} pts), ${away} ${s.awayRank}e (${s.awayPoints} pts).`,
    });
  }
  const h = input.context?.h2h;
  if (h && h.played > 0) {
    out.push({
      icon: "🤝",
      title: "Confrontations directes",
      text: `${h.played} derniers matchs : ${h.homeWins} victoire${h.homeWins > 1 ? "s" : ""} de ${home}, ${h.draws} nul${h.draws > 1 ? "s" : ""}, ${h.awayWins} de ${away} ; ${num(h.avgGoals)} ${unit} par match.`,
    });
  }

  if (scores.length >= 2) {
    out.push({
      icon: "🔢",
      title: "Scores les plus probables",
      text: scores.slice(0, 3).map((x) => `${x.score} (${pct(x.probability)})`).join(", ") + ".",
    });
  }
  if (input.sport === "football") {
    const btts = find("FT", "BTTS", "YES")?.probability;
    const over = find("FT", "TOTAL", "OVER", 2.5)?.probability;
    if (btts !== undefined && over !== undefined) {
      out.push({ icon: "⚽", title: "Buts", text: `Les deux équipes marquent : ${pct(btts)}. Plus de 2,5 buts : ${pct(over)}.` });
    }
  }

  const market = input.odds?.find((o) => o.period === "FT" && (o.market === "1X2" || o.market === "ML") && o.selection === "1");
  const model = (find("FT", "1X2", "1") ?? find("FT", "ML", "1"))?.probability;
  if (market && model !== undefined) {
    out.push({
      icon: "💹",
      title: "Notre modèle face aux cotes",
      text: `Les bookmakers donnent environ ${pct(estimateFairProbability(market.odd))} de chances à ${home} (cote ${market.odd.toFixed(2)}), notre modèle ${pct(model)}.`,
    });
  }
  if (input.strength && input.strength.sampleSize < 6) {
    out.push({ icon: "⚠️", title: "Peu de données", text: "Peu de matchs joués cette saison : les probabilités sont moins sûres." });
  }
  return out;
}
