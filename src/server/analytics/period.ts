import { ApiError } from "@/server/http/errors";
import { assertValidDate } from "@/server/time/schedule-windows";
import { workDateFor } from "@/server/time/workday";

export type Period = { from: string; to: string };

const MAX_DAYS = 366;

/**
 * Resolves the reporting period from query parameters.
 *
 * Both bounds are explicit in the response so a caller can never be unsure
 * which window a number covers. When omitted, the default is the trailing seven
 * days computed in the UNIVERSITY's timezone — never the server's, so "this
 * week" means the same thing to a manager in Kolkata and one in New York.
 */
export function resolvePeriod(params: URLSearchParams, timezone: string): Period {
  const from = params.get("from");
  const to = params.get("to");

  if (!from && !to) {
    const todayLocal = workDateFor(new Date(), timezone);
    const [y, m, d] = todayLocal.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d));
    start.setUTCDate(start.getUTCDate() - 6);
    return { from: workDateFor(start, "UTC"), to: todayLocal };
  }

  if (!from || !to) {
    throw new ApiError(400, "INVALID_PERIOD", "Provide both ?from= and ?to=, or neither");
  }

  assertValidDate(from);
  assertValidDate(to);

  if (from > to) {
    throw new ApiError(400, "INVALID_PERIOD", "`from` must not be after `to`");
  }

  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > MAX_DAYS) {
    throw new ApiError(400, "INVALID_PERIOD", `Period may not exceed ${MAX_DAYS} days`);
  }

  return { from, to };
}
