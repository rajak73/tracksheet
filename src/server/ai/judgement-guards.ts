/**
 * Words the assistant may never use about a person.
 *
 * ── Why these outlived the validator they lived in ────────────────────────
 * They were part of `ai/validate.ts`, which checked a narrated
 * `AnomalyCondition` — prose about a graded finding — before it was stored.
 * That narration path is deleted along with the grader behind it.
 *
 * These two lists are not part of the grading. They are the floor under
 * anything a model writes about somebody's work: it may describe, and it may
 * not judge, and it may not compare against a benchmark nobody computed. The
 * assistant still checks its own output against them, which is why they are
 * here rather than gone.
 */

/**
 * Vocabulary that asserts something about a PERSON rather than a measurement.
 *
 * The product rule is that an insight describes recorded activity and never
 * characterises competence, effort or attitude — a judgement the data cannot
 * support and that a workforce tool must not put in writing about someone.
 */
export const JUDGEMENT_TERMS = [
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
export const UNSUPPORTED_ASSERTIONS = [
  "compared to last year",
  "compared with last year",
  "industry average",
  "benchmark of",
  "peers averaged",
  "other universities",
  "other instructors averaged",
];
