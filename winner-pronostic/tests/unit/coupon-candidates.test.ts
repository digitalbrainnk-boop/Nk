import { describe, expect, it } from "vitest";
import { buildCandidates } from "@/lib/coupons/candidates";
import { periodWindow } from "@/lib/coupons/period";

describe("période d'un coupon", () => {
  it("du jour : jusqu'à minuit", () => {
    const now = new Date("2026-11-04T15:30:00Z"); // mercredi
    const { from, to } = periodWindow("jour", now);
    expect(from).toEqual(now);
    expect(to.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("week-end : du samedi au dimanche soir (ou dès maintenant si on y est)", () => {
    const wednesday = periodWindow("weekend", new Date("2026-11-04T15:30:00Z"));
    expect(wednesday.from.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(wednesday.to.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    const sunday = periodWindow("weekend", new Date("2026-11-08T10:00:00Z"));
    expect(sunday.from.toISOString()).toBe("2026-11-08T10:00:00.000Z");
    expect(sunday.to.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("7 jours", () => {
    const { to } = periodWindow("long_terme", new Date("2026-11-04T15:30:00Z"));
    expect(to.toISOString()).toBe("2026-11-11T15:30:00.000Z");
  });
});

describe("construction des sélections candidates", () => {
  const row = {
    id: 7,
    sport: "basketball",
    starts_at: "2026-11-04T20:00:00Z",
    competition: { name: "NBA", is_enabled: true },
    home: { name: "Lakers" },
    away: { name: "Celtics" },
    predictions: [
      { computed_at: "2026-11-03T10:00:00Z", probabilities: { ML: { "1": 0.4, "2": 0.6 } } },
      { computed_at: "2026-11-04T10:00:00Z", probabilities: { ML: { "1": 0.62, "2": 0.38 }, TOTAL: { "215.5": { OVER: 0.55, UNDER: 0.45 } } } },
    ],
    event_odds: [
      { market: "ML" as const, line: null, selection: "1", odd: 1.7 },
      { market: "ML" as const, line: null, selection: "1", odd: 1.75 }, // meilleure cote retenue
      { market: "TOTAL" as const, line: 215.5, selection: "OVER", odd: 1.9 },
      { market: "1X2" as const, line: null, selection: "X", odd: 15 }, // marché non proposé en basket
      { market: "TOTAL" as const, line: 220.5, selection: "OVER", odd: 2.3 }, // pas de probabilité du modèle
    ],
  };

  it("garde la prédiction la plus récente et la meilleure cote, par marché autorisé", () => {
    const candidates = buildCandidates([row]);
    expect(candidates.map((c) => [c.market, c.line, c.selection, c.odd, c.probability])).toEqual([
      ["ML", null, "1", 1.75, 0.62],
      ["TOTAL", 215.5, "OVER", 1.9, 0.55],
    ]);
    expect(candidates[0]).toMatchObject({ eventId: 7, sport: "basketball", home: "Lakers", competition: "NBA" });
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(1);
  });

  it("ignore les événements sans prédiction ou d'un sport inconnu", () => {
    expect(buildCandidates([{ ...row, predictions: [] }])).toEqual([]);
    expect(buildCandidates([{ ...row, sport: "curling" }])).toEqual([]);
  });
});
