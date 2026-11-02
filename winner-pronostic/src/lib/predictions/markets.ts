import type { SportCode } from "@/lib/sports/catalog";

/**
 * Catalogue des marchés de paris analysés, avec des libellés proches de ceux
 * des bookmakers (1xBet…) pour que l'utilisateur retrouve facilement le pari.
 * Les mêmes codes sont validés en SQL (public.is_valid_market / is_valid_selection).
 */

/** Période du match concernée par le pari. */
export const PERIODS = ["FT", "1H", "2H", "P1", "P2", "P3", "Q1", "Q2", "Q3", "Q4", "S1", "S2", "S3", "S4", "S5"] as const;
export type Period = (typeof PERIODS)[number];

export const MARKETS = [
  "1X2",
  "DC",
  "DNB",
  "ML",
  "TOTAL",
  "TT1",
  "TT2",
  "HCP",
  "BTTS",
  "CS",
  "ODD_EVEN",
  "RES_TOTAL",
  "RES_BTTS",
  "DC_BTTS",
  "DC_TOTAL",
  "HTFT",
  "WIN_NIL",
  "CLEAN_SHEET",
  "DRAW_GOALS",
  "SCORE_BOTH_HALVES",
  "TEAM_SCORE_BOTH_HALVES",
  "WIN_BOTH_HALVES",
  "WIN_EITHER_HALF",
  "DRAW_BOTH_HALVES",
  "HIGHEST_HALF",
  "FIRST_GOAL",
  "GOAL_INTERVAL",
  "TEAM_FIRST_GOAL_INTERVAL",
  "PENALTY",
  "RED_CARD",
  "PEN_RED_COMBO",
  "CORNERS",
  "CARDS",
  "SCORER",
] as const;
export type Market = (typeof MARKETS)[number];

/** main = marchés classiques ; secondary = marchés dérivés fiables ; exotic = très incertains. */
export type MarketKind = "main" | "secondary" | "exotic";

export const MARKET_INFO: Record<Market, { label: string; kind: MarketKind; hasLine: boolean }> = {
  "1X2": { label: "1X2", kind: "main", hasLine: false },
  DC: { label: "Double chance", kind: "main", hasLine: false },
  DNB: { label: "Remboursé si match nul", kind: "main", hasLine: false },
  ML: { label: "Vainqueur (prolongations incluses)", kind: "main", hasLine: false },
  TOTAL: { label: "Total", kind: "main", hasLine: true },
  TT1: { label: "Total 1", kind: "secondary", hasLine: true },
  TT2: { label: "Total 2", kind: "secondary", hasLine: true },
  HCP: { label: "Handicap", kind: "main", hasLine: true },
  BTTS: { label: "Deux équipes vont marquer", kind: "main", hasLine: false },
  CS: { label: "Score exact", kind: "exotic", hasLine: false },
  ODD_EVEN: { label: "Total pair/impair", kind: "exotic", hasLine: false },
  RES_TOTAL: { label: "Résultat + Total", kind: "secondary", hasLine: true },
  RES_BTTS: { label: "1X2 + Chaque équipe va marquer", kind: "secondary", hasLine: false },
  DC_BTTS: { label: "Double chance + Les deux équipes vont marquer", kind: "secondary", hasLine: false },
  DC_TOTAL: { label: "Double chance + Total", kind: "secondary", hasLine: true },
  HTFT: { label: "MT-Fin", kind: "exotic", hasLine: false },
  WIN_NIL: { label: "Victoire sans encaisser", kind: "secondary", hasLine: false },
  CLEAN_SHEET: { label: "Ne va pas encaisser de but", kind: "secondary", hasLine: false },
  DRAW_GOALS: { label: "Match nul avec buts", kind: "secondary", hasLine: false },
  SCORE_BOTH_HALVES: { label: "Score dans chaque mi-temps", kind: "secondary", hasLine: false },
  TEAM_SCORE_BOTH_HALVES: { label: "Équipe score dans les deux mi-temps", kind: "secondary", hasLine: false },
  WIN_BOTH_HALVES: { label: "Équipe va gagner les deux mi-temps", kind: "exotic", hasLine: false },
  WIN_EITHER_HALF: { label: "Équipe gagne au moins une mi-temps", kind: "secondary", hasLine: false },
  DRAW_BOTH_HALVES: { label: "Nul dans les deux mi-temps", kind: "exotic", hasLine: false },
  HIGHEST_HALF: { label: "Mi-temps la plus prolifique", kind: "exotic", hasLine: false },
  FIRST_GOAL: { label: "Premier but", kind: "secondary", hasLine: false },
  GOAL_INTERVAL: { label: "But dans l'intervalle de temps", kind: "exotic", hasLine: false },
  TEAM_FIRST_GOAL_INTERVAL: { label: "Premier but de l'équipe dans l'intervalle de temps", kind: "exotic", hasLine: false },
  PENALTY: { label: "Pénalty accordé", kind: "exotic", hasLine: false },
  RED_CARD: { label: "Expulsion", kind: "exotic", hasLine: false },
  PEN_RED_COMBO: { label: "Pénalty et expulsion", kind: "exotic", hasLine: false },
  CORNERS: { label: "Total corners", kind: "exotic", hasLine: true },
  CARDS: { label: "Total cartons", kind: "exotic", hasLine: true },
  SCORER: { label: "Joueur va marquer un but à tout moment", kind: "exotic", hasLine: false },
};

