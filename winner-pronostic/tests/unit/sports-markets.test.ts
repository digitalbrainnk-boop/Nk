import { describe, expect, it } from "vitest";
import {
  type Market,
  type Period,
  betNotation,
  isPushFree,
  isValidSelection,
  parseProbabilityKey,
  probabilityOf,
  selectionLabel,
} from "@/lib/predictions/markets";
import { ACTIVE_SPORTS, statusGroupOf } from "@/lib/sports/catalog";

describe("catalogue des sports", () => {
  it("propose les sports couverts par API-Sports", () => {
    expect(ACTIVE_SPORTS.map((s) => s.code)).toEqual([
      "football",
      "basketball",
      "ice_hockey",
      "handball",
      "volleyball",
      "rugby",
      "baseball",
      "american_football",
    ]);
  });

  it.each([
    ["football", "2H", "live"],
    ["football", "PEN", "finished"],
    ["football", "PST", "postponed"],
    ["basketball", "Q3", "live"],
    ["basketball", "AOT", "finished"],
    ["ice_hockey", "P2", "live"],
    ["ice_hockey", "AP", "finished"],
    ["handball", "WO", "cancelled"],
    ["volleyball", "S4", "live"],
    ["baseball", "IN7", "live"],
    ["baseball", "IN11", "live"],
    ["football", "NS", "scheduled"],
    ["basketball", "TBD", "scheduled"],
  ] as const)("%s : %s → %s", (sport, status, group) => {
    expect(statusGroupOf(sport, status)).toBe(group);
  });
});

describe("marchés", () => {
  const map = {
    "FT|1X2||X": 0.27,
    "FT|TOTAL|2.5|OVER": 0.52,
    "FT|TOTAL|215.5|UNDER": 0.45,
    "FT|HCP|-1.5|2": 0.59,
    "1H|BTTS||YES": 0.18,
  };
  const ref = (period: Period, market: Market, line: number | null, selection: string) => ({ period, market, line, selection });

  it("lit une probabilité du modèle, y compris pour les marchés à ligne et les mi-temps", () => {
    expect(probabilityOf(map, ref("FT", "1X2", null, "X"))).toBe(0.27);
    expect(probabilityOf(map, ref("FT", "TOTAL", 2.5, "OVER"))).toBe(0.52);
    expect(probabilityOf(map, ref("FT", "TOTAL", 215.5, "UNDER"))).toBe(0.45);
    expect(probabilityOf(map, ref("FT", "HCP", -1.5, "2"))).toBe(0.59);
    expect(probabilityOf(map, ref("1H", "BTTS", null, "YES"))).toBe(0.18);
    expect(probabilityOf(map, ref("FT", "BTTS", null, "YES"))).toBeNull();
    expect(parseProbabilityKey("FT|TOTAL|2.5|OVER")).toEqual(ref("FT", "TOTAL", 2.5, "OVER"));
    expect(parseProbabilityKey("ZZ|TOTAL|2.5|OVER")).toBeNull();
  });

  it("écrit des libellés clairs en français, proches des bookmakers", () => {
    const teams = { home: "Newcastle", away: "Everton" };
    expect(selectionLabel(ref("FT", "ML", null, "1"), teams)).toBe("Victoire Newcastle (prol. incluses)");
    expect(selectionLabel(ref("FT", "TOTAL", 215.5, "OVER"), teams, "points")).toBe("Plus de 215,5 points");
    expect(selectionLabel(ref("FT", "HCP", -1.5, "1"), teams)).toBe("Newcastle (−1,5)");
    expect(selectionLabel(ref("FT", "HCP", -1.5, "2"), teams)).toBe("Everton (+1,5)");
    expect(selectionLabel(ref("FT", "TT1", 1.5, "OVER"), teams)).toBe("Newcastle : plus de 1,5 buts");
    expect(selectionLabel(ref("FT", "RES_TOTAL", 2.5, "1&OVER"), teams)).toBe("Victoire Newcastle et plus de 2,5 buts");
    expect(selectionLabel(ref("FT", "DC_BTTS", null, "X2&YES"), teams)).toBe("Everton ou nul et les deux équipes marquent");
    expect(selectionLabel(ref("FT", "HTFT", null, "X/1"), teams)).toBe("Mi-temps : Nul / Fin : Newcastle");
    expect(selectionLabel(ref("FT", "GOAL_INTERVAL", null, "1-15:YES"), teams)).toBe("But entre la 1re et la 15e minute : oui");
    expect(selectionLabel(ref("1H", "1X2", null, "1"), teams)).toBe("1re mi-temps · Victoire Newcastle");
    expect(selectionLabel(ref("FT", "SCORER", null, "P9"), teams, "buts", { P9: "A. Isak" })).toBe("A. Isak marque à tout moment");
    expect(betNotation(ref("FT", "TT1", 1.5, "OVER"))).toBe("Total 1 · Plus (1.5)");
    expect(betNotation(ref("1H", "BTTS", null, "YES"))).toBe("Deux équipes vont marquer (1re mi-temps) · Oui");
  });

  it("valide les sélections comme la base de données", () => {
    expect(isValidSelection("TOTAL", 2.25, "OVER")).toBe(true);
    expect(isValidSelection("TOTAL", null, "OVER")).toBe(false);
    expect(isValidSelection("CS", null, "2-1")).toBe(true);
    expect(isValidSelection("RES_TOTAL", 2.5, "X&UNDER")).toBe(true);
    expect(isValidSelection("RES_TOTAL", null, "X&UNDER")).toBe(false);
    expect(isValidSelection("TEAM_SCORE_BOTH_HALVES", null, "3:YES")).toBe(false);
    expect(isPushFree(2.5)).toBe(true);
    expect(isPushFree(2)).toBe(false);
    expect(isPushFree(2.25)).toBe(false);
    expect(isPushFree(-1.5)).toBe(true);
  });
});
