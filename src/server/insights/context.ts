import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";

/**
 * The exact bytes an insight is derived from — hashed AND sent to the model.
 *
 * ── Why there is exactly one of these ─────────────────────────────────────
 * The cache answers one question: has the underlying data changed since the
 * insight was written? It answers it by hashing. If the bytes that get hashed
 * and the bytes that reach the model are built by two different pieces of code,
 * the cache is lying the moment those two drift — it will either serve an
 * insight for data the model never saw, or regenerate for a change that could
 * not have altered the answer.
 *
 * So this module builds the context once, and both the hash and the prompt read
 * that one value. Nothing else may assemble a prompt from the rows directly.
 *
 * ── The allowlist, and what it leaves out ─────────────────────────────────
 * A naive hash over whole rows changes whenever any column does, and most
 * columns cannot change what an insight says. `updatedAt` moves when somebody
 * re-saves an identical day. Ids move when a rewrite deletes and recreates the
 * same work. Either would throw the cache away and buy a fresh model call for an
 * answer that could not have differed — silently, because everything still
 * works. It just costs.
 *
 * What remains is the four fields the form collects. `workingHours` is included
 * because the instructor entered it — it is not derived from anything, and it is
 * the independent figure an extraction is later reconciled against.
 */

/**
 * One version per scope, so editing the week prompt does not invalidate every
 * cached day.
 *
 * Each is part of its own scope's hash, so incrementing one invalidates that
 * scope alone and the next viewer of each affected period regenerates. That is
 * the intended way to roll out a prompt change: no migration, no purge, the old
 * rows simply stop matching.
 *
 * Increment when the wording, the instruction, the output shape or the meaning
 * of that scope's insight changes. Do NOT increment for a refactor that leaves
 * the sent text byte-identical.
 */
/* ── v3: the model stopped writing sentences ──────────────────────────────
 * Two calls now, both language-only: one labels a day, one groups a period.
 * Neither writes prose and neither writes a figure — every number in every
 * summary is assembled in code from the rows the instructor filled in.
 *
 * Bumped because the sent text changed and because the ANSWER changed shape: a
 * day stored under v2 carries bullets and an insight sentence that nothing
 * reads any more.
 *
 * ── v2: topic and subtopic ────────────────────────────────────────────────
 * The shape of an extraction changed — every activity now carries a subtopic
 * quoted from the text and a topic inferred from it — and the grouping changed
 * with it, from grouping by activity to grouping by topic.
 *
 * Bumping these invalidates every stored insight, which is the point. The
 * version is inside the context hash, so a cached answer in the old shape is
 * not "stale data" to be detected later; it simply stops matching and the next
 * viewer gets one in the new shape. */
export const PROMPT_VERSION_EXTRACT = "extract_v3";
export const PROMPT_VERSION_DAY = "day_v1";
export const PROMPT_VERSION_WEEK = "week_v3";
export const PROMPT_VERSION_MONTH = "month_v3";

export type ScopeType = "DAY" | "WEEK" | "MONTH";

export function promptVersionFor(scopeType: ScopeType): string {
  if (scopeType === "DAY") return PROMPT_VERSION_DAY;
  if (scopeType === "WEEK") return PROMPT_VERSION_WEEK;
  return PROMPT_VERSION_MONTH;
}

/**
 * Which model the cached answer came from, also part of the hash.
 *
 * Switching models is a change to the answer, so it must invalidate exactly as a
 * prompt edit does. Read from the environment rather than pinned here, so the
 * hash follows the deployment rather than a constant somebody has to remember.
 */
export function modelId(): string {
  return process.env.GEMINI_MODEL ?? "gemini-default";
}

export type InsightScope = {
  instructorId: string;
  scopeType: ScopeType;
  /** Inclusive, YYYY-MM-DD, in the university's configured zone. */
  periodStart: string;
  periodEnd: string;
};

/**
 * One day, as it was written.
 *
 * The four fields the form collects and nothing else. `deliverable` and
 * `deliverableQuantity` are free text and stay free text: coercing either to a
 * number here would make "2 classes taken" and "2" hash identically, and would
 * hand a parser's opinion to the thing that is supposed to be reading the words.
 *
 * `workingHours` is the day total the instructor entered separately, which is
 * what makes it useful — it is independent of the text, so an extraction can be
 * reconciled against it.
 */
export type CanonicalDay = {
  /** YYYY-MM-DD. */
  log_date: string;
  deliverable: string | null;
  deliverable_quantity: string | null;
  /**
   * The rows the instructor authored, when the day has them.
   *
   * Carried for the extractor and stripped before hashing — see `canonicalJson`.
   */
  activities?: unknown;
  /**
   * WHOLE MINUTES, matching the record.
   *
   * Was `working_hours`. A context stating hours asks the model to reconcile
   * "45 minutes" in the instructor's text against "0.75" in the same document,
   * and converting between units is the one thing extraction must never do.
   */
  working_minutes: number | null;
  remarks: string | null;
  status: string;
};

