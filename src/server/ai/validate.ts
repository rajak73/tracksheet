/**
 * The deterministic validator: the gate between model output and the UI.
 *
 *   DATABASE -> ANALYTICS -> VERIFIED METRICS -> AI -> [ THIS ] -> UI
 *
 * The model is allowed to PARAPHRASE the condition. It is not allowed to
 * introduce a fact. This module decides which of those happened, using the
 * `AnomalyCondition` — deterministic backend data — as the only source of
 * truth. It never reads the database, the UI, or the model's own claims about
 * itself.
 *
 * ── Why not substring matching ─────────────────────────────────────────────
 * Searching the prose for "44.38" and declaring victory is not validation: it
 * proves one true number is PRESENT, not that every number is TRUE. A summary
 * reading "utilisation of 44.38%, down from 61%" would pass that check while
 * inventing the 61. So the direction is inverted: every numeric and date-like
 * token in the text is EXTRACTED, and each one must be justified by a value
 * the deterministic layer actually produced. Anything left unexplained is a
 * hallucination by definition.
 *
 * ── Failure is not repair ──────────────────────────────────────────────────
 * A failed narration is DISCARDED, never patched. Rewriting a wrong number
 * into a right one would produce a sentence no component actually authored,
 * whose remaining clauses are still untrusted. The caller falls back to the
 * deterministic narrator, whose text is correct by construction.
 */

import type { AnomalyCondition } from "@/server/ai/anomalies";
import { SUBJECT_TOKEN } from "@/server/ai/gemini";

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: string[] };

/* ── Allowed values ────────────────────────────────────────────────────────── */

/**
 * Every number the model is permitted to state, derived from the condition.
 *
 * Includes rounded forms: a narrator writing "44%" for 44.38 is paraphrasing,
 * not inventing, and rejecting that would make the validator so brittle the
 * model could never pass. Rounding is only ever ACCEPTED as a match — it is
 * never used to rewrite what the model wrote.
 */
function allowedNumbers(condition: AnomalyCondition): Set<string> {
  const allowed = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    allowed.add(canonical(value));
    // Common paraphrases of the same quantity.
    allowed.add(canonical(Math.round(value)));
    allowed.add(canonical(Number(value.toFixed(1))));
    allowed.add(canonical(Number(value.toFixed(2))));
  };

  for (const value of Object.values(condition.metrics)) add(value);
  for (const value of Object.values(condition.threshold)) add(value);

  // Small ordinals appear as ordinary grammar ("one deliverable", "2 of 3")
  // and are already covered when they equal a metric. Nothing else is added:
  // a count the condition did not produce is exactly what must be caught.
  return allowed;
}

/** Dates the model may state: any ISO date present in the metrics. */
function allowedDates(condition: AnomalyCondition): Set<string> {
  const allowed = new Set<string>();
  for (const value of Object.values(condition.metrics)) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) allowed.add(value);
  }
  return allowed;
}

/** Normalises 44.0 and 44 to the same key so they compare equal. */
function canonical(n: number): string {
  return String(Number(n.toFixed(4)));
}

/* ── Claim extraction ──────────────────────────────────────────────────────── */

/**
 * Numbers written as digits, with any unit suffix stripped.
 *
 * Deliberately greedy: it is better to extract something harmless and find it
 * justified than to skip a token and let a fabricated figure through.
 */
function extractNumbers(text: string): string[] {
  // Skip anything inside the subject token so a future token containing a
  // digit cannot be mistaken for a claim.
  const scrubbed = text.split(SUBJECT_TOKEN).join(" ");
  const matches = scrubbed.match(/\d+(?:\.\d+)?/g) ?? [];
  return matches;
}

function extractDates(text: string): string[] {
  return text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
}

/* ── Language rules ────────────────────────────────────────────────────────── */

/**
 * Vocabulary that asserts something about a PERSON rather than a measurement.
 *
 * The product rule is that an insight describes recorded activity and never
 * characterises competence, effort or attitude — a judgement the data cannot
 * support and that a workforce tool must not put in writing about someone.
 */
const JUDGEMENT_TERMS = [
  "underperform",
  "poor perform",
  "lazy",
  "unproductive",
  "incompetent",
  "negligent",
  "slacking",
  "not working hard",
  "低", // guard against non-latin slips in a multilingual model
  "must be disciplined",
  "should be terminated",
  "should be fired",
  "should be dismissed",
  "warning letter",
  "disciplinary",
];

/**
 * Claims of fact the condition cannot support. These are phrasings that assert
 * a trend, cause or comparison the deterministic layer never computed.
 */
const UNSUPPORTED_ASSERTIONS = [
  "compared to last year",
  "compared with last year",
  "industry average",
  "benchmark of",
  "peers averaged",
  "other universities",
  "other instructors averaged",
];

/* ── The validator ─────────────────────────────────────────────────────────── */

export function validateNarration(
  condition: AnomalyCondition,
  narration: { summary: string; recommendation: string },
): ValidationResult {
  const violations: string[] = [];

  const numbers = allowedNumbers(condition);
  const dates = allowedDates(condition);

  for (const [field, text] of Object.entries(narration)) {
    if (typeof text !== "string" || text.trim() === "") {
      violations.push(`${field}: empty`);
      continue;
    }

    // 1-7. Every numeric token must be a value the engine produced. This is
    //      what catches invented percentages, changed hour counts, unsupported
    //      counts and fabricated thresholds in one pass — they are all just
    //      "a number the condition never contained".
    //
    //      Dates are removed first so their components (2026, 08, 13) are not
    //      re-examined as bare numbers.
    const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}/g, " ");
    for (const raw of extractNumbers(withoutDates)) {
      if (!numbers.has(canonical(Number(raw)))) {
        violations.push(`${field}: unsupported number "${raw}"`);
      }
    }

    // 4. Date ranges must match the period the condition was computed over.
    for (const date of extractDates(text)) {
      if (!dates.has(date)) {
        violations.push(`${field}: unsupported date "${date}"`);
      }
    }

    const lower = text.toLowerCase();

    // 9. No claims about a person's competence or effort.
    for (const term of JUDGEMENT_TERMS) {
      if (lower.includes(term)) {
        violations.push(`${field}: judgemental language "${term}"`);
      }
    }

    // 6. No comparisons the engine never made.
    for (const phrase of UNSUPPORTED_ASSERTIONS) {
      if (lower.includes(phrase)) {
        violations.push(`${field}: unsupported comparison "${phrase}"`);
      }
    }

    // 8. No invented identities. The model is never given a name, so any
    //    honorific-plus-name it produces was fabricated outright.
    const invented = text.match(/\b(?:Dr|Prof|Professor|Mr|Mrs|Ms)\.?\s+[A-Z][a-z]+/g);
    if (invented) {
      violations.push(`${field}: invented subject name "${invented[0]}"`);
    }
  }

  // The summary must refer to the subject through the placeholder. A summary
  // that dropped it either lost the subject or replaced it with something the
  // model chose itself.
  if (condition.instructorName && !narration.summary.includes(SUBJECT_TOKEN)) {
    violations.push("summary: subject placeholder missing");
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