/** Une sélection précise : période + marché + ligne éventuelle + choix. */
export type SelectionRef = { period: Period; market: Market; line: number | null; selection: string };

const SELECTION_RULES: Partial<Record<Market, RegExp>> = {
  "1X2": /^[1X2]$/,
  DC: /^(1X|12|X2)$/,
  CS: /^\d{1,2}-\d{1,2}$/,
  ODD_EVEN: /^(ODD|EVEN)$/,
  RES_TOTAL: /^[1X2]&(OVER|UNDER)$/,
  RES_BTTS: /^[1X2]&(YES|NO)$/,
  DC_BTTS: /^(1X|12|X2)&(YES|NO)$/,
  DC_TOTAL: /^(1X|12|X2)&(OVER|UNDER)$/,
  HTFT: /^[1X2]\/[1X2]$/,
  TEAM_SCORE_BOTH_HALVES: /^[12]:(YES|NO)$/,
  HIGHEST_HALF: /^(1H|2H|EQ)$/,
  FIRST_GOAL: /^(1|2|NONE)$/,
  GOAL_INTERVAL: /^\d{1,2}-\d{1,3}:(YES|NO)$/,
  TEAM_FIRST_GOAL_INTERVAL: /^[12]:\d{1,2}-\d{1,3}$/,
  PEN_RED_COMBO: /^(PEN_AND_RED|PEN_NO_RED|RED_NO_PEN|NEITHER|PEN_OR_RED)$/,
  SCORER: /^P\d{1,10}$/,
};
const TWO_SIDES = new Set<Market>(["ML", "DNB", "WIN_NIL", "CLEAN_SHEET", "WIN_BOTH_HALVES", "WIN_EITHER_HALF", "HCP"]);
const YES_NO = new Set<Market>(["BTTS", "DRAW_GOALS", "SCORE_BOTH_HALVES", "DRAW_BOTH_HALVES", "PENALTY", "RED_CARD"]);
const OVER_UNDER = new Set<Market>(["TOTAL", "TT1", "TT2", "CORNERS", "CARDS"]);

/** Même règle que la fonction SQL public.is_valid_selection. */
export function isValidSelection(market: Market, line: number | null, selection: string): boolean {
  const info = MARKET_INFO[market];
  if (!info) return false;
  if (info.hasLine !== (line !== null)) return false;
  if (OVER_UNDER.has(market)) return (line ?? -1) >= 0 && (selection === "OVER" || selection === "UNDER");
  if (TWO_SIDES.has(market)) return selection === "1" || selection === "2";
  if (YES_NO.has(market)) return selection === "YES" || selection === "NO";
  return SELECTION_RULES[market]?.test(selection) ?? false;
}

/** Ligne sans remboursement possible (x,5) : le pari est gagné ou perdu, jamais « remboursé ». */
export function isPushFree(line: number | null): boolean {
  if (line === null) return true;
  return Math.abs(Math.abs(line % 1) - 0.5) < 1e-9;
}

// ---------------------------------------------------------------------------
// Probabilités stockées (colonne predictions.probabilities) : dictionnaire à plat
//   { "FT|TOTAL|2.5|OVER": 0.53, "1H|1X2||1": 0.38, "FT|CS||2-1": 0.09, … }
// ---------------------------------------------------------------------------
export type ProbabilityMap = Record<string, number>;

export function probabilityKey({ period, market, line, selection }: SelectionRef): string {
  return `${period}|${market}|${line === null ? "" : String(Number(line))}|${selection}`;
}

export function parseProbabilityKey(key: string): SelectionRef | null {
  const [period, market, line, selection] = key.split("|");
  if (!(PERIODS as readonly string[]).includes(period) || !(MARKETS as readonly string[]).includes(market) || !selection) return null;
  return { period: period as Period, market: market as Market, line: line === "" ? null : Number(line), selection };
}

