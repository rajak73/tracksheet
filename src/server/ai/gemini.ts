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
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "GEMINI_API_KEY not configured" };

  const baseUrl = process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}/models/${MODEL}:generateContent`;

  // AbortController rather than Promise.race: an abandoned request still holds
  // a socket, and a slow provider must not pin connections on every insight.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      // The key goes in a header, never the URL — query strings end up in
      // proxy and access logs.
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildGeminiRequest(condition)),
      signal: controller.signal,
    });

    if (res.status === 429) return { ok: false, reason: "rate limited by provider" };
    if (!res.ok) return { ok: false, reason: `provider returned HTTP ${res.status}` };

    const parsed = parseCandidate(await res.json().catch(() => null));
    if (!parsed) return { ok: false, reason: "malformed or empty response" };

    return { ok: true, ...parsed };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `timed out after ${TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : "unknown transport error";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
