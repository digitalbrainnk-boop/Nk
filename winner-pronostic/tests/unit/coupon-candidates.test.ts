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
    predictions: <{ computed_at: string; probabilities: Record<string, number> }[]>[
      { computed_at: "2026-11-03T10:00:00Z", probabilities: { "FT|ML||1": 0.4, "FT|ML||2": 0.6 } },
      {
        computed_at: "2026-11-04T10:00:00Z",
        probabilities: { "FT|ML||1": 0.62, "FT|ML||2": 0.38, "FT|TOTAL|215.5|OVER": 0.55, "FT|TOTAL|215|OVER": 0.57, "1H|TOTAL|108.5|OVER": 0.52 },
      },
    ],
    event_odds: [
      { period: "FT" as const, market: "ML" as const, line: null, selection: "1", odd: 1.7 },
      { period: "FT" as const, market: "ML" as const, line: null, selection: "1", odd: 1.75 }, // meilleure cote retenue
      { period: "FT" as const, market: "TOTAL" as const, line: 215.5, selection: "OVER", odd: 1.9 },
      { period: "FT" as const, market: "TOTAL" as const, line: 215, selection: "OVER", odd: 1.8 }, // ligne entière (remboursement possible) exclue
      { period: "1H" as const, market: "TOTAL" as const, line: 108.5, selection: "OVER", odd: 1.85 }, // 1re mi-temps
      { period: "FT" as const, market: "CS" as const, line: null, selection: "110-105", odd: 90 }, // marché non proposé en basket
      { period: "FT" as const, market: "TOTAL" as const, line: 220.5, selection: "OVER", odd: 2.3 }, // pas de probabilité du modèle
    ],
  };

  it("garde la prédiction la plus récente et la meilleure cote, par marché autorisé", () => {
    const candidates = buildCandidates([row]);
    expect(candidates.map((c) => [c.period, c.market, c.line, c.selection, c.odd, c.probability])).toEqual([
      ["FT", "ML", null, "1", 1.75, 0.62],
      ["FT", "TOTAL", 215.5, "OVER", 1.9, 0.55],
      ["1H", "TOTAL", 108.5, "OVER", 1.85, 0.52],
    ]);
    expect(candidates[0]).toMatchObject({ eventId: 7, sport: "basketball", home: "Lakers", competition: "NBA" });
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(1);
  });

  it("ignore les événements sans prédiction ou d'un sport inconnu", () => {
    expect(buildCandidates([{ ...row, predictions: [] }])).toEqual([]);
    expect(buildCandidates([{ ...row, sport: "curling" }])).toEqual([]);
  });
});
