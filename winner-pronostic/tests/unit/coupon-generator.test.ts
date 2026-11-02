import { describe, expect, it } from "vitest";
import { type Candidate, type RiskLevel, RISK_RULES, eligibleCandidates, generateCoupon } from "@/lib/coupons/generator";
import { product } from "@/lib/coupons/odds";
import type { SportCode } from "@/lib/sports/catalog";

const NOW = new Date("2026-11-02T12:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

let seq = 0;
function cand(partial: Partial<Candidate> & Pick<Candidate, "odd" | "probability">): Candidate {
  seq += 1;
  const eventId = partial.eventId ?? seq;
  return {
    key: partial.key ?? `${eventId}:1X2::${seq}`,
    eventId,
    sport: partial.sport ?? "football",
    startsAt: partial.startsAt ?? inHours(3),
    home: "Domicile",
    away: "Extérieur",
    market: partial.market ?? "1X2",
    line: partial.line ?? null,
    selection: partial.selection ?? "1",
    confidence: partial.confidence ?? 5,
    ...partial,
  };
}

/** Générateur pseudo-aléatoire reproductible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

/** Recherche exhaustive (petits cas) : meilleure probabilité avec cote dans [low, high]. */
function bruteForce(cands: Candidate[], low: number, high: number, maxLegs: number): number {
  let best = 0;
  const n = cands.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const legs = cands.filter((_, i) => mask & (1 << i));
    if (legs.length > maxLegs) continue;
    if (new Set(legs.map((l) => l.eventId)).size !== legs.length) continue;
    const odds = product(legs.map((l) => l.odd));
    if (odds < low || odds > high) continue;
    best = Math.max(best, product(legs.map((l) => l.probability)));
  }
  return best;
}

