/** Multiplies every limit; the e2e suite raises it because one test run creates many accounts. */
const SCALE = Math.max(1, Number(process.env.RATE_LIMIT_SCALE ?? 1));

/** Small in-memory fixed-window rate limiter (one server process). */
export class RateLimit {
  private hits = new Map<string, { n: number; resetAt: number }>();

  private readonly max: number;

  constructor(
    max: number,
    private readonly windowMs: number,
  ) {
    this.max = max * SCALE;
  }

  /** Count one hit for `key`; false if over the limit. */
  take(key: string): boolean {
    const now = Date.now();
    const e = this.hits.get(key);
    if (!e || e.resetAt < now) {
      this.hits.set(key, { n: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (e.n >= this.max) return false;
    e.n++;
    return true;
  }
}
