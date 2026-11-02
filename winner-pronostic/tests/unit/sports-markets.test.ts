import { describe, expect, it } from "vitest";
import { betNotation, probabilityOf, selectionLabel } from "@/lib/predictions/markets";
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
    "1X2": { "1": 0.5, X: 0.27, "2": 0.23 },
    TOTAL: { "2.5": { OVER: 0.52, UNDER: 0.48 }, "215.5": { OVER: 0.55, UNDER: 0.45 } },
    HCP: { "-1.5": { "1": 0.41, "2": 0.59 } },
  };

  it("lit une probabilité du modèle, y compris pour les marchés à ligne", () => {
    expect(probabilityOf(map, "1X2", null, "X")).toBe(0.27);
    expect(probabilityOf(map, "TOTAL", 2.5, "OVER")).toBe(0.52);
    expect(probabilityOf(map, "TOTAL", 215.5, "UNDER")).toBe(0.45);
    expect(probabilityOf(map, "HCP", -1.5, "2")).toBe(0.59);
    expect(probabilityOf(map, "TOTAL", 3.5, "OVER")).toBeNull();
    expect(probabilityOf(map, "BTTS", null, "YES")).toBeNull();
  });

  it("écrit des libellés clairs en français", () => {
    const teams = { home: "Lakers", away: "Celtics" };
    expect(selectionLabel("ML", null, "1", teams)).toBe("Victoire Lakers (prol. incluses)");
    expect(selectionLabel("TOTAL", 215.5, "OVER", teams, "points")).toBe("Plus de 215,5 points");
    expect(selectionLabel("HCP", -5.5, "1", teams)).toBe("Lakers (−5,5)");
    expect(selectionLabel("HCP", -5.5, "2", teams)).toBe("Celtics (+5,5)");
    expect(selectionLabel("1X2", null, "X", teams)).toBe("Match nul");
    expect(selectionLabel("HTFT", null, "X/2", teams)).toBe("Mi-temps : Nul / Fin : Celtics");
    expect(betNotation("TOTAL", 2.5, "UNDER")).toBe("Total · Moins (2.5)");
  });
});