describe("générateur de coupons", () => {
  it("atteint la cote visée (entre 100 % et 115 %) avec une sélection par match", () => {
    const pool = [1.3, 1.45, 1.6, 1.25, 1.8, 1.5, 1.35, 1.7].map((odd, i) =>
      cand({ eventId: 100 + i, odd, probability: Math.min(0.95, 1 / odd + 0.04) }),
    );
    const result = generateCoupon(pool, { targetOdds: 5, risk: "equilibre", now: NOW });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.totalOdds).toBeGreaterThanOrEqual(5 * 0.99);
    expect(result.totalOdds).toBeLessThanOrEqual(5 * 1.15 * 1.01);
    expect(new Set(result.legs.map((l) => l.eventId)).size).toBe(result.legs.length);
    expect(result.probability).toBeCloseTo(product(result.legs.map((l) => l.probability)), 10);
  });

  it("trouve la combinaison optimale (comparaison avec une recherche exhaustive)", () => {
    const random = rng(42);
    let solved = 0;
    for (let round = 0; round < 25; round++) {
      const pool: Candidate[] = [];
      for (let i = 0; i < 11; i++) {
        const odd = 1.2 + random() * 1.3;
        const fair = 1 / odd;
        pool.push(
          cand({
            eventId: Math.floor(i / 1.4), // quelques matchs avec 2 options
            odd: Math.round(odd * 100) / 100,
            probability: Math.min(0.97, Math.max(0.46, fair + (random() - 0.4) * 0.1)),
          }),
        );
      }
      const target = 2 + random() * 6;
      const eligible = eligibleCandidates(pool, { targetOdds: target, risk: "equilibre", now: NOW });
      const expected = bruteForce(eligible, target, target * 1.15, RISK_RULES.equilibre.maxLegs);
      const result = generateCoupon(pool, { targetOdds: target, risk: "equilibre", now: NOW });
      if (expected === 0) {
        expect(result.status).toBe("insufficient");
      } else {
        expect(result.status).toBe("ok");
        if (result.status === "ok") {
          solved += 1;
          // Écart dû uniquement à la discrétisation des cotes (< 2 %)
          expect(result.probability).toBeGreaterThanOrEqual(expected * 0.98);
        }
      }
    }
    expect(solved).toBeGreaterThan(15); // le test compare bien des cas résolus
  });

  it("préfère peu de sélections « value » à beaucoup de petites cotes à marge", () => {
    const smallLegs = Array.from({ length: 8 }, (_, i) => cand({ eventId: 200 + i, odd: 1.25, probability: 0.76 }));
    const valueLegs = [
      cand({ eventId: 300, odd: 2.2, probability: 0.5 }),
      cand({ eventId: 301, odd: 2.3, probability: 0.48 }),
    ];
    const result = generateCoupon([...smallLegs, ...valueLegs], { targetOdds: 5, risk: "audacieux", now: NOW });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.legs.map((l) => l.eventId).sort()).toEqual([300, 301]);
  });

  it.each<RiskLevel>(["prudent", "equilibre", "audacieux"])("respecte les règles du niveau %s", (risk) => {
    const random = rng(7);
    const pool = Array.from({ length: 40 }, (_, i) => {
      const odd = 1.1 + random() * 3;
      return cand({ eventId: 400 + i, odd, probability: Math.min(0.95, 1 / odd + 0.03), confidence: 1 + Math.floor(random() * 5) });
    });
    const rule = RISK_RULES[risk];
    const result = generateCoupon(pool, { targetOdds: 3, risk, now: NOW });
    if (result.status === "ok") {
      expect(result.legs.length).toBeLessThanOrEqual(rule.maxLegs);
      for (const leg of result.legs) {
        expect(leg.odd).toBeGreaterThanOrEqual(rule.minOdd);
        expect(leg.odd).toBeLessThanOrEqual(rule.maxOdd);
        expect(leg.probability).toBeGreaterThanOrEqual(rule.minProbability);
        expect(leg.confidence).toBeGreaterThanOrEqual(rule.minConfidence);
      }
    }
  });

  it("mélange les sports, ou se limite aux sports choisis", () => {
    const sports: SportCode[] = ["football", "basketball", "ice_hockey", "handball"];
    const pool = sports.flatMap((sport, s) =>
      Array.from({ length: 3 }, (_, i) => cand({ eventId: 500 + s * 10 + i, sport, odd: 1.5, probability: 0.7 })),
    );
    const mixed = generateCoupon(pool, { targetOdds: 5, risk: "equilibre", now: NOW });
    expect(mixed.status).toBe("ok");
    const onlyBasket = generateCoupon(pool, { targetOdds: 3, risk: "equilibre", sports: ["basketball"], now: NOW });
    expect(onlyBasket.status).toBe("ok");
    if (onlyBasket.status === "ok") expect(onlyBasket.legs.every((l) => l.sport === "basketball")).toBe(true);
  });

  it("ignore les matchs déjà commencés ou imminents et les sélections exclues", () => {
    const started = cand({ eventId: 600, odd: 2.5, probability: 0.5, startsAt: inHours(-1) });
    const soon = cand({ eventId: 601, odd: 2.5, probability: 0.5, startsAt: inHours(0.05) });
    const excluded = cand({ eventId: 602, odd: 2.5, probability: 0.5, key: "x" });
    const ok = cand({ eventId: 603, odd: 2.5, probability: 0.5 });
    const eligible = eligibleCandidates([started, soon, excluded, ok], {
      targetOdds: 2.5,
      risk: "audacieux",
      excludeKeys: ["x"],
      now: NOW,
    });
    expect(eligible.map((c) => c.eventId)).toEqual([603]);
  });

  it("explique quand la cote visée est inatteignable", () => {
    const pool = [cand({ odd: 1.3, probability: 0.8 }), cand({ odd: 1.4, probability: 0.75 })];
    const result = generateCoupon(pool, { targetOdds: 50, risk: "prudent", now: NOW });
    expect(result.status).toBe("insufficient");
    if (result.status === "insufficient") {
      expect(result.maxReachableOdds).toBeCloseTo(1.82, 2);
      expect(result.reason).toMatch(/cote maximale atteignable/);
    }
  });

  it("reste rapide avec beaucoup d'événements et une grosse cote", () => {
    const random = rng(99);
    const pool = Array.from({ length: 600 }, (_, i) => {
      const odd = 1.2 + random() * 2.5;
      return cand({ eventId: 1000 + Math.floor(i / 3), odd, probability: Math.min(0.95, 1 / odd + 0.02) });
    });
    const start = performance.now();
    const result = generateCoupon(pool, { targetOdds: 100, risk: "audacieux", now: NOW });
    expect(performance.now() - start).toBeLessThan(3000);
    expect(result.status).toBe("ok");
  });
});
