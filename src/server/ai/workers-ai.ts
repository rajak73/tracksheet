/**
 * Cloudflare Workers AI — the provider behind the worklog summariser.
 *
 * ── Why this is a separate module and not a branch inside `gemini.ts` ─────
 * The two providers are not the same shape. Gemini takes `contents`/`parts`
 * with a `generationConfig` and answers with `candidates`; Workers AI takes an
 * OpenAI-style `messages` array and answers with `choices`. A single function
 * carrying both would be a switch at every line, and the failure mode is that
 * one branch quietly stops being exercised.
 *
 * ── What still runs on Gemini, and why ────────────────────────────────────
 * `granite-4.0-h-micro` is a text model. `server/import/pdf.ts` sends an inline
 * PDF and needs a model that can read one, so the bulk importer stays on Gemini
 * rather than being broken by this swap.
 */

const DEFAULT_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
const TIMEOUT_MS = Number(process.env.WORKERS_AI_TIMEOUT_MS ?? 30_000);

export const workersAiModel = (): string => process.env.WORKERS_AI_MODEL ?? DEFAULT_MODEL;

export const isWorkersAiConfigured = (): boolean =>
  Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);

/**
 * How many requests have left this process for Workers AI, ever.
 *
 * The same reason `geminiCallCount` exists: this codebase holds one rule above
 * the rest — the model is called when raw text becomes structured data, and
 * never again. A rule nobody can check is a convention, and conventions rot.
 */
let outboundCalls = 0;
export const workersAiCallCount = (): number => outboundCalls;

export type StructuredOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * One structured call.
 *
 * `responseSchema` is passed as `response_format: json_schema`, which this
 * model honours — measured, not assumed. It guarantees the SHAPE and nothing
 * about the content, so `parseSummaryReply` still validates everything that
 * matters after this returns.
 */
export async function graniteStructured(
  instruction: string,
  opts: {
    system?: string;
    responseSchema?: unknown;
    temperature?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
    /**
     * What this request is for, logged at the boundary.
     *
     * Cost is counted where a request actually leaves the process, not where
     * one was considered: a reuse, a canonical read and a deterministic period
     * never reach here, and a retry reaches here twice. Anything measured
     * further up counts intentions instead of requests.
     */
    label?: string;
  } = {},
): Promise<StructuredOutcome> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  /* The substring "CLOUDFLARE_API_TOKEN" is load-bearing: callers tell "not
     configured" apart from "the provider is down" by looking for it. */
  if (!account || !token) return { ok: false, reason: "CLOUDFLARE_API_TOKEN not configured" };

  const model = workersAiModel();
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  // AbortController rather than Promise.race: an abandoned request still holds
  // a socket, and a slow provider must not pin connections.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  outboundCalls++;
  const startedAt = Date.now();
  /* One line per REAL request. No worklog text: the label says which stage and
     why, which is what a cost question needs, and the sentence being read is
     somebody's own writing. */
  const trace = (outcome: string) =>
    console.info(
      `[provider] ${opts.label ?? "unlabelled"} model=${model} ${outcome} ${Date.now() - startedAt}ms call#${outboundCalls}`,
    );
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
      {
        method: "POST",
        // The token goes in a header, never the URL — query strings end up in
        // proxy and access logs.
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            { role: "user", content: instruction },
          ],
          // Zero, so re-summarising unchanged data reads identically.
          temperature: opts.temperature ?? 0,
          max_tokens: opts.maxOutputTokens ?? 2_048,
          ...(opts.responseSchema
            ? { response_format: { type: "json_schema", json_schema: opts.responseSchema } }
            : {}),
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      /* Cloudflare puts the sentence that explains it in the body. A bare
         status makes somebody go and find that out by hand. */
      const detail = await res.text().catch(() => "");
      trace(`http-${res.status}`);
      return { ok: false, reason: `provider returned HTTP ${res.status}: ${detail.slice(0, 200)}` };
    }

    const body = (await res.json().catch(() => null)) as
      | {
          success?: boolean;
          errors?: Array<{ message?: string }>;
          result?: {
            response?: string;
            choices?: Array<{ message?: { content?: string } }>;
          };
        }
      | null;

    /* Workers AI can answer 200 with `success: false`, so the status alone is
       not the answer. */
    if (!body || body.success === false) {
      const message = body?.errors?.map((e) => e.message).filter(Boolean).join("; ");
      trace("refused");
      return { ok: false, reason: message || "the provider refused without saying why" };
    }

    /* Two shapes in the wild: the chat-completions one this model returns, and
       the flat `response` string older Workers AI models answer with. */
    const text =
      body.result?.choices?.[0]?.message?.content ?? body.result?.response ?? "";
    if (!text.trim()) {
      trace("empty");
      return { ok: false, reason: "the provider returned an empty reply" };
    }

    trace("ok");
    return { ok: true, text };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    trace(timedOut ? "timeout" : "error");
    return {
      ok: false,
      reason: timedOut
        ? `timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "unknown transport error",
    };
  } finally {
    clearTimeout(timer);
  }
}
