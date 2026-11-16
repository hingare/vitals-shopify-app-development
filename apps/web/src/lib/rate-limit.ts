/**
 * Counters kept in memory. Each server instance counts on its own, which is enough to stop one
 * visitor, or a script, from running up the AI bill. Keys are hashed before they get here.
 */

/** At most `limit` uses per key in each window of `windowMs` */
export class WindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Counts one use; false when the key has used up its window */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.hits.size >= this.maxKeys) this.sweep(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  private sweep(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
    // Still full: drop the oldest keys, which only makes the limiter more lenient
    for (const key of this.hits.keys()) {
      if (this.hits.size < this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

/** At most `limit` uses per UTC day, across all visitors */
export class DailyLimiter {
  private day = "";
  private count = 0;

  constructor(private readonly limit: number) {}

  take(now = new Date()): boolean {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }
}
