/**
 * Active-Instructor Average Hours, per university, over a period.
 *
 * ── The confirmed formula — the third and final version ────────────────────
 * Two earlier designs were built and discarded, on purpose, and this file's
 * whole shape exists to make sure a fourth accidental variant does not creep
 * back in:
 *
 *   full-roster        divided by everyone on the roster, reporting or not.
 *                       Correct for a different question — "how is my whole
 *                       team doing" — but not this one.
 *   average-of-averages compute each day's average, then average THOSE. Looks
 *                       equivalent to the formula below and is not: it weighs
 *                       every day equally regardless of how many instructors
 *                       were active on it, so a lone instructor's Tuesday
 *                       counts exactly as much as a Monday with twelve.
 *
 * The confirmed formula is neither: ONE sum of minutes, ONE sum of counts,
 * ONE division, over however many days the period spans.
 *
 *   Average = Σ(active minutes, every active day)
 *             ────────────────────────────────────
 *             Σ(active instructor count, every active day)
 *
 * A day with zero active instructors contributes 0 to both sums — which is
 * to say it contributes nothing, not that it forces a special case. There is
 * no per-day division and nothing here is ever averaged twice.
 *
 * ── "Active", precisely ─────────────────────────────────────────────────
 * An instructor is active on a day if their logged minutes that day — the
 * same figure the rest of this product calls Working Hours, i.e. time union-
 * ed across productive-activity intervals — is strictly greater than zero.
 * Nothing submitted and a submission that summed to exactly 0m are the same
 * case: both are simply ABSENT from that day's sum and count, never present
 * as a zero.
 *
 * ── Worked example (the one this file is verified against) ────────────────
 *   Mon: 2 active, 285m   Tue: 3 active, 390m   Wed: 2 active, 330m
 *   Thu: 2 active, 240m   Fri: 3 active, 360m
 *   Σ minutes = 285+390+330+240+360 = 1605
 *   Σ count   = 2+3+2+2+3 = 12
 *   Average   = 1605 ÷ 12 = 133.75m = 2h 13.75m
 * `tests/average-hours.test.ts` asserts this exact input produces exactly
 * 133.75 — not 1h 47m, which is what "unique instructors × days" (also
 * considered, also wrong for this question) would have produced instead.
 *
 * ── Integers until the one division that is allowed to not be one ─────────
 * Every value in and out of this function is whole minutes. The single
 * division at the end may legitimately land on a fraction — 133.75 above is
 * not a rounding artifact, it is the exact and correct answer to 1605 ÷ 12,
 * computed once, on real integers. Nothing here ever passes a value through
 * decimal HOURS at any intermediate step; `1605 / 60 = 26.75` hours, divided
 * again, would compound whatever rounding that first conversion introduced.
 * Display formatting (`formatActiveAverage`, below) is the one place a
 * fractional minute is ever rendered, and it is never fed back into more
 * arithmetic.
 */

/** One day's precomputed figures, read from `UniversityDailyMetric`. */
export type UniversityDay = {
  /** YYYY-MM-DD. Unused by the arithmetic itself; carried for callers. */
  date: string;
  /** That day's `activeInstructorMinutes` — 0 on a day nobody was active. */
  activeMinutes: number;
  /** That day's `activeInstructorCount` — 0 on a day nobody was active. */
  activeCount: number;
};

export type Average = {
  /**
   * Whole minutes in, a possibly-fractional minutes value out. Null when the
   * period had no active instructor at all — an unknown/undefined average,
   * never a silent 0 and never a division by zero.
   */
  minutes: number | null;
};

/**
 * The confirmed formula, and nothing else: sum every day's active minutes,
 * sum every day's active count, divide once. Works unchanged for a Day view
 * (one day in, the sum-of-one reduces to that day's own total ÷ its own
 * count), a Week view (five to seven days) or a Month view (however many the
 * month spans) — there is no separate per-granularity code path to keep in
 * step, because the formula does not change shape at any of them.
 */
export function averageActiveMinutes(days: readonly UniversityDay[]): Average {
  let numerator = 0;
  let denominator = 0;
  for (const day of days) {
    numerator += day.activeMinutes;
    denominator += day.activeCount;
  }
  if (denominator === 0) return { minutes: null };
  return { minutes: numerator / denominator };
}

/**
 * `Xh Ym` for a possibly-fractional minutes value.
 *
 * Distinct from `workingHours` in `worklog-report.ts`, which rounds to the
 * nearest whole minute — correct there, because a stored entry's duration
 * always IS a whole minute. This feature's average genuinely is not one; the
 * worked example's 133.75 is the real, exact result of a single division,
 * and rounding it away here would erase the one place in this feature a
 * fraction is supposed to survive. The fractional part is shown to two
 * decimal places, trimmed of a trailing `.00` so a division that happens to
 * land on a whole minute reads as one.
 */
export function formatActiveAverage(minutes: number | null): string {
  if (minutes === null) return "—";
  const sign = minutes < 0 ? "-" : "";
  /* Rounded to the nearest hundredth of a minute before any further
   * arithmetic, so float noise from the division upstream (an exact 300
   * landing as 299.99999999999994, say) cannot split into something
   * inconsistent like "4h 60m" once the remainder below is rounded too. */
  const abs = Math.round(Math.abs(minutes) * 100) / 100;
  const hours = Math.floor(abs / 60);
  const rest = Math.round((abs - hours * 60) * 100) / 100;
  const restLabel = Number.isInteger(rest) ? String(rest) : rest.toString();
  return `${sign}${hours}h ${restLabel}m`;
}
