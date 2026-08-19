/**
 * The `AiInsight.type` value that marks an assistant brief.
 *
 * ── Why this is its own module ─────────────────────────────────────────────
 * Assistant briefs share a table with rule-derived insights, but they are NOT
 * the same artifact and must not travel through the same endpoints.
 *
 * A rule-derived insight is a university-wide observation: every manager in a
 * university may read it, which is why `/api/universities/[id]/insights`
 * returns rows by `universityId` alone. An assistant brief is written FOR ONE
 * READER — it carries their roster in `sourceMetrics` — so returning it by
 * university would hand one manager another manager's roster, and an
 * instructor's personal brief to every manager in their university.
 *
 * So the shared endpoints exclude this type, and briefs are served only by
 * `/api/ai/insights`, which derives its subject from the session. The constant
 * lives here, apart from the service, so those endpoints can exclude it
 * without importing the Gemini client.
 */
export const BRIEF_TYPE = "ASSISTANT_BRIEF";
