/**
 * Phase 2 — the ONLY place opening/closing window math happens.
 *
 * Builds on `workday.ts` (tenant-local calendar derivation) and is called by
 * API routes today and by the Phase 6 analytics engine later. Nothing else in
 * the codebase may compute a window, a duration, or a working-day status — if
 * you find yourself writing `* 60` outside this file, it belongs in here.
 *
 * Every function is pure: it takes a plain configuration object and a date, and
 * returns a result. No database access, no clock reads, no ambient state. That
 * is what makes two universities computable simultaneously without any chance
 * of leaking state between them.
 */

import { ApiError } from "@/server/http/errors";
import { assertValidTimeZone, zonedParts, zonedToUtc } from "@/server/time/workday";

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A university's complete time configuration, as consumed by this module. */
export type UniversityTimeConfig = {
  id: string;
  timezone: string;
  /** Configurable per university; never assume 15 (Phase 2 requirement). */
  openingDurationMin: number;
  closingDurationMin: number;
  workingHours: ReadonlyArray<{
    dayOfWeek: number;
    isWorkingDay: boolean;
    startMinute: number;
    endMinute: number;
  }>;
  /** Calendar dates as `YYYY-MM-DD` in the university's own timezone. */
  holidays: ReadonlyArray<{ date: string; name: string }>;
};

export type NonWorkingReason = "NOT_A_WORKING_DAY" | "HOLIDAY";

export type ActivityWindow = {
  startMinute: number;
  endMinute: number;
  /** Local wall-clock `HH:MM` in the university's timezone. */
  startLocal: string;
  endLocal: string;
  /** The same instants in UTC, DST-correct for this specific date. */
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
};

export type DayWindows = {
  universityId: string;
  timezone: string;
  date: string;
  dayOfWeek: number;
  isWorkingDay: boolean;
  /** Why the day is non-working; null when it is a working day. */
  nonWorkingReason: NonWorkingReason | null;
  holiday: { date: string; name: string } | null;
  workingHours: ActivityWindow | null;
  /**
   * Exactly one opening and one closing window per working day — singular
   * objects, deliberately not arrays. Opening/closing are once-per-working-day
   * activities tied to the university's hours, so there is no shape here that
   * could express "one per class".
   */
  opening: ActivityWindow | null;
  closing: ActivityWindow | null;
  /** Non-fatal configuration problems, surfaced rather than silently absorbed. */
  warnings: string[];
};

/** `HH:MM` from minutes since local midnight. */
function formatLocal(minutes: number): string {
  const h = Math.floor(minutes / MINUTES_PER_HOUR);
  const m = minutes % MINUTES_PER_HOUR;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function assertValidDate(date: string): void {
  if (!DATE_PATTERN.test(date)) {
    throw new ApiError(400, "INVALID_DATE", "Date must be formatted YYYY-MM-DD");
  }
  const [y, m, d] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new ApiError(400, "INVALID_DATE", `${date} is not a real calendar date`);
  }
}

function buildWindow(
  date: string,
  startMinute: number,
  endMinute: number,
  timezone: string,
): ActivityWindow {
  return {
    startMinute,
    endMinute,
    startLocal: formatLocal(startMinute),
    endLocal: formatLocal(endMinute),
    startUtc: zonedToUtc(date, startMinute, timezone).toISOString(),
    endUtc: zonedToUtc(date, endMinute, timezone).toISOString(),
    durationMinutes: endMinute - startMinute,
  };
}

/** The day-of-week index for a calendar date, in the university's timezone. */
export function dayOfWeekFor(date: string, timezone: string): number {
  // Noon avoids any chance of a DST shift moving the date across a boundary.
  const noonUtc = zonedToUtc(date, 12 * MINUTES_PER_HOUR, timezone);
  return zonedParts(noonUtc, timezone).dayOfWeek;
}

/**
 * Whether a date is a working day for this university.
 *
 * Two independent gates, in this order:
 *   1. the day-of-week must be configured as a working day, then
 *   2. the date must not be a holiday.
 *
 * A holiday on an already-non-working weekday reports NOT_A_WORKING_DAY, since
 * that is the more fundamental reason.
 */
