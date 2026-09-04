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
/**
 * ── Thinking is charged to the ANSWER's budget ────────────────────────────
 * Measured against this account, not inferred: `gemini-3.6-flash` asked for
 * `{"ok": true}` with `maxOutputTokens: 64` spends 60 tokens thinking, hits
 * MAX_TOKENS, and returns `"content": {}` — no text at all. Every caller here
 * reads that as "malformed or empty response" and falls back, so the whole AI
 * layer degrades to deterministic text while the provider returns HTTP 200 and
 * the key is perfectly valid. It is the quietest possible failure: nothing is
 * logged, nothing errors, the feature is simply never on.
 *
 * `thinkingLevel: "low"` is the fix, and it is not only a correctness fix —
 * the same call goes from 16.8s to 1.5s. These are extraction and
 * classification jobs against a closed list; they do not need a model to
 * deliberate, and paying for deliberation in the budget reserved for the answer
 * is how the answer goes missing.
 *
 * It is per model because the right setting is not the same for all of them.
 * `gemini-3.1-flash-lite` does not think by default (measured: 0 thought
 * tokens), and SENDING the flag made it start — 24s and a truncated reply. So
 * the flag goes where it helps and nowhere else. `thinkingBudget: 0`, the other
 * spelling, is rejected outright by 3.6-flash with a 400.
 */
export type ChainEntry = { model: string; thinkingLevel?: "low" | "medium" | "high" };

/** The chain as it will actually be tried. Exported so a test can read it. */
export const MODEL_CHAIN: ChainEntry[] = process.env.GEMINI_MODEL
  ? [
      {
        model: process.env.GEMINI_MODEL,
        // Current models think by default and a pinned one is most likely one of
        // them, so the safe default is the one that leaves room for an answer.
        // `GEMINI_THINKING_LEVEL=off` is the way out for a model that does not.
        ...(process.env.GEMINI_THINKING_LEVEL === "off"
          ? {}
          : { thinkingLevel: (process.env.GEMINI_THINKING_LEVEL ?? "low") as "low" }),
      },
    ]
  : [
      /* ── Order measured against the live API, not assumed ─────────────────
       * `gemini-flash-latest` led this chain and returns 404 for this project's
       * key: "This model models/gemini-2.5-flash is no longer available to new
       * users." The alias resolves to a retired model, so every call spent
       * ~2.6s discovering that before the working model was tried — and the
       * 8s chain budget is a budget for the whole chain, so a day extraction
       * that retries once could exhaust it and report a timeout for a provider
       * that was never actually unavailable. That is what it did: the first
       * live extraction came back `provider: timed out after 8000ms`.
       *
       * The known-good model leads. The alias stays behind it rather than being
       * deleted, because it is an alias — it may well resolve to something
       * current for a key provisioned differently, and a chain exists precisely
       * so one entry being wrong is survivable. */
      { model: "gemini-3.6-flash", thinkingLevel: "low" },
      { model: "gemini-flash-latest", thinkingLevel: "low" },
      { model: "gemini-3.1-flash-lite" },
    ];

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
/* `buildGeminiRequest` and `generateNarration` are gone.
 *
 * They turned an `AnomalyCondition` into prose — a graded finding about a named
 * instructor, narrated and then stored against their record or sent to them as
 * a notification. The grader is deleted, so there is no condition to narrate.
 *
 * What stays here is the TRANSPORT: the model chain, the retry, and
 * `generateStructured`. That is how any prompt reaches a model, and the prompts
 * that remain describe how to read somebody's own words rather than which
 * category they fall into. */

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
/**
 * How many requests have left this process for the provider, ever.
 *
 * ── Why a counter lives in production code ────────────────────────────────
 * This codebase holds one architectural rule above the rest: the model is
 * called when raw text becomes structured data, and never again. Every figure
 * after that — a day's hours, a week's, a comparison between months — is
 * arithmetic over stored rows.
 *
 * A rule nobody can check is a convention, and conventions rot. This makes it
 * checkable: a test runs a calculation and asserts the count did not move.
 * Costing one integer to keep honest is the cheapest architectural guard in
 * the system, and it caught a real one — the instructor's report was fetching
 * `/worklog/summary` on every view and discarding the answer, so opening a
 * screen paid for a model call that changed nothing.
 */
let outboundCalls = 0;

/** The running total. Snapshot it, do something, compare. */
export function geminiCallCount(): number {
  return outboundCalls;
}

