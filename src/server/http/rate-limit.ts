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

type Window = {
  count: number;
  resetAt: number;
  /** Kept so eviction can tell a throttled key from an idle one. */
  limit: number;
};

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
      // Evict everything already expired first — that is the cheap pass and in
      // normal operation it is the only one needed.
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);

      /* ── Eviction must never release a key that is being throttled ────────
       * A flood of DISTINCT keys inside one window expires nothing, so the
       * sweep above frees nothing and the map would grow without bound. The
       * previous answer was to drop the oldest live windows, on the reasoning
       * that insertion order approximates expiry order.
       *
       * That handed an attacker the limiter's off switch. A bucket that has
       * just hit its limit is, by definition, one of the OLDEST live ones — it
       * was created by the first failed attempt several attempts ago. So:
       * guess against one account until it locks, submit ten thousand logins
       * for distinct addresses, and the victim's counter is evicted as "closest
       * to expiring". Come back and the account has a fresh allowance. Repeat
       * for as long as you like; the per-account limit, which is the one that
       * actually stops password guessing, stops applying.
       *
       * So a throttled bucket is not evictable. Among the rest, oldest first is
       * still the right order.
       *
       * If EVERY live bucket is throttled there is nothing safe to drop, and
       * the new key goes untracked for this request rather than either evicting
       * a throttled one or refusing a caller who has done nothing wrong. That
       * is the documented soft edge of an in-memory limiter under a flood; what
       * matters is that nobody already being slowed down gets released. */
      if (buckets.size >= MAX_TRACKED_KEYS) {
        let toDrop = buckets.size - MAX_TRACKED_KEYS + 1;
        for (const [k, v] of buckets) {
          if (toDrop <= 0) break;
          if (v.count >= v.limit) continue; // being throttled — leave it alone
          buckets.delete(k);
          toDrop -= 1;
        }
        if (buckets.size >= MAX_TRACKED_KEYS) {
          return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
        }
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs, limit });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  // The limit can change under us (it is read from the environment per call),
  // and eviction reads it off the bucket — so keep the stored copy current.
  existing.limit = limit;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Forget one key's window.
 *
 * Called when a login SUCCEEDS. The limiter exists to slow password guessing,
 * and a correct password is proof this was not that — so the failed attempts
 * that preceded it should not go on counting against the person who has just
 * proved who they are. Without this, someone signing in from a second device
 * inside five minutes could be refused with the right password, and the
 * tighter the per-account limit the sooner that happens.
 *
 * Only the account bucket is cleared, never the address one: one successful
 * login on a shared network must not reset the flood guard for everybody
 * behind it.
 */
export function forget(key: string): void {
  buckets.delete(key);
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
  /**
   * Per IP: a blunt flood guard, and deliberately generous.
   *
   * This was 30, which is a number for an office. The people using this share
   * a campus: two hundred instructors behind one outbound address all signing
   * in at nine in the morning would exhaust it in the first minute, and every
   * one of them after the thirtieth would be refused. It would have locked out
   * the users while barely inconveniencing an attacker, who can change address.
   */
  perIp: {
    limit: Number(process.env.RATE_LIMIT_LOGIN_IP ?? 200),
    windowMs: 5 * 60_000,
  },
  /**
   * Per account: this is the limit that actually stops password guessing, and
   * it holds however many addresses an attacker spreads across. Eight in five
   * minutes is roughly ninety-six attempts an hour against one account — slow
   * enough to be useless — and eight is more than any real person needs.
   */
  perEmail: {
    limit: Number(process.env.RATE_LIMIT_LOGIN_EMAIL ?? 8),
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