export function resolveWorkingDay(
  config: UniversityTimeConfig,
  date: string,
): {
  dayOfWeek: number;
  isWorkingDay: boolean;
  nonWorkingReason: NonWorkingReason | null;
  holiday: { date: string; name: string } | null;
  hours: { startMinute: number; endMinute: number } | null;
} {
  assertValidDate(date);
  const dayOfWeek = dayOfWeekFor(date, config.timezone);
  const configured = config.workingHours.find((h) => h.dayOfWeek === dayOfWeek);
  const holiday = config.holidays.find((h) => h.date === date) ?? null;

  if (!configured || !configured.isWorkingDay) {
    return { dayOfWeek, isWorkingDay: false, nonWorkingReason: "NOT_A_WORKING_DAY", holiday, hours: null };
  }

  if (holiday) {
    return { dayOfWeek, isWorkingDay: false, nonWorkingReason: "HOLIDAY", holiday, hours: null };
  }

  return {
    dayOfWeek,
    isWorkingDay: true,
    nonWorkingReason: null,
    holiday: null,
    hours: { startMinute: configured.startMinute, endMinute: configured.endMinute },
  };
}

/**
 * The full computed picture for one university on one date.
 *
 * Opening runs from the start of the working day for `openingDurationMin`;
 * closing ends at the end of the working day, starting `closingDurationMin`
 * earlier. Both durations come from configuration — no literal appears here.
 */
export function computeDayWindows(config: UniversityTimeConfig, date: string): DayWindows {
  const resolved = resolveWorkingDay(config, date);
  const warnings: string[] = [];

  const base = {
    universityId: config.id,
    timezone: config.timezone,
    date,
    dayOfWeek: resolved.dayOfWeek,
    isWorkingDay: resolved.isWorkingDay,
    nonWorkingReason: resolved.nonWorkingReason,
    holiday: resolved.holiday,
  };

  if (!resolved.isWorkingDay || !resolved.hours) {
    // A non-working day has no windows at all. Callers must treat this as
    // "nothing was expected", never as "zero hours worked" (Phase 0 §3.5).
    return { ...base, workingHours: null, opening: null, closing: null, warnings };
  }

  const { startMinute, endMinute } = resolved.hours;
  const openingEnd = startMinute + config.openingDurationMin;
  const closingStart = endMinute - config.closingDurationMin;

  if (openingEnd > closingStart) {
    warnings.push(
      "OPENING_CLOSING_OVERLAP: configured opening and closing durations exceed the working day",
    );
  }

  return {
    ...base,
    workingHours: buildWindow(date, startMinute, endMinute, config.timezone),
    opening: buildWindow(date, startMinute, openingEnd, config.timezone),
    closing: buildWindow(date, closingStart, endMinute, config.timezone),
    warnings,
  };
}

/**
 * Validates a prospective configuration before it is persisted, so an invalid
 * combination is rejected at the API boundary rather than producing nonsense
 * windows later.
 */
export function validateTimeConfig(config: {
  timezone: string;
  openingDurationMin: number;
  closingDurationMin: number;
  workingHours: ReadonlyArray<{
    dayOfWeek: number;
    isWorkingDay: boolean;
    startMinute: number;
    endMinute: number;
  }>;
}): void {
  try {
    assertValidTimeZone(config.timezone);
  } catch {
    throw new ApiError(400, "INVALID_TIMEZONE", `Unknown IANA timezone: ${config.timezone}`);
  }

  if (config.openingDurationMin <= 0 || config.closingDurationMin <= 0) {
    throw new ApiError(400, "INVALID_DURATION", "Opening and closing durations must be positive");
  }

  const seen = new Set<number>();
  for (const h of config.workingHours) {
    if (h.dayOfWeek < 0 || h.dayOfWeek > 6) {
      throw new ApiError(400, "INVALID_WORKING_HOURS", `dayOfWeek ${h.dayOfWeek} is out of range`);
    }
    if (seen.has(h.dayOfWeek)) {
      throw new ApiError(400, "INVALID_WORKING_HOURS", `Duplicate entry for dayOfWeek ${h.dayOfWeek}`);
    }
    seen.add(h.dayOfWeek);

    if (h.startMinute < 0 || h.endMinute > MINUTES_PER_DAY || h.startMinute >= h.endMinute) {
      throw new ApiError(
        400,
        "INVALID_WORKING_HOURS",
        `dayOfWeek ${h.dayOfWeek} has a malformed window`,
      );
    }

    if (!h.isWorkingDay) continue;

    const span = h.endMinute - h.startMinute;
    if (config.openingDurationMin + config.closingDurationMin > span) {
      throw new ApiError(
        400,
        "INVALID_DURATION",
        `Opening + closing (${config.openingDurationMin + config.closingDurationMin} min) ` +
          `exceeds the ${span} min working day on dayOfWeek ${h.dayOfWeek}`,
      );
    }
  }
}