/** Probabilité d'une sélection, ou null si le modèle ne la fournit pas. */
export function probabilityOf(map: ProbabilityMap, ref: SelectionRef): number | null {
  const value = map[probabilityKey(ref)];
  return typeof value === "number" && value > 0 && value < 1 ? value : null;
}

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n === 0 ? "0" : fmt(n).replace("-", "−"));

export const PERIOD_LABELS: Record<Period, string> = {
  FT: "",
  "1H": "1re mi-temps",
  "2H": "2e mi-temps",
  P1: "1re période",
  P2: "2e période",
  P3: "3e période",
  Q1: "1er quart-temps",
  Q2: "2e quart-temps",
  Q3: "3e quart-temps",
  Q4: "4e quart-temps",
  S1: "1er set",
  S2: "2e set",
  S3: "3e set",
  S4: "4e set",
  S5: "5e set",
};

export type Teams = { home: string; away: string };

function minuteRange(range: string): string {
  const [a, b] = range.split("-");
  return `entre la ${a}${a === "1" ? "re" : "e"} et la ${b}e minute`;
}

/** Libellé lisible d'une sélection : « Victoire Lakers », « Plus de 2,5 buts »… */
export function selectionLabel(
  ref: SelectionRef,
  teams: Teams,
  unit = "buts",
  names: Record<string, string> = {},
): string {
  const { market, line, selection } = ref;
  const side = (s: string) => (s === "1" ? teams.home : s === "2" ? teams.away : "Nul");
  const ou = (s: string, l: number | null, what = unit) => `${s === "OVER" ? "Plus" : "Moins"} de ${fmt(l ?? 0)} ${what}`;
  const dc = (s: string) => (s === "1X" ? `${teams.home} ou nul` : s === "X2" ? `${teams.away} ou nul` : `${teams.home} ou ${teams.away}`);
  const yesNo = (s: string) => (s === "YES" ? "oui" : "non");

  let text: string;
  switch (market) {
    case "1X2":
      text = selection === "X" ? "Match nul" : `Victoire ${side(selection)}`;
      break;
    case "ML":
      text = `Victoire ${side(selection)} (prol. incluses)`;
      break;
    case "DNB":
      text = `${side(selection)} gagne (remboursé si nul)`;
      break;
    case "DC":
      text = dc(selection);
      break;
    case "TOTAL":
      text = ou(selection, line);
      break;
    case "TT1":
      text = `${teams.home} : ${ou(selection, line).toLowerCase()}`;
      break;
    case "TT2":
      text = `${teams.away} : ${ou(selection, line).toLowerCase()}`;
      break;
    case "HCP":
      text = selection === "1" ? `${teams.home} (${signed(line ?? 0)})` : `${teams.away} (${signed(-(line ?? 0))})`;
      break;
    case "BTTS":
      text = selection === "YES" ? "Les deux équipes marquent" : "Au moins une équipe ne marque pas";
      break;
    case "CS":
      text = `Score exact ${selection}`;
      break;
    case "ODD_EVEN":
      text = selection === "ODD" ? `Total ${unit} impair` : `Total ${unit} pair`;
      break;
    case "RES_TOTAL":
    case "DC_TOTAL": {
      const [res, ouSel] = selection.split("&");
      const first = market === "RES_TOTAL" ? (res === "X" ? "Match nul" : `Victoire ${side(res)}`) : dc(res);
      text = `${first} et ${ou(ouSel, line).toLowerCase()}`;
      break;
    }
    case "RES_BTTS":
    case "DC_BTTS": {
      const [res, yn] = selection.split("&");
      const first = market === "RES_BTTS" ? (res === "X" ? "Match nul" : `Victoire ${side(res)}`) : dc(res);
      text = `${first} et ${yn === "YES" ? "les deux équipes marquent" : "au moins une équipe ne marque pas"}`;
      break;
    }
    case "HTFT": {
      const [ht, ft] = selection.split("/");
      text = `Mi-temps : ${side(ht)} / Fin : ${side(ft)}`;
      break;
    }
    case "WIN_NIL":
      text = `${side(selection)} gagne sans encaisser`;
      break;
    case "CLEAN_SHEET":
      text = `${side(selection)} n'encaisse pas de but`;
      break;
    case "DRAW_GOALS":
      text = selection === "YES" ? "Match nul avec buts (1-1, 2-2…)" : "Pas de match nul avec buts";
      break;
    case "SCORE_BOTH_HALVES":
      text = `But dans chaque mi-temps : ${yesNo(selection)}`;
      break;
    case "TEAM_SCORE_BOTH_HALVES": {
      const [team, yn] = selection.split(":");
      text = `${side(team)} marque dans les deux mi-temps : ${yesNo(yn)}`;
      break;
    }
    case "WIN_BOTH_HALVES":
      text = `${side(selection)} gagne les deux mi-temps`;
      break;
    case "WIN_EITHER_HALF":
      text = `${side(selection)} gagne au moins une mi-temps`;
      break;
    case "DRAW_BOTH_HALVES":
      text = `Nul dans les deux mi-temps : ${yesNo(selection)}`;
      break;
    case "HIGHEST_HALF":
      text =
        selection === "1H" ? "Plus de buts en 1re mi-temps" : selection === "2H" ? "Plus de buts en 2e mi-temps" : "Autant de buts dans chaque mi-temps";
      break;
    case "FIRST_GOAL":
      text = selection === "NONE" ? "Aucun but" : `${side(selection)} marque le premier`;
      break;
    case "GOAL_INTERVAL": {
      const [range, yn] = selection.split(":");
      text = `But ${minuteRange(range)} : ${yesNo(yn)}`;
      break;
    }
    case "TEAM_FIRST_GOAL_INTERVAL": {
      const [team, range] = selection.split(":");
      text = `1er but de ${side(team)} ${minuteRange(range)}`;
      break;
    }
    case "PENALTY":
      text = `Pénalty accordé : ${yesNo(selection)}`;
      break;
    case "RED_CARD":
      text = `Carton rouge dans le match : ${yesNo(selection)}`;
      break;
    case "PEN_RED_COMBO":
      text = {
        PEN_AND_RED: "Pénalty accordé et expulsion",
        PEN_NO_RED: "Pénalty accordé et pas d'expulsion",
        RED_NO_PEN: "Expulsion et pas de pénalty",
        NEITHER: "Pas de pénalty et pas d'expulsion",
        PEN_OR_RED: "Pénalty accordé ou expulsion",
      }[selection]!;
      break;
    case "CORNERS":
      text = ou(selection, line, "corners");
      break;
    case "CARDS":
      text = ou(selection, line, "cartons");
      break;
    case "SCORER":
      text = `${names[selection] ?? "Joueur"} marque à tout moment`;
      break;
  }
  const period = PERIOD_LABELS[ref.period];
  return period ? `${period} · ${text}` : text;
}

