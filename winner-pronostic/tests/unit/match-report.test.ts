import { describe, expect, it } from "vitest";
import { exampleFootballReportInput } from "@/lib/predictions/example";
import { buildMatchReport } from "@/lib/predictions/report";

describe("rapport d'analyse d'un match", () => {
  const report = buildMatchReport(exampleFootballReportInput());

  it("analyse des centaines de marchés regroupés comme chez les bookmakers", () => {
    expect(report.marketCount).toBeGreaterThan(300);
    const titles = report.groups.map((g) => g.title);
    for (const t of ["1X2", "Double chance", "Deux équipes vont marquer", "Total", "Total asiatique", "Total 1", "Handicap asiatique", "Résultat + Total", "Score exact", "MT-Fin", "1re mi-temps", "But dans l'intervalle de temps", "Pénalty et expulsion", "Joueur va marquer un but à tout moment"]) {
      expect(titles).toContain(t);
    }
    expect(report.groups.find((g) => g.id === "penalties")?.note).toMatch(/moyennes de la ligue/);
  });

  it("explique le pronostic (lecture du match)", () => {
    const titles = report.insights.map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(["Buts attendus", "Attaque et défense", "Classement Elo", "Forme récente", "Absences", "Classement", "Confrontations directes", "Scores les plus probables", "Notre modèle face aux cotes"]));
    expect(report.headline).toMatch(/avantage Newcastle/);
  });

  it("propose des sélections solides, sans doublon de marché, et repère les value bets", () => {
    expect(report.topPicks.length).toBeGreaterThan(2);
    const families = report.topPicks.map((r) => `${r.ref.period}:${r.ref.market}`);
    expect(new Set(families).size).toBe(families.length);
    for (const pick of report.topPicks) {
      expect(pick.probability).toBeGreaterThanOrEqual(0.6);
      expect(pick.probability).toBeLessThanOrEqual(0.92);
    }
    for (const v of report.valueBets) {
      expect(v.bestOdd).toBeDefined();
      expect(v.edge!).toBeGreaterThanOrEqual(0.05);
    }
    const withOdd = report.groups.flatMap((g) => g.rows).filter((r) => r.bestOdd);
    expect(withOdd.length).toBe(16);
  });

  it("classe les scores exacts du plus au moins probable", () => {
    const probs = report.likelyScores.map((s) => s.probability);
    expect([...probs].sort((a, b) => b - a)).toEqual(probs);
    expect(report.likelyScores[0].score).toMatch(/^\d-\d$/);
  });

  it("fonctionne pour un sport à points sans données détaillées", () => {
    const basket = buildMatchReport({ sport: "basketball", teams: { home: "Lakers", away: "Celtics" }, expected: { home: 114, away: 109 } });
    expect(basket.groups.map((g) => g.title)).toEqual(expect.arrayContaining(["Vainqueur (prolongations incluses)", "Total", "Handicap", "1re mi-temps"]));
    expect(basket.likelyScores).toEqual([]);
    expect(basket.insights[0].text).toMatch(/Lakers 114 – 109 Celtics/);
  });
});
