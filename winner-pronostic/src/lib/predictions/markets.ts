import type { SportCode } from "@/lib/sports/catalog";

/** Marchés gérés (mêmes codes que la fonction SQL public.is_valid_market). */
export const MARKETS = ["1X2", "DC", "ML", "DNB", "TOTAL", "HCP", "BTTS", "HTFT"] as const;
export type Market = (typeof MARKETS)[number];

/**
 * Probabilités calculées par le modèle pour un événement (colonne
 * predictions.probabilities). Les marchés à ligne sont indexés par la ligne :
 *   { "TOTAL": { "2.5": { "OVER": 0.52, "UNDER": 0.48 } }, "HCP": { "-1.5": { "1": 0.41, "2": 0.59 } } }
 */
export type ProbabilityMap = Partial<{
  "1X2": Partial<Record<"1" | "X" | "2", number>>;
  DC: Partial<Record<"1X" | "12" | "X2", number>>;
  ML: Partial<Record<"1" | "2", number>>;
  DNB: Partial<Record<"1" | "2", number>>;
  BTTS: Partial<Record<"YES" | "NO", number>>;
  HTFT: Record<string, number>;
  TOTAL: Record<string, Partial<Record<"OVER" | "UNDER", number>>>;
  HCP: Record<string, Partial<Record<"1" | "2", number>>>;
}>;

export function lineKey(line: number): string {
  return String(Number(line));
}

/** Probabilité d'une sélection, ou null si le modèle ne la fournit pas. */
export function probabilityOf(map: ProbabilityMap, market: Market, line: number | null, selection: string): number | null {
  let value: unknown;
  if (market === "TOTAL" || market === "HCP") {
    if (line === null) return null;
    value = (map[market]?.[lineKey(line)] as Record<string, number> | undefined)?.[selection];
  } else {
    value = (map[market] as Record<string, number> | undefined)?.[selection];
  }
  return typeof value === "number" && value > 0 && value < 1 ? value : null;
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n).replace("-", "−"));

/** Libellé lisible d'une sélection : « Victoire Lakers », « Plus de 215,5 points »… */
export function selectionLabel(
  market: Market,
  line: number | null,
  selection: string,
  teams: { home: string; away: string },
  unit = "buts",
): string {
  const side = (s: string) => (s === "1" ? teams.home : s === "2" ? teams.away : "Nul");
  switch (market) {
    case "1X2":
      return selection === "X" ? "Match nul" : `Victoire ${side(selection)}`;
    case "ML":
      return `Victoire ${side(selection)} (prol. incluses)`;
    case "DNB":
      return `${side(selection)} gagne (remboursé si nul)`;
    case "DC":
      return selection === "1X"
        ? `${teams.home} ou nul`
        : selection === "X2"
          ? `${teams.away} ou nul`
          : `${teams.home} ou ${teams.away}`;
    case "TOTAL":
      return `${selection === "OVER" ? "Plus" : "Moins"} de ${fmt(line ?? 0)} ${unit}`;
    case "HCP": {
      const homeLine = line ?? 0;
      return selection === "1" ? `${teams.home} (${signed(homeLine)})` : `${teams.away} (${signed(-homeLine)})`;
    }
    case "BTTS":
      return selection === "YES" ? "Les deux équipes marquent" : "Une équipe au moins ne marque pas";
    case "HTFT": {
      const [ht, ft] = selection.split("/");
      return `Mi-temps : ${side(ht)} / Fin : ${side(ft)}`;
    }
  }
}

/** Notation courte utilisée par les bookmakers, pour retrouver le pari facilement. */
export function betNotation(market: Market, line: number | null, selection: string): string {
  switch (market) {
    case "1X2":
      return `1X2 · ${selection}`;
    case "DC":
      return `Double chance · ${selection}`;
    case "ML":
      return `Vainqueur · ${selection}`;
    case "DNB":
      return `Remboursé si nul · ${selection}`;
    case "TOTAL":
      return `Total · ${selection === "OVER" ? "Plus" : "Moins"} (${line})`;
    case "HCP":
      return `Handicap ${selection} (${selection === "1" ? line : -(line ?? 0)})`;
    case "BTTS":
      return `Les deux marquent · ${selection === "YES" ? "Oui" : "Non"}`;
    case "HTFT":
      return `MT/FT · ${selection}`;
  }
}

/** Marchés proposés par sport pour les pronostics et coupons. */
export const MARKETS_BY_SPORT: Record<SportCode, Market[]> = {
  football: ["1X2", "DC", "DNB", "TOTAL", "BTTS", "HTFT", "HCP"],
  basketball: ["ML", "TOTAL", "HCP"],
  ice_hockey: ["1X2", "DC", "ML", "TOTAL", "HCP", "BTTS"],
  handball: ["1X2", "DC", "TOTAL", "HCP"],
  volleyball: ["ML", "TOTAL", "HCP"],
  rugby: ["1X2", "DC", "TOTAL", "HCP"],
  baseball: ["ML", "TOTAL", "HCP"],
  american_football: ["ML", "TOTAL", "HCP"],
  tennis: ["ML", "TOTAL", "HCP"],
};
