import { describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "@/lib/security/memory-rate-limiter";

describe("MemoryRateLimiter", () => {
  it("bloque au-delà de la limite puis rouvre après la fenêtre", () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(() => now);
    const rule = { limit: 3, windowSeconds: 60 };
    expect([1, 2, 3, 4].map(() => limiter.hit("ip:1", rule))).toEqual([true, true, true, false]);
    expect(limiter.hit("ip:2", rule)).toBe(true); // clés indépendantes
    now = 60_000;
    expect(limiter.hit("ip:1", rule)).toBe(true);
  });

  it("borne la mémoire utilisée", () => {
    const limiter = new MemoryRateLimiter(() => 0, 100);
    for (let i = 0; i < 1_000; i++) limiter.hit(`k${i}`, { limit: 1, windowSeconds: 60 });
    // @ts-expect-error accès interne pour le test
    expect(limiter.buckets.size).toBeLessThanOrEqual(100);
  });
});
