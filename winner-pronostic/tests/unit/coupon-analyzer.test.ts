import { describe, expect, it } from "vitest";
import { analyzeCoupon } from "@/lib/coupons/analyzer";
import { bookmakerMargin, fairProbabilities, oneIn } from "@/lib/coupons/odds";

describe("outils de cotes", () => {
  it("calcule la marge et les probabilités justes", () => {
    expect(bookmakerMargin([1.9, 1.9])).toBeCloseTo(0.0526, 3);
    const [a, b] = fairProbabilities([1.9, 1.9]);
    expect(a).toBeCloseTo(0.5, 10);
    expect(b).toBeCloseTo(0.5, 10);
    expect(oneIn(0.2)).toBe(5);
    expect(oneIn(0.037)).toBe(27);
  });
});

describe("analyse de coupon", () => {
  it("calcule la cote totale et une chance réelle inférieure à la chance implicite (marge)", () => {
    const analysis = analyzeCoupon([
      { label: "A", odd: 1.5 },
      { label: "B", odd: 2 },
    ]);
    expect(analysis.totalOdds).toBeCloseTo(3, 10);
    expect(analysis.impliedProbability).toBeCloseTo(1 / 3, 10);
    expect(analysis.estimatedProbability).toBeLessThan(1 / 3);
    expect(analysis.modelCoverage).toBe(0);
    expect(analysis.warnings.join(" ")).toMatch(/cotes uniquement/);
  });

  it("utilise les probabilités du modèle et repère la sélection la plus faible", () => {
    const analysis = analyzeCoupon([
      { label: "Solide", odd: 1.3, probability: 0.82 },
      { label: "À éviter", odd: 1.8, probability: 0.4 },
      { label: "Correct", odd: 1.7, probability: 0.58 },
    ]);
    expect(analysis.modelCoverage).toBe(1);
    expect(analysis.legs.map((l) => l.verdict)).toEqual(["solide", "a_eviter", "correct"]);
    expect(analysis.weakestIndex).toBe(1);
    expect(analysis.suggestions[0]).toMatchObject({ removeIndex: 1, label: "À éviter" });
    expect(analysis.suggestions[0].newProbability).toBeCloseTo(0.82 * 0.58, 10);
    expect(analysis.suggestions[0].newOdds).toBeCloseTo(1.3 * 1.7, 10);
  });

  it("classe le coupon selon sa chance réelle, sans jamais promettre de gain", () => {
    const strong = analyzeCoupon([{ label: "A", odd: 1.4, probability: 0.75 }]);
    expect(strong.verdict).toBe("bon");
    const long = analyzeCoupon(Array.from({ length: 10 }, (_, i) => ({ label: `L${i}`, odd: 1.6 })));
    expect(long.verdict).toBe("tres_faible");
    expect(long.headline).toMatch(/1 chance sur \d+/);
    expect(`${strong.headline} ${long.headline}`).not.toMatch(/sûr|garanti/i);
    expect(long.warnings.join(" ")).toMatch(/10 sélections/);
  });

  it("signale les doublons de match et les matchs commencés", () => {
    const analysis = analyzeCoupon(
      [
        { label: "A", odd: 1.5, eventKey: "m1", startsAt: "2026-11-02T10:00:00Z" },
        { label: "B", odd: 1.6, eventKey: "m1" },
      ],
      { now: new Date("2026-11-02T12:00:00Z") },
    );
    expect(analysis.warnings.join(" ")).toMatch(/même match/);
    expect(analysis.warnings.join(" ")).toMatch(/déjà commencé/);
  });
});
