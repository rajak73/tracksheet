/**
 * How long a worklog parse is allowed to take, in one place.
 *
 * ── Why this is shared ────────────────────────────────────────────────────
 * Two things need the same answer and had two different ones. The server
 * retries a parse six times with growing backoff. The instructor's page offers
 * "this looks stuck, try again" once a parse has been pending a while, and that
 * threshold was FOUR minutes with a comment claiming it was "past any parse the
 * provider has taken, including its retries".
 *
 * It was not. Six attempts at forty-five seconds is four and a half minutes of
 * provider time alone, and the backoff adds another seventy-five seconds. So a
 * parse that was still working was described to the instructor as stalled, and
 * the button offered them a second parse of the same submission while the first
 * was still running.
 *
 * Deriving both from the same numbers is the only way that stays true when one
 * of them changes.
 */

/** Attempts, including the first. */
export const PARSE_ATTEMPTS = 6;

/** Backoff before attempt N is `RETRY_BASE_MS * (N - 1)`. */
export const RETRY_BASE_MS = 5_000;

/**
 * Per-attempt provider timeout. The server may raise this with
 * GEMINI_WORKLOG_TIMEOUT_MS; the browser cannot read that, so the bound below
 * is computed from the default. Raising the variable without raising this makes
 * the page impatient again.
 */
export const PARSE_TIMEOUT_MS = 45_000;

/** Total backoff across all attempts: 5s + 10s + 15s + 20s + 25s. */
const TOTAL_BACKOFF_MS =
  ((PARSE_ATTEMPTS - 1) * PARSE_ATTEMPTS * RETRY_BASE_MS) / 2 - (PARSE_ATTEMPTS - 1) * 0;

/**
 * The longest a parse can legitimately run before anything has gone wrong:
 * every attempt timing out, with every backoff paid. 5m45s at the defaults.
 */
export const MAX_PARSE_MS = PARSE_ATTEMPTS * PARSE_TIMEOUT_MS + TOTAL_BACKOFF_MS;
