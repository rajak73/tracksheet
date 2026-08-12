/**
 * Rate limiting for authentication endpoints.
 *
 * ── Scope of this implementation ───────────────────────────────────────────
 * In-memory, per-process, fixed-window. That is honest about what it is: it
 * stops credential stuffing and casual brute force against a single instance.
 * Behind more than one instance the effective limit multiplies by the instance
 * count, and a restart clears the counters. Moving to Redis means replacing
 * `hit()` — the call sites do not change.
 *
 * It is here rather than absent because an unthrottled login endpoint is the
 * single most attackable surface in the app, and a partial defence against
 * online guessing is worth considerably more than none. It is documented rather
 * than dressed up as complete.
 *
 * ── Keying ─────────────────────────────────────────────────────────────────
 * Both the client IP AND the submitted email are limited. IP alone lets one
 * attacker behind a NAT lock out an entire office; email alone lets a
 * distributed attacker spread across addresses. Whichever limit trips first
 * wins.
 */

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

/** Bounded so a flood of distinct keys cannot grow the map without limit. */
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      // Evict everything already expired before giving up on new keys.
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Test-only: lets a suite exercise the limiter without waiting out a window. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Limits, overridable by environment so the test suite can raise the shared
 * per-IP ceiling (every test hits from 127.0.0.1) while keeping the per-account
 * limit low enough for a test to actually trip it.
 */
export const AUTH_LIMITS = {
  /** Per IP: generous enough for a shared office, tight enough to matter. */
  perIp: {
    limit: Number(process.env.RATE_LIMIT_LOGIN_IP ?? 30),
    windowMs: 5 * 60_000,
  },
  /** Per account: an attacker guessing one password should stall quickly. */
  perEmail: {
    limit: Number(process.env.RATE_LIMIT_LOGIN_EMAIL ?? 10),
    windowMs: 5 * 60_000,
  },
} as const;

/**
 * Best-effort client address. `x-forwarded-for` is only trustworthy behind a
 * proxy that sets it; treated as a bucketing hint, never as identity, and never
 * used for authorization.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
