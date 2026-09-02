/**
 * Does every configured model actually answer?
 *
 * ── Why this is a build step and not a runtime concern ────────────────────
 * `gemini-flash-latest` sat at the head of the chain and returned 404 for this
 * project's key — "no longer available to new users". A 404 is not retryable,
 * so the chain STOPPED there: every AI call in the product failed, and the
 * symptom reaching the screen was a timeout, which points at the network.
 *
 * Nothing in the test suite could see it, because the suite deliberately runs
 * with no provider. The only thing that catches a retired model is asking the
 * provider, and the only useful time to ask is before shipping.
 *
 * An alias is the specific hazard: `-latest` retargets without anybody editing
 * anything, so a chain that worked last month can be dead today with no diff to
 * point at.
 */
import { MODEL_CHAIN, type ChainEntry } from "./gemini";

/** Statuses that mean "busy right now", not "gone". Mirrors the chain's own. */
const CAPACITY_STATUSES = new Set([429, 503]);

export type ModelHealth = {
  model: string;
  ok: boolean;
  /**
   * True when the model refused for CAPACITY — rate limit or quota.
   *
   * Kept apart from `ok` because the two mean opposite things to a build. A 404
   * is a model that has been retired and will never answer again; a 429 is a
   * model that answered yesterday and will answer tomorrow. Failing a build on
   * a quota is how a health check trains people to ignore it.
   */
  capacity: boolean;
  status: number | null;
  /** Round trip in milliseconds, so a slow model is visible before it times out. */
  ms: number;
  detail: string;
};

const TRIVIAL = { contents: [{ role: "user", parts: [{ text: "reply with the single word ok" }] }] };

/** One model, one trivial prompt. Never throws. */
export async function checkModel(entry: ChainEntry, timeoutMs = 20_000): Promise<ModelHealth> {
  const apiKey = process.env.GEMINI_API_KEY;
  const baseUrl = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const started = Date.now();

  if (!apiKey) {
    return {
      model: entry.model,
      ok: false,
      capacity: false,
      status: null,
      ms: 0,
      detail: "GEMINI_API_KEY not configured",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/models/${entry.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(TRIVIAL),
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      /* The body carries the sentence that explains it — "no longer available
         to new users" is the difference between a typo and a retirement, and a
         bare status code makes somebody go and find that out by hand. */
      const body = await res.text().catch(() => "");
      const message = (() => {
        try {
          return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
        } catch {
          return body;
        }
      })();
      return {
        model: entry.model,
        ok: false,
        capacity: CAPACITY_STATUSES.has(res.status),
        status: res.status,
        ms,
        detail: String(message).slice(0, 300),
      };
    }
    return { model: entry.model, ok: true, capacity: false, status: res.status, ms, detail: "answered" };
  } catch (error) {
    return {
      model: entry.model,
      ok: false,
      capacity: false,
      status: null,
      ms: Date.now() - started,
      detail: error instanceof Error ? error.message : "unknown transport error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Every model in the configured chain, in the order it would be tried. */
export async function checkChain(timeoutMs = 20_000): Promise<ModelHealth[]> {
  const out: ModelHealth[] = [];
  for (const entry of MODEL_CHAIN) out.push(await checkModel(entry, timeoutMs));
  return out;
}

/**
 * A build fails when a configured model is GONE, not when one is busy.
 *
 * ── What each outcome means ───────────────────────────────────────────────
 * A 404 is a retirement: that model will never answer again and the chain will
 * stop dead on it, because a 404 is not retryable. That is the case this check
 * exists for.
 *
 * A 429 or 503 is capacity. The chain is built to fall through those, and the
 * one on this project's key flipped from "answers in 3s" to "quota exceeded"
 * inside an hour of ordinary testing. Failing a build on that teaches people to
 * ignore the check, which costs more than the check is worth.
 *
 * So: any model returning a non-capacity error is a red build, and a chain
 * where every model is capacity-limited is a warning, not a failure.
 */
export function chainVerdict(results: ModelHealth[]): { ok: boolean; reason: string } {
  if (results.length === 0) return { ok: false, reason: "the model chain is empty" };

  const gone = results.filter((r) => !r.ok && !r.capacity);
  if (gone.length > 0) {
    return {
      ok: false,
      reason: gone
        .map((r) => `${r.model} did not answer (${r.status ?? "no status"}): ${r.detail}`)
        .join("; "),
    };
  }
  if (results.every((r) => !r.ok)) {
    return { ok: false, reason: "every model in the chain is capacity-limited right now" };
  }
  return { ok: true, reason: "every configured model is reachable" };
}