/** Notation du pari telle qu'on la cherche chez le bookmaker : « Total 1 · Plus (1.5) ». */
export function betNotation(ref: SelectionRef): string {
  const { market, line, selection } = ref;
  const name = MARKET_INFO[market].label;
  const period = PERIOD_LABELS[ref.period] ? ` (${PERIOD_LABELS[ref.period]})` : "";
  const ou = (s: string) => `${s === "OVER" ? "Plus" : "Moins"} (${line})`;
  let pick: string;
  if (market === "TOTAL" || market === "TT1" || market === "TT2" || market === "CORNERS" || market === "CARDS") pick = ou(selection);
  else if (market === "HCP") pick = `${selection} (${selection === "1" ? line : -(line ?? 0)})`;
  else if (market === "RES_TOTAL" || market === "DC_TOTAL") {
    const [res, s] = selection.split("&");
    pick = `${res} et ${ou(s)}`;
  } else pick = selection.replace("YES", "Oui").replace("NO", "Non").replace("&", " et ");
  return `${name}${period} · ${pick}`;
}

/** Marchés analysés par sport. */
export const MARKETS_BY_SPORT: Record<SportCode, Market[]> = {
  football: MARKETS.filter((m) => m !== "ML"),
  ice_hockey: ["1X2", "DC", "ML", "TOTAL", "TT1", "TT2", "HCP", "BTTS", "CS", "ODD_EVEN", "RES_TOTAL", "FIRST_GOAL"],
  basketball: ["1X2", "ML", "TOTAL", "TT1", "TT2", "HCP", "ODD_EVEN"],
  handball: ["1X2", "DC", "DNB", "TOTAL", "TT1", "TT2", "HCP", "ODD_EVEN", "RES_TOTAL"],
  volleyball: ["ML", "CS", "HCP", "TOTAL"],
  rugby: ["1X2", "DC", "DNB", "TOTAL", "TT1", "TT2", "HCP", "ODD_EVEN"],
  baseball: ["ML", "TOTAL", "TT1", "TT2", "HCP", "ODD_EVEN"],
  american_football: ["ML", "TOTAL", "TT1", "TT2", "HCP", "ODD_EVEN"],
  tennis: ["ML", "TOTAL", "HCP"],
};
