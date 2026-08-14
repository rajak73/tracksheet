import { ApiError } from "@/server/http/errors";

/**
 * Query-parameter parsing that fails as 400, not 500.
 *
 * Several routes read a caller-supplied value and handed it straight to
 * Prisma — `new Date("notadate")` becomes Invalid Date, `Number("abc")`
 * becomes NaN, and Prisma throws deep in the driver. The wrapper turned that
 * into `500 INTERNAL_ERROR`, which tells the caller nothing and looks like a
 * server fault when the request was simply malformed.
 *
 * The analytics/windows/schedule/metrics routes already validated correctly
 * via `assertValidDate`/`resolvePeriod`; these helpers exist so the remaining
 * routes reach the same behaviour without each inventing its own rules.
 */

/**
 * A bounded positive integer.
 *
 * Rejects NaN, Infinity and non-numeric text, and clamps into range. Negative
 * values previously slipped through: Prisma reads a negative `take` as "last
 * N", silently reversing page semantics instead of erroring.
 */
export function parseLimit(
  raw: string | null,
  { fallback, max }: { fallback: number; max: number },
): number {
  if (raw === null || raw.trim() === "") return fallback;

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ApiError(400, "INVALID_LIMIT", "limit must be a number");
  }
  const i = Math.trunc(n);
  if (i < 1) {
    throw new ApiError(400, "INVALID_LIMIT", "limit must be at least 1");
  }
  return Math.min(max, i);
}

/**
 * An optional `YYYY-MM-DD` filter bound, returned as a real Date.
 *
 * A bare `new Date(x)` accepts far too much (`"2045-13-45"` parses, then
 * overflows into 2046) and returns Invalid Date for anything else, so the
 * calendar fields are checked to round-trip rather than trusting the parser.
 */
export function parseDateParam(raw: string | null, name: string): Date | undefined {
  // Absent and blank are the same thing: no filter. `?from=` and `?from=%20`
  // both mean "the caller didn't pick a bound", not "reject the request" —
  // an empty select in a filter UI serialises exactly this way.
  if (raw === null || raw.trim() === "") return undefined;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ApiError(400, "INVALID_DATE", `${name} must be a YYYY-MM-DD date`);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "INVALID_DATE", `${name} is not a valid date`);
  }
  // Rejects 2045-13-45 and 2045-02-30, which the constructor rolls over.
  if (date.toISOString().slice(0, 10) !== raw) {
    throw new ApiError(400, "INVALID_DATE", `${name} is not a real calendar date`);
  }
  return date;
}
