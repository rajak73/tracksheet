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
    context.scopeType === "DAY"
      ? "one day"
      : context.scopeType === "WEEK"
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
    "- Reply with the paragraph only. No preamble, no bullet points, no JSON.",
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

  const summary = outcome.text.trim();
  if (summary === "") throw new Error("The model returned an empty summary");

  return { summary };
}