export type CanonicalContext = {
  period_start: string;
  period_end: string;
  days: CanonicalDay[];
};

/* ── Normalisation ─────────────────────────────────────────────────────────
 * Each rule erases a difference that cannot change an insight. Nothing here
 * lowercases: "OAuth" and "oauth" are not the same word to a reader, and casing
 * is content. */

/**
 * NFC, trimmed, internal whitespace collapsed to single spaces.
 *
 * Newlines collapse too. A description re-typed with a line break somewhere else
 * says the same thing, and treating it as new work would cost a model call for
 * nothing.
 *
 * Empty and null are one value — `null` — because "they wrote nothing" and "they
 * wrote an empty string" are the same fact told two ways, and only one of them
 * should be able to appear in a hash.
 */
export function normaliseText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/** Two decimals, and never `-0`, which serialises differently from `0`. */
export function normaliseNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * JSON with keys sorted at every level and no insignificant whitespace.
 *
 * `JSON.stringify` preserves insertion order, which is whatever order the object
 * happened to be built in — so two identical contexts assembled by different
 * code paths would serialise differently and hash differently.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * The days a scope covers, canonicalised and deterministically ordered.
 *
 * By date, and never by whatever the database returned. Row order is not a
 * property of the data — it changes with the plan the planner picks — and
 * letting it into the hash would invalidate the cache for no reason at all.
 */
export async function buildCanonicalContext(scope: {
  instructorId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<CanonicalContext> {
  const rows = await prisma.worklogEntry.findMany({
    where: {
      instructorId: scope.instructorId,
      logDate: { gte: toDateOnly(scope.periodStart), lte: toDateOnly(scope.periodEnd) },
    },
    /* The allowlist, expressed as the query. The ids and the timestamps are not
       selected at all, so they cannot reach the hash by accident — a field that
       is never read cannot be forgotten about later. */
    select: {
      logDate: true,
      deliverable: true,
      deliverableQuantity: true,
      activities: true,
      workingMinutes: true,
      remarks: true,
      status: true,
    },
    /* Ordered here AND sorted below. The query's order is a hint; the sort is
       the guarantee, because a planner may return rows in any order it likes. */
    orderBy: { logDate: "asc" },
  });

  /* Days with no worklog row are omitted entirely rather than represented as
     empty objects. A day nobody logged is an absence, and an absence that
     serialises as `{}` would make a quiet week hash differently from the same
     quiet week viewed over a longer window. */
  const days: CanonicalDay[] = rows.map((row) => ({
    log_date: row.logDate.toISOString().slice(0, 10),
    deliverable: normaliseText(row.deliverable),
    deliverable_quantity: normaliseText(row.deliverableQuantity),
    /* Carried for the extractor and NOT hashed — stripped in `canonicalJson`.
       Every fact it holds is already in the three fields around it, which are
       derived from it, so a row change invalidates through them; hashing the
       array as well would count one edit twice. */
    activities: row.activities ?? null,
    /* Minutes, because that is what the record holds and what extraction
       reports. A context stating hours would ask the model to reconcile
       "45 minutes" against "0.75", which is a conversion it must never do. */
    working_minutes: normaliseNumber(row.workingMinutes),
    remarks: normaliseText(row.remarks),
    status: row.status,
  }));

  days.sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));

  return { period_start: scope.periodStart, period_end: scope.periodEnd, days };
}

/**
 * The canonical JSON. This is what is hashed and what the model is shown.
 *
 * `activities` is stripped for the reason given where it is set: it is carried
 * so the extractor can read the rows, and everything in it already reaches the
 * hash through `deliverable`, `deliverable_quantity` and `working_minutes`.
 */
export const canonicalJson = (context: CanonicalContext): string =>
  stableStringify({
    ...context,
    days: context.days.map((day) => {
      const hashed = { ...day };
      delete hashed.activities;
      return hashed;
    }),
  });

/** The day rows a period actually holds. Zero means there is nothing to say. */
export function daysIn(context: CanonicalContext): CanonicalDay[] {
  return context.days;
}

/**
 * The period's MINUTES, summed from RAW rows and never from anything derived.
 *
 * The unit reconciliation works in: extraction reports "45 minutes", this
 * subtracts, and `unallocated_minutes` is what is left. An hours figure here
 * would put a rounding step between the record and the arithmetic that checks
 * the model against it.
 */
export function totalMinutesIn(context: CanonicalContext): number {
  return context.days.reduce((n, day) => n + (day.working_minutes ?? 0), 0);
}

/**
 * `SHA256(canonical + "|" + promptVersion + "|" + modelId)`.
 *
 * The version and the model are inside the hash rather than beside it in the
 * row, so a prompt edit or a model switch invalidates by the same comparison a
 * data edit does. One check decides everything.
 */
export function contextHash(canonical: string, promptVersion: string, model: string): string {
  return createHash("sha256").update(`${canonical}|${promptVersion}|${model}`).digest("hex");
}
