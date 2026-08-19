/**
 * Gemini Flash provider — the ONLY file that knows this vendor exists.
 *
 * Everything above it deals in `AnomalyCondition` and plain strings, so
 * changing provider means rewriting this file and nothing else.
 *
 * ── What is deliberately NOT sent ──────────────────────────────────────────
 * No activity rows, and no personal names. The narration needs a grammatical
 * subject, not an identity, so the request carries the placeholder
 * `{{SUBJECT}}` and the real name is substituted locally after the response
 * comes back. A third party phrasing a sentence about utilisation has no need
 * to learn who the person is, and the substitution costs nothing.
 *
 * The request therefore contains: the condition type, the metric values that
 * triggered it, and the threshold compared against. That is exactly the
 * traceability payload already stored with every insight — nothing more.
 *
 * ── Failure handling ───────────────────────────────────────────────────────
 * Every failure mode returns `{ ok: false }` rather than throwing: a timeout,
 * a rate limit from Gemini, an HTTP error, a malformed body, or an empty
 * candidate. The caller falls back to deterministic narration, so a provider
 * outage degrades the wording of an insight rather than stopping insight
 * generation altogether.
 */

import type { AnomalyCondition } from "@/server/ai/anomalies";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
/**
 * The models to try, in order.
 *
 * ── Why a list and not one name ───────────────────────────────────────────
 * Two different failures have already been observed against this API, and each
 * defeats the obvious fix for the other:
 *
 *   RETIREMENT  `gemini-2.0-flash` and `gemini-2.5-flash` were withdrawn. Every
 *               call became a 404 and the whole AI layer degraded silently to
 *               deterministic text. A pinned version cannot survive that.
 *
 *   OVERLOAD    `gemini-flash-latest` — the alias that fixes retirement —
 *               returns 503 "experiencing high demand" for minutes at a time,
 *               while other current models answer in under a second. An alias
 *               alone cannot survive that either.
 *
 * So: an alias first, so a retirement is invisible, and named alternates behind
 * it, so a busy alias is also invisible. Only capacity failures (429/503) move
 * down the list — a 400 or a 404 would fail identically on the next model and
 * retrying it would just cost the caller time.
 *
 * `GEMINI_MODEL` still pins one model when a specific one is wanted; setting it
 * disables the fallbacks, because the point of pinning is to get that model.
 */
const MODEL_CHAIN: string[] = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3.1-flash-lite"];

/** Statuses that mean "this model is busy", not "this request is wrong". */
const CAPACITY_STATUSES = new Set([429, 503]);
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 8_000);

/** Placeholder the model is asked to use; replaced with the real name locally. */
export const SUBJECT_TOKEN = "{{SUBJECT}}";

export type GeminiOutcome =
  | { ok: true; summary: string; recommendation: string }
  | { ok: false; reason: string };

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * The exact payload sent upstream. Exported so a test can assert on it, and so
 * it is obvious by reading one function what leaves this system.
 */
export function buildGeminiRequest(condition: AnomalyCondition) {
  const facts = {
    condition: condition.type,
    severity: condition.severity,
    scope: condition.scope,
    metrics: condition.metrics,
    threshold: condition.threshold,
  };

  const instruction = [
    "You are writing one factual sentence pair for a workforce analytics dashboard.",
    "",
    "A deterministic engine has ALREADY decided that the condition below holds.",
    "Your job is only to phrase it. Do not decide whether it is true, do not",
    "introduce any other condition, and do not add numbers that are not in the",
    "facts given.",
    "",
    "Rules:",
    `- Refer to the subject only as ${SUBJECT_TOKEN}. Never invent a name.`,
    "- Use only the numbers present in the facts. Quote them exactly.",
    "- Describe the measurement. Never characterise a person's effort, attitude",
    "  or competence. 'Recorded utilisation of 42%' is allowed;",
    "  'underperforming' is not.",
    "- Where recorded time is low, allow that it may not have been logged rather",
    "  than not worked.",
    "- Recommend a review. Never a staffing decision.",
    "",
    'Reply with JSON only: {"summary": "...", "recommendation": "..."}',
    "",
    `Facts: ${JSON.stringify(facts)}`,
  ].join("\n");

  return {
    contents: [{ role: "user", parts: [{ text: instruction }] }],
    generationConfig: {
      // Low temperature: this is phrasing, not creativity.
      temperature: 0.2,
      maxOutputTokens: 300,
      responseMimeType: "application/json",
    },
  };
}

/* ── The single exit point ─────────────────────────────────────────────────── */

type Transport =
  | { ok: true; body: unknown }
  /** `retryable` marks a capacity failure — worth trying the next model. */
  | { ok: false; reason: string; retryable?: boolean };

/**
 * Every request to the provider goes through here.
 *
 * Key handling, base URL, model, abort behaviour and failure classification
 * existed in duplicate across the two public functions; a third caller (document
 * extraction) would have made it triplicate, and the copies would eventually
 * disagree about what "rate limited" means. One function now owns all of it, so
 * there is still exactly ONE place to read to know what leaves this system.
 *
 * `timeoutMs` is a parameter rather than the module constant because the calls
 * are not comparable: phrasing one sentence is a sub-second job, while
 * extracting a roster from a scanned PDF is not, and an 8-second ceiling would
 * abort every document before the provider finished reading it.
 */
