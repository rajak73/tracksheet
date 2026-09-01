import { generateStructured, isGeminiConfigured } from "@/server/ai/gemini";
import { canonicalJson, type CanonicalContext } from "@/server/insights/context";
import type { InsightPayload } from "@/server/insights/cache";

/**
 * Turning a period's work into a short summary.
 *
 * ── No taxonomy ───────────────────────────────────────────────────────────
 * The model is shown what people wrote and how long each piece took, and asked
 * to say what the period amounted to in plain English. It is not given a list
 * of names to choose from and not asked to place anything into one — that layer
 * is gone, and reintroducing it here as a prompt instruction would bring it back
 * through the side door.
 *
 * ── It is shown exactly what was hashed ───────────────────────────────────
 * The prompt is built from the canonical context and nothing else. If it read
 * the rows again it could see a value the hash did not cover, and the cache
 * would be claiming an insight was derived from data it was not.
 *
 * ── It may not state a figure ─────────────────────────────────────────────
 * Durations are in the context so the model knows what was substantial and what
 * was brief, but the instruction forbids repeating numbers back. Every figure on
 * screen comes from the rows; a summary that quotes its own arithmetic is a
 * second source for a number that already has one, and the two can disagree.
 */

/** Bump `PROMPT_VERSION` in `context.ts` whenever this text changes. */
function instructionFor(context: CanonicalContext): string {
  const scope =
    context.scope_type === "DAY"
      ? "one day"
      : context.scope_type === "WEEK"
        ? "one week"
        : "one month";

  return [
    `Below is the work somebody recorded over ${scope}, as JSON.`,
    "",
    "Write ONE short paragraph — at most three sentences — describing what this",
    "period was spent on. Write it for their manager: plain, factual, and about",
    "the work rather than the person.",
    "",
    "Rules:",
    "- Use only what is in the data. Do not infer anything that is not written.",
    "- Do NOT state hours, counts, percentages or any other number. The screen",
    "  already shows the figures; your job is what the work WAS.",
    "- Do not judge, praise, or criticise. No assessment of effort or quality.",
    "- If the entries are too vague to summarise, say exactly that in one",
    "  sentence rather than inventing a description.",
    "",
    /* JSON because the transport asks for it. `generateStructured` sets
     * `responseMimeType: application/json` on every call, so a prompt telling
     * the model to reply in prose is arguing with the API — it complied with
     * the header, wrapped the paragraph in an object, and the wrapper was
     * stored and displayed verbatim. Asking for the shape the transport
     * already demands is the only version of this that cannot drift. */
    'Reply with exactly this JSON and nothing else: {"summary": "<your paragraph>"}',
    "",
    canonicalJson(context),
  ].join("\n");
}

/**
 * The generator handed to {@link serveInsight}.
 *
 * Throws on failure rather than returning a fallback sentence, and that is
 * deliberate: the cache treats a throw as "keep the previous answer and mark it
 * stale". A fallback string returned as success would be STORED as though the
 * model had written it, and the next viewer would be served invented prose that
 * looks exactly like a real insight.
 */
export async function generateInsight(context: CanonicalContext): Promise<InsightPayload> {
  if (!isGeminiConfigured()) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const outcome = await generateStructured(instructionFor(context), { maxOutputTokens: 400 });
  if (!outcome.ok) throw new Error(outcome.reason);

  const summary = readSummary(outcome.text);
  if (summary === "") throw new Error("The model returned an empty summary");

  return { summary };
}

/**
 * The paragraph, out of whatever shape the reply arrived in.
 *
 * Normally `{"summary": "..."}`. Parsed rather than trusted: a reply that is
 * already prose, or JSON with the paragraph under a different key, must not be
 * stored as a blob of braces — which is what happened when the prompt asked for
 * prose and the transport asked for JSON. Whatever cannot be read as an object
 * is treated as the paragraph itself.
 */
function readSummary(text: string): string {
  const raw = text.trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed.trim();
    if (parsed && typeof parsed === "object") {
      const summary = (parsed as { summary?: unknown }).summary;
      if (typeof summary === "string") return summary.trim();
    }
  } catch {
    // Not JSON at all. The reply is the paragraph.
  }
  return raw;
}