async function postGenerate(body: unknown, timeoutMs: number): Promise<Transport> {
  const apiKey = process.env.GEMINI_API_KEY;
  // The substring "GEMINI_API_KEY" is load-bearing: callers distinguish
  // "not configured" from "provider is down" by looking for it.
  if (!apiKey) return { ok: false, reason: "GEMINI_API_KEY not configured" };

  const baseUrl = process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL;
  let last: Transport = { ok: false, reason: "no model was attempted" };

  /* ── `timeoutMs` is a budget for EACH attempt ───────────────────────────
   * It was a budget for the whole chain, which was itself a fix for a real
   * problem: every transport failure was retryable, so a hung provider cost
   * `timeoutMs × MODEL_CHAIN.length` before the caller saw a fallback.
   *
   * A shared deadline solved that by making the second model inherit whatever
   * the first left behind — and that turned a dead model at the front into a
   * tax on every call after it. Measured, not theorised: `gemini-flash-latest`
   * 404s for this project's key and takes ~2.6s to say so, leaving 5.4s of an
   * 8s allowance for a model that needs more, and the first live extraction
   * came back "timed out after 8000ms" from a provider that was never down.
   *
   * Each attempt gets its own budget now, and the hang case is handled where it
   * belongs: a TIMEOUT is not retryable. It consumed a full allowance, and the
   * next model has no reason to be faster. A fast failure — 429, 503, a network
   * blip — leaves the clock alone and genuinely deserves the next model. The
   * worst case is one timeout plus some fast failures, not three timeouts. */
  for (const entry of MODEL_CHAIN) {
    /* Counted here rather than in `attempt`, and before the request rather than
     * after: what the rule forbids is REACHING for the provider, and a call
     * that times out reached for it just as surely as one that answered. */
    outboundCalls++;
    last = await attempt(
      `${baseUrl}/models/${entry.model}:generateContent`,
      apiKey,
      requestFor(entry, body),
      timeoutMs,
    );
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
    const timedOut = error instanceof Error && error.name === "AbortError";
    const reason = timedOut
      ? `timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : "unknown transport error";
    /* A timeout is NOT retryable, now that each attempt has its own budget.
     * It spent a full allowance and the next model has no reason to be quicker,
     * so retrying is how one slow provider becomes three. A blip that failed
     * fast cost almost nothing and genuinely deserves the next model. */
    return timedOut ? { ok: false, reason } : { ok: false, retryable: true, reason };
  } finally {
    clearTimeout(timer);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The exact bytes sent for one model, given what the caller built.
 *
 * ── Why this is a named, exported function ────────────────────────────────
 * The thinking setting belongs to the MODEL and the rest of the payload belongs
 * to the caller, so something has to join them, and joining them inline inside
 * the request loop would mean the sent payload was no longer anything you could
 * read in one place — `buildGeminiRequest` would return one thing and the socket
 * would carry another. A test in this repo asserts precisely that they match,
 * and it was right to.
 *
 * So the composition is a pure function of (model, built body), and that is
 * what the test compares against. The property it protects — nothing is added
 * to a request except by code you can point at — survives intact.
 *
 * A caller that set its own `thinkingConfig` keeps it: the spread puts the
 * caller's `generationConfig` last.
 */
export function requestFor(entry: ChainEntry, body: unknown): unknown {
  /* No caller sets its own thinking config, and none should: `thinkingBudget:
     0` — the other spelling of "do not deliberate" — is a 400 on two of the
     three models in this chain, so how much a model thinks is decided per model
     HERE and nowhere else. */
  if (!entry.thinkingLevel || !isObject(body) || !isObject(body.generationConfig)) return body;
  return {
    ...body,
    generationConfig: {
      thinkingConfig: { thinkingLevel: entry.thinkingLevel },
      ...body.generationConfig,
    },
  };
}

/** Pulls the candidate text out of a provider response, or null. */
function candidateText(body: unknown): string | null {
  const text = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

/**
 * Why a 200 carried no text, in words that name the actual cause.
 *
 * "malformed or empty response" covered two completely different situations and
 * hid the more likely one for months: a model that spends its whole output
 * budget thinking returns `"content": {}` with `finishReason: MAX_TOKENS`, which
 * is not malformed at all — it is a budget that was too small. Reading that as
 * "the model gave a bad answer" sends you looking at prompts and keys, and the
 * fix is a number.
 */
function emptyReason(body: unknown): string {
  const candidate = (body as { candidates?: Array<{ finishReason?: string }> })?.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish === "MAX_TOKENS") {
    return "the model used its whole output budget before answering (raise maxOutputTokens, or lower thinkingLevel)";
  }
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") {
    return `the provider withheld the response (${finish})`;
  }
  return finish ? `no text in the response (${finish})` : "malformed or empty response";
}


export async function generateStructured(
  instruction: string,
  opts: {
    maxOutputTokens?: number;
    /** Overrides the module timeout. Document extraction needs far longer. */
    timeoutMs?: number;
    /** A file to read, sent inline. See the warning above. */
    document?: { mimeType: string; base64: string };
    /**
     * Zero for a labelling call, so an unchanged day re-reads identically.
     *
     * A summary regenerated because a cache expired must not come back
     * differently worded: somebody comparing two screenshots of a day that did
     * not change would have no way to tell a re-wording from an edit.
     */
    temperature?: number;
    /**
     * The shape the provider itself must return.
     *
     * Validation still runs afterwards. A schema guarantees the SHAPE, and every
     * rule that matters here is about CONTENT — no digit in a label, a label
     * that shares a word with its source — which no schema can express.
     */
    responseSchema?: unknown;
    /** Sent as a system instruction rather than folded into the prompt. */
    system?: string;
  } = {},
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const parts: Array<Record<string, unknown>> = [{ text: instruction }];
  if (opts.document) {
    parts.push({ inlineData: { mimeType: opts.document.mimeType, data: opts.document.base64 } });
  }

  const outcome = await postGenerate(
    {
      contents: [{ role: "user", parts }],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      generationConfig: {
        // Low temperature: this is reporting and labelling, not writing. A
        // caller passing 0 wants an unchanged day to read identically every
        // time it is regenerated.
        temperature: opts.temperature ?? 0.2,
        // Bounded output so a runaway response cannot cost more than the
        // answer is worth.
        maxOutputTokens: opts.maxOutputTokens ?? 1_200,
        responseMimeType: "application/json",
        ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
      },
    },
    opts.timeoutMs ?? TIMEOUT_MS,
  );
  if (!outcome.ok) return outcome;

  const text = candidateText(outcome.body);
  if (text === null) return { ok: false, reason: emptyReason(outcome.body) };
  return { ok: true, text };
}
