/**
 * Limiteur de requêtes en mémoire (fenêtre fixe). Sert de secours quand la
 * base n'est pas joignable et en développement. En production serverless,
 * chaque instance a sa propre mémoire : le limiteur partagé en base
 * (public.rate_limit_hit) reste la référence.
 */
export type RateLimitRule = {
  /** Nombre maximal de tentatives dans la fenêtre. */
  limit: number;
  /** Durée de la fenêtre, en secondes. */
  windowSeconds: number;
};

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, { start: number; hits: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  hit(key: string, rule: RateLimitRule): boolean {
    const now = this.now();
    const windowMs = rule.windowSeconds * 1000;
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.start >= windowMs) {
      if (!bucket && this.buckets.size >= this.maxKeys) this.evict(now, windowMs);
      this.buckets.set(key, { start: now, hits: 1 });
      return 1 <= rule.limit;
    }

    bucket.hits += 1;
    return bucket.hits <= rule.limit;
  }

  private evict(now: number, windowMs: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.start >= windowMs) this.buckets.delete(key);
    }
    // Toujours plein : on retire les plus anciennes entrées.
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}
