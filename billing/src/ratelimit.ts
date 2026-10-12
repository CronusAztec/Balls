// --- go-live-kit --- A fixed-window rate limiter kept in the Worker's memory.
//
// Honest limits: the counters live in ONE Worker isolate (per Cloudflare location, and a redeploy resets them), so this
// stops a careless loop – a script hammering /checkout from one connection – not a distributed attack. The stronger tool is
// a Cloudflare WAF rate-limiting rule once the Worker runs on a custom domain (billing/README.md, "Rate limits"). Pure: no
// I/O, an injectable clock.

/** The most keys one limiter remembers; the oldest windows go first beyond it. */
export const RATE_LIMIT_MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSeconds: number;
}

export class MemoryRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowSeconds: number,
    private readonly now: () => number = () => Date.now() / 1000,
  ) {}

  /** Count one request for `key` and say whether it is within the limit. */
  hit(key: string): RateLimitResult {
    const now = this.now();
    let entry = this.windows.get(key);
    if (!entry || now >= entry.resetAt) {
      // A new window goes to the end of the map: every window lasts the same time, so the map stays ordered by resetAt
      // and the eviction below drops the oldest first.
      this.windows.delete(key);
      entry = { count: 0, resetAt: now + this.windowSeconds };
      this.windows.set(key, entry);
      this.evict(now);
    }
    entry.count++;
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(entry.resetAt - now)),
    };
  }

  /** How many keys are remembered (for the tests). */
  get size(): number {
    return this.windows.size;
  }

  private evict(now: number): void {
    if (this.windows.size <= RATE_LIMIT_MAX_KEYS) return;
    // Expired windows first, then the oldest resetAt (the front of the map) until the map fits.
    for (const [key, entry] of this.windows) {
      if (this.windows.size <= RATE_LIMIT_MAX_KEYS) return;
      if (entry.resetAt <= now) this.windows.delete(key);
    }
    for (const key of this.windows.keys()) {
      if (this.windows.size <= RATE_LIMIT_MAX_KEYS) return;
      this.windows.delete(key);
    }
  }
}
