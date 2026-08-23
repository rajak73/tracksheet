/**
 * Average working hours per instructor, over a period.
 *
 * ── The denominator is the WHOLE roster ───────────────────────────────────
 * Every instructor on it, whether or not they recorded anything. An instructor
 * who logged nothing counts as a zero and pulls the average down, and that is
 * the point rather than a side effect: the number a manager needs is "what is
 * my team averaging", and a team where three people filed nothing IS averaging
 * less.
 *
 * Dividing by only those who submitted answers a different and much less useful
 * question — "what did the people who filed, file" — and it hides precisely the
 * signal this screen exists to surface. It also moves the wrong way: the worse
 * reporting gets, the higher that number climbs, so a university where half the
 * staff stopped recording would look like its best month.
 *
 * ── No percentage, deliberately ───────────────────────────────────────────
 * This replaces nothing that shipped, but it deliberately does not become what
 * was tried before: recorded time against a configured capacity. That measured
 * a day of meetings exactly like a day of lectures, so it moved for reasons
 * nobody could act on. An average implies no target and states a fact.
 */

/** One day of a university's stored metrics. */
export type UniversityDay = {
  /** YYYY-MM-DD. */
  date: string;
  /** Everything recorded that day, across the whole university. */
  minutes: number;
  /** How many instructors were on the roster that day, reporting or not. */
  roster: number;
};

export type Average = {
  /** Null when the period holds no metrics at all — unknown, not zero. */
  minutes: number | null;
  /** The roster the average was taken against. */
  roster: number;
};

/**
 * The average, and the roster it was divided by.
 *
 * ── A roster that changed size during the period ──────────────────────────
 * The rule, stated once so nobody has to infer it: **the roster on the LAST
 * day of the period that has any metrics.**
 *
 * The alternatives were considered and are worse for this figure:
 *
 *   the first day      describes a team that no longer exists, and a new
 *                      joiner's hours would be divided among people who did
 *                      not include them
 *   the largest        flatters nobody and punishes growth — hiring on the
 *                      28th would drop the whole month's average
 *   everyone who
 *   appeared at all    the same problem, and it counts somebody who left on
 *                      the 2nd against a full month of everybody else's work
 *
 * The last day answers the question an administrator is actually asking, which
 * is about the team they have now: "on average, what has each of my
 * instructors recorded this month". A joiner does dilute it — they genuinely
 * are one of the people the average is about, and their partial month is real
 * — and a leaver stops counting once they are gone.
 *
 * "Last day WITH METRICS" rather than the literal last date of the period,
 * because the rollup trails by up to an hour and a period in progress has no
 * row for the rest of it. Reading the latest day that exists is the same
 * answer, one rollup later.
 */
export function averageMinutesPerInstructor(days: readonly UniversityDay[]): Average {
  if (days.length === 0) return { minutes: null, roster: 0 };

  const total = days.reduce((n, d) => n + Math.max(0, d.minutes), 0);

  /* The latest day that HAS a roster. A day with metrics but no instructors —
   * a university before anybody is added — must not be read as the roster
   * having shrunk to nothing while the days before it had people. */
  const roster = [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .reduce((latest, day) => (day.roster > 0 ? day.roster : latest), 0);

  // No roster means no per-instructor average exists — not an average of zero.
  if (roster === 0) return { minutes: null, roster: 0 };

  return { minutes: Math.round(total / roster), roster };
}
