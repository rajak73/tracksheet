/**
 * Phase 0 §3.2 / §3.3 — tenant-local calendar arithmetic.
 *
 * "What working day is this?" is a per-university question, because each
 * university has its own IANA timezone. Everything here derives that from an
 * instant plus a zone, and never from the server's or the browser's local time.
 *
 * These functions are the groundwork for the once-per-working-day constraint on
 * DAILY_OPENING / DAILY_CLOSING: Phase 3's tables store the `workDate` produced
 * here and carry a unique index on it. A timestamp alone cannot express that
 * rule, which is why the derivation lives here from Phase 1 onward.
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsCache.set(timeZone, fmt);
  }
  return fmt;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedParts = {
  /** Calendar date in the university's zone, as `YYYY-MM-DD`. */
  workDate: string;
  /** 0 = Sunday … 6 = Saturday, matching UniversityWorkingHours.dayOfWeek. */
  dayOfWeek: number;
  /** Minutes since local midnight, matching the working-hours columns. */
  minutesSinceMidnight: number;
};

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }
}

/** Decomposes an instant into the university's local calendar terms. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // Intl renders midnight as hour "24" in some engines; normalise it.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));

  return {
    workDate: `${get("year")}-${get("month")}-${get("day")}`,
    dayOfWeek: WEEKDAY_INDEX[get("weekday")] ?? 0,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

/**
 * The working day an instant belongs to, in the university's timezone.
 * This is the value Phase 3 persists and uniquely indexes per instructor.
 */
export function workDateFor(instant: Date, timeZone: string): string {
  return zonedParts(instant, timeZone).workDate;
}

/**
 * Converts a `YYYY-MM-DD` + minutes-since-local-midnight into a UTC instant,
 * resolving the zone's offset for that specific date (so DST is handled rather
 * than assumed away).
 *
 * ── A wall-clock time that does not exist ─────────────────────────────────
 * On the morning the clocks go forward, an hour is skipped: at America/New_York
 * on 2026-03-08 there is no 02:30. Asked for one, this resolves it onto the
 * pre-transition offset, which lands on the same instant as 01:30.
 *
 * That is deliberate, and it is what most date libraries do — the alternatives
 * are throwing, which turns a configuration edge case into a failed request, or
 * shifting forward, which silently moves an appointment an hour later than it
 * was written. Verified rather than assumed: both transitions round-trip
 * correctly for every hour that DOES exist, and a spring-forward day measures
 * 23 hours while a fall-back day measures 25.
 *
 * It has no effect on this product's working windows, which run 09:00 to 18:00.
 * It would matter to a university configured to open inside the skipped hour,
 * and that is the case to revisit if one ever is.
 */
export function zonedToUtc(workDate: string, minutesSinceMidnight: number, timeZone: string): Date {
  const [y, m, d] = workDate.split("-").map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, 0, minutesSinceMidnight);

  // Offset is itself date-dependent, so resolve it twice: once against the
  // naive guess, then again against the corrected instant to settle DST edges.
  let instant = new Date(naiveUtc - offsetMs(new Date(naiveUtc), timeZone));
  instant = new Date(naiveUtc - offsetMs(instant, timeZone));
  return instant;
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const [y, m, d] = p.workDate.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, 0, p.minutesSinceMidnight, instant.getUTCSeconds());
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Converts a `YYYY-MM-DD` into the DATE value Prisma stores for holidays. */
export function toDateOnly(workDate: string): Date {
  const [y, m, d] = workDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
