/** Small in-memory fixed-window rate limiter (one server process). */
export class RateLimit {
  private hits = new Map<string, { n: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

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