async function postGenerate(body: unknown, timeoutMs: number): Promise<Transport> {
  const apiKey = process.env.GEMINI_API_KEY;
  // The substring "GEMINI_API_KEY" is load-bearing: callers distinguish
  // "not configured" from "provider is down" by looking for it.
  if (!apiKey) return { ok: false, reason: "GEMINI_API_KEY not configured" };

  const baseUrl = process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL;
  let last: Transport = { ok: false, reason: "no model was attempted" };

  for (const model of MODEL_CHAIN) {
    last = await attempt(`${baseUrl}/models/${model}:generateContent`, apiKey, body, timeoutMs);
    if (last.ok) return last;
    // Anything that is not a capacity problem will fail the same way on the
    // next model, so stop rather than spending the caller's time on it.
    if (!last.retryable) return last;
  }

  return last;
}

/** One request to one model. Every failure is classified, never thrown. */
async function attempt(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<Transport> {
  // AbortController rather than Promise.race: an abandoned request still holds
  // a socket, and a slow provider must not pin connections.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      // The key goes in a header, never the URL — query strings end up in
      // proxy and access logs.
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (CAPACITY_STATUSES.has(res.status)) {
      return {
        ok: false,
        retryable: true,
        reason:
          res.status === 429 ? "rate limited by provider" : "provider returned HTTP 503",
      };
    }
    if (!res.ok) return { ok: false, reason: `provider returned HTTP ${res.status}` };

    return { ok: true, body: await res.json().catch(() => null) };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "unknown transport error";
    // A timeout may well be this model being slow; the next one is worth a try.
    return { ok: false, retryable: true, reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls the candidate text out of a provider response, or null. */
function candidateText(body: unknown): string | null {
  const text = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

function parseCandidate(body: unknown): { summary: string; recommendation: string } | null {
  const text = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.trim() === "") return null;

  try {
    const parsed = JSON.parse(text) as { summary?: unknown; recommendation?: unknown };
    if (typeof parsed.summary !== "string" || typeof parsed.recommendation !== "string") {
      return null;
    }
    if (parsed.summary.trim() === "" || parsed.recommendation.trim() === "") return null;
    return { summary: parsed.summary.trim(), recommendation: parsed.recommendation.trim() };
  } catch {
    return null;
  }
}

export async function generateNarration(condition: AnomalyCondition): Promise<GeminiOutcome> {
  const outcome = await postGenerate(buildGeminiRequest(condition), TIMEOUT_MS);
  if (!outcome.ok) return outcome;

  const parsed = parseCandidate(outcome.body);
  if (!parsed) return { ok: false, reason: "malformed or empty response" };

  return { ok: true, ...parsed };
}

/**
 * A single structured-JSON call, for callers that need something other than a
 * condition narration.
 *
 * The caller supplies the whole instruction and parses its own shape, because
 * the features that use this want different payloads and a shared "generic"
 * schema would fit neither. Returns the raw candidate TEXT, so a malformed
 * model response is a handled outcome rather than an exception.
 *
 * ── `document` reverses this module's privacy stance, deliberately ──────────
 * Everything else here is built so no personal name ever leaves the process —
 * that is what {@link SUBJECT_TOKEN} exists for. Passing a `document` sends the
 * file's BYTES, which for a staff roster means every name, email and employee
 * code in it. That is not an oversight to be tidied up later: it is the whole
 * point of document extraction, and it cannot be done without it. So it is a
 * separate, explicit, opt-in parameter rather than something a caller can
 * enable by accident, it is reached only from an ADMIN-initiated upload, and
 * the extracted result is still validated deterministically afterwards — the
 * provider reads the file, it does not decide what enters the database.
 */
export async function generateStructured(
  instruction: string,
  opts: {
    maxOutputTokens?: number;
    /** Overrides the module timeout. Document extraction needs far longer. */
    timeoutMs?: number;
    /** A file to read, sent inline. See the warning above. */
    document?: { mimeType: string; base64: string };
  } = {},
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const parts: Array<Record<string, unknown>> = [{ text: instruction }];
  if (opts.document) {
    parts.push({ inlineData: { mimeType: opts.document.mimeType, data: opts.document.base64 } });
  }

  const outcome = await postGenerate(
    {
      contents: [{ role: "user", parts }],
      generationConfig: {
        // Low temperature: this is reporting and extraction, not writing.
        // Bounded output so a runaway response cannot cost more than the
        // answer is worth.
        temperature: 0.2,
        maxOutputTokens: opts.maxOutputTokens ?? 700,
        responseMimeType: "application/json",
      },
    },
    opts.timeoutMs ?? TIMEOUT_MS,
  );
  if (!outcome.ok) return outcome;

  const text = candidateText(outcome.body);
  if (text === null) return { ok: false, reason: "malformed or empty response" };
  return { ok: true, text };
}
