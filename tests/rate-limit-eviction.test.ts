import { beforeEach, describe, expect, test } from "vitest";
import { hit, resetRateLimits } from "@/server/http/rate-limit";

/**
 * Eviction must never release a key that is being throttled.
 *
 * ── The hole ──────────────────────────────────────────────────────────────
 * The bucket map is bounded, and when a flood of distinct keys fills it with
 * live windows the limiter has to drop something. It dropped the OLDEST live
 * windows, reasoning that insertion order approximates expiry order.
 *
 * A bucket that has just hit its limit is one of the oldest live ones — it was
 * created by the first failed attempt, several attempts ago. So an attacker
 * could guess against one account until it locked, submit enough logins for
 * distinct addresses to fill the map, and have the victim's counter evicted as
 * "closest to expiring". The account came back with a fresh allowance, on
 * demand, for as long as they cared to repeat it.
 *
 * The per-account limit is the one that actually stops password guessing — it
 * holds however many addresses an attacker spreads across — so this was the
 * limiter's off switch.
 */

const WINDOW = 60_000;
const LIMIT = 8;
/** Must exceed MAX_TRACKED_KEYS in the implementation. */
const FLOOD = 10_050;

beforeEach(() => resetRateLimits());

describe("a throttled key survives a flood", () => {
  test("the victim stays refused after the map is filled with fresh keys", () => {
    const victim = "email:victim@fixture.test";

    // Guess until the account is throttled.
    let last = hit(victim, LIMIT, WINDOW);
    for (let i = 1; i < LIMIT + 1; i++) last = hit(victim, LIMIT, WINDOW);
    expect(last.allowed, "the account should be throttled before the flood").toBe(false);

    // Fill the map with distinct live keys, as an attacker would.
    for (let i = 0; i < FLOOD; i++) hit(`email:flood-${i}@fixture.test`, LIMIT, WINDOW);

    // The whole point: the victim must still be refused.
    const after = hit(victim, LIMIT, WINDOW);
    expect(after.allowed, "the flood must not have reset the victim's window").toBe(false);
    expect(after.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("an idle key is still evictable, so the map stays bounded", () => {
    // One key well under its limit, created first and therefore oldest.
    expect(hit("email:idle@fixture.test", LIMIT, WINDOW).allowed).toBe(true);

    for (let i = 0; i < FLOOD; i++) hit(`email:other-${i}@fixture.test`, LIMIT, WINDOW);

    // Evicted, so it starts a fresh window — which is correct for a key that
    // was not being throttled. Nothing is being protected here.
    const after = hit("email:idle@fixture.test", LIMIT, WINDOW);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(LIMIT - 1);
  });
});

describe("the ordinary behaviour is unchanged", () => {
  test("a key is allowed up to its limit and refused after", () => {
    for (let i = 0; i < LIMIT; i++) {
      expect(hit("email:normal@fixture.test", LIMIT, WINDOW).allowed, `attempt ${i + 1}`).toBe(true);
    }
    expect(hit("email:normal@fixture.test", LIMIT, WINDOW).allowed).toBe(false);
  });

  test("remaining counts down and never goes negative", () => {
    const seen: number[] = [];
    for (let i = 0; i < LIMIT + 3; i++) {
      seen.push(hit("email:counting@fixture.test", LIMIT, WINDOW).remaining);
    }
    expect(seen.slice(0, LIMIT)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(seen.every((n) => n >= 0)).toBe(true);
  });
});
