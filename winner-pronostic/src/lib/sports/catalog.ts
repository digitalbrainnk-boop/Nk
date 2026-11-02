/**
 * Catalogue des sports : affichage, fournisseur de données (API-Sports) et
 * normalisation des statuts de match. Les sports actifs et leur ordre sont
 * aussi en base (table public.sports), modifiables par l'admin.
 */

export const SPORT_CODES = [
  "football",
  "basketball",
  "ice_hockey",
  "handball",
  "volleyball",
  "rugby",
  "baseball",
  "american_football",
  "tennis",
] as const;

export type SportCode = (typeof SPORT_CODES)[number];
export type StatusGroup = "scheduled" | "live" | "finished" | "postponed" | "cancelled";

export type SportDefinition = {
  code: SportCode;
  name: string;
  shortName: string;
  emoji: string;
  /** Couleur d'accent (variable CSS définie dans globals.css). */
  colorVar: string;
  hasDraw: boolean;
  /** « buts », « points », « sets »… */
  scoreUnit: string;
  /** Hôte API-Sports, ou null si un autre fournisseur est nécessaire. */
  apiHost: string | null;
  statuses: { live: string[]; finished: string[]; postponed: string[]; cancelled: string[] };
};

const SPORTS: Record<SportCode, SportDefinition> = {
  football: {
    code: "football",
    name: "Football",
    shortName: "Foot",
    emoji: "⚽",
    colorVar: "--color-sport-football",
    hasDraw: true,
    scoreUnit: "buts",
    apiHost: "v3.football.api-sports.io",
    statuses: {
      live: ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"],
      finished: ["FT", "AET", "PEN"],
      postponed: ["PST"],
      cancelled: ["CANC", "ABD", "AWD", "WO"],
    },
  },
  basketball: {
    code: "basketball",
    name: "Basketball",
    shortName: "Basket",
    emoji: "🏀",
    colorVar: "--color-sport-basketball",
    hasDraw: false,
    scoreUnit: "points",
    apiHost: "v1.basketball.api-sports.io",
    statuses: {
      live: ["Q1", "Q2", "Q3", "Q4", "OT", "BT", "HT"],
      finished: ["FT", "AOT"],
      postponed: ["POST", "SUSP"],
      cancelled: ["CANC", "AWD", "ABD"],
    },
  },
  ice_hockey: {
    code: "ice_hockey",
    name: "Hockey sur glace",
    shortName: "Hockey",
    emoji: "🏒",
    colorVar: "--color-sport-hockey",
    hasDraw: true,
    scoreUnit: "buts",
    apiHost: "v1.hockey.api-sports.io",
    statuses: {
      live: ["P1", "P2", "P3", "OT", "PT", "BT"],
      finished: ["FT", "AOT", "AP"],
      postponed: ["POST", "INTR"],
      cancelled: ["CANC", "ABD", "AW"],
    },
  },
  handball: {
    code: "handball",
    name: "Handball",
    shortName: "Hand",
    emoji: "🤾",
    colorVar: "--color-sport-handball",
    hasDraw: true,
    scoreUnit: "buts",
    apiHost: "v1.handball.api-sports.io",
    statuses: {
      live: ["1H", "2H", "HT", "ET", "BT", "PT"],
      finished: ["FT", "AET", "AP"],
      postponed: ["POST", "INTR"],
      cancelled: ["CANC", "ABD", "AW", "WO"],
    },
  },
  volleyball: {
    code: "volleyball",
    name: "Volleyball",
    shortName: "Volley",
    emoji: "🏐",
    colorVar: "--color-sport-volleyball",
    hasDraw: false,
    scoreUnit: "sets",
    apiHost: "v1.volleyball.api-sports.io",
    statuses: {
      live: ["S1", "S2", "S3", "S4", "S5"],
      finished: ["FT"],
      postponed: ["POST", "INTR"],
      cancelled: ["CANC", "ABD", "AW"],
    },
  },
  rugby: {
    code: "rugby",
    name: "Rugby",
    shortName: "Rugby",
    emoji: "🏉",
    colorVar: "--color-sport-rugby",
    hasDraw: true,
    scoreUnit: "points",
    apiHost: "v1.rugby.api-sports.io",
    statuses: {
      live: ["1H", "2H", "HT", "ET", "BT", "PT"],
      finished: ["FT", "AET", "AP"],
      postponed: ["POST", "INTR"],
      cancelled: ["CANC", "ABD", "AW"],
    },
  },
  baseball: {
    code: "baseball",
    name: "Baseball",
    shortName: "Baseball",
    emoji: "⚾",
    colorVar: "--color-sport-baseball",
    hasDraw: false,
    scoreUnit: "points",
    apiHost: "v1.baseball.api-sports.io",
    statuses: {
      live: ["IN1", "IN2", "IN3", "IN4", "IN5", "IN6", "IN7", "IN8", "IN9"],
      finished: ["FT"],
      postponed: ["POST", "INTR"],
      cancelled: ["CANC", "ABD"],
    },
  },
  american_football: {
    code: "american_football",
    name: "Football américain",
    shortName: "NFL",
    emoji: "🏈",
    colorVar: "--color-sport-american",
    hasDraw: false,
    scoreUnit: "points",
    apiHost: "v1.american-football.api-sports.io",
    statuses: {
      live: ["Q1", "Q2", "Q3", "Q4", "OT", "HT"],
      finished: ["FT", "AOT"],
      postponed: ["PST", "POST"],
      cancelled: ["CANC"],
    },
  },
  tennis: {
    code: "tennis",
    name: "Tennis",
    shortName: "Tennis",
    emoji: "🎾",
    colorVar: "--color-sport-tennis",
    hasDraw: false,
    scoreUnit: "sets",
    apiHost: null,
    statuses: { live: [], finished: [], postponed: [], cancelled: [] },
  },
};

/** Sports affichés par défaut (le tennis attend un fournisseur de données). */
export const ACTIVE_SPORTS: SportDefinition[] = SPORT_CODES.filter((c) => SPORTS[c].apiHost !== null).map((c) => SPORTS[c]);

export function isSportCode(value: unknown): value is SportCode {
  return typeof value === "string" && (SPORT_CODES as readonly string[]).includes(value);
}

export function getSport(code: SportCode): SportDefinition {
  return SPORTS[code];
}

/** Statut du fournisseur (« Q3 », « P2 », « FT »…) → statut normalisé de l'application. */
export function statusGroupOf(sport: SportCode, statusShort: string): StatusGroup {
  const status = statusShort.trim().toUpperCase();
  const { statuses } = SPORTS[sport];
  if (statuses.live.includes(status)) return "live";
  if (statuses.finished.includes(status)) return "finished";
  if (statuses.postponed.includes(status)) return "postponed";
  if (statuses.cancelled.includes(status)) return "cancelled";
  // Codes inconnus mais reconnaissables : périodes, quart-temps, sets, manches…
  if (/^(Q\d|P\d|S\d|IN\d{1,2}|[12]H|HT|ET|OT|BT|PT|LIVE)$/.test(status)) return "live";
  return "scheduled";
}
