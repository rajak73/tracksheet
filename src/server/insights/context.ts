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
 * `totalHours` is excluded for a different reason: it is DERIVED. It is summed
 * from the activities on write and is a cache column, so a stale one must not be
 * able to change the hash — the hours that matter are already here, on the
 * activities themselves.
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
export const PROMPT_VERSION_DAY = "day_v1";
export const PROMPT_VERSION_WEEK = "week_v1";
export const PROMPT_VERSION_MONTH = "month_v1";

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
 * One activity, as written.
 *
 * `quantity` is FREE TEXT and stays free text here. The instructor writes
 * whatever describes the work — "5 class", "2 batches", "half day", "3 sections
 * + lab" — and it is context, not a measurement. Coercing it to a number
 * anywhere in this module would make two different things ("2 classes taken" and
 * "2") hash identically, and would hand the model a number to reason about when
 * the whole point is that it never sees one worth reading.
 *
 * `hours` is the only reliable numeric field, and may be null.
 */
export type CanonicalActivity = {
  label: string | null;
  quantity: string | null;
  hours: number | null;
};

export type CanonicalDay = {
  /** YYYY-MM-DD. */
  log_date: string;
  activities: CanonicalActivity[];
  remarks: string | null;
  status: string;
};

export type CanonicalContext = {
  scope_type: ScopeType;
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

/** The stored shape of one activity, before it is trusted. */
type StoredActivity = { label?: unknown; quantity?: unknown; hours?: unknown };

/**
 * Reads the JSON column defensively.
 *
 * `activities` is `Json`, so nothing about its shape is guaranteed by the type
 * system. A malformed item yields nulls rather than throwing: an insight is worth
 * less than the day it describes, and a bad row must not make the day unreadable.
 */
function readActivities(value: unknown): CanonicalActivity[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = (raw ?? {}) as StoredActivity;
    return {
      label: normaliseText(typeof item.label === "string" ? item.label : null),
      // Text, always. See `CanonicalActivity`.
      quantity: normaliseText(typeof item.quantity === "string" ? item.quantity : null),
      hours: normaliseNumber(typeof item.hours === "number" ? item.hours : Number(item.hours)),
    };
  });
}

/**
 * The days a scope covers, canonicalised and deterministically ordered.
 *
 * Days by date, activities within a day by label, and never by whatever the
 * database or the JSON array happened to hold. Order is not a property of the
 * data — a reordered array says the same thing — and letting it into the hash
 * would invalidate the cache for no reason at all.
 */
export async function buildCanonicalContext(scope: InsightScope): Promise<CanonicalContext> {
  const rows = await prisma.worklogEntry.findMany({
    where: {
      instructorId: scope.instructorId,
      logDate: { gte: toDateOnly(scope.periodStart), lte: toDateOnly(scope.periodEnd) },
    },
    // The allowlist, expressed as the query. `totalHours`, the ids and the
    // timestamps are not selected, so they cannot reach the hash by accident.
    select: { logDate: true, activities: true, remarks: true, status: true },
  });

  const days: CanonicalDay[] = rows.map((row) => {
    const activities = readActivities(row.activities);
    activities.sort((a, b) => {
      const left = a.label ?? "";
      const right = b.label ?? "";
      if (left !== right) return left < right ? -1 : 1;
      // Two items sharing a label are separated by their own values, so an
      // array holding both cannot serialise two ways.
      const q = (a.quantity ?? "").localeCompare(b.quantity ?? "");
      if (q !== 0) return q;
      return (a.hours ?? 0) - (b.hours ?? 0);
    });

    return {
      log_date: row.logDate.toISOString().slice(0, 10),
      activities,
      remarks: normaliseText(row.remarks),
      status: row.status,
    };
  });

  days.sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));

  return {
    scope_type: scope.scopeType,
    period_start: scope.periodStart,
    period_end: scope.periodEnd,
    days,
  };
}

/** The canonical JSON. This is what is hashed and what the model is shown. */
export const canonicalJson = (context: CanonicalContext): string => stableStringify(context);

/** Every activity in the period, in canonical order. The basis for all counting. */
export function activitiesIn(context: CanonicalContext): CanonicalActivity[] {
  return context.days.flatMap((day) => day.activities);
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
