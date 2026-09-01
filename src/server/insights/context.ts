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
 * ── Why an allowlist and not "the row" ────────────────────────────────────
 * A naive hash over whole rows changes whenever any column does, and most
 * columns cannot change what an insight says. `updatedAt` moves when somebody
 * re-saves an identical day. Ids move when a rewrite deletes and recreates the
 * same work. Either would throw the cache away and buy a fresh model call for
 * an answer that could not have differed — which is the entire cost this exists
 * to avoid.
 *
 * Four fields decide meaning: the day, what was written, how long it took, and
 * whether it happened. Everything else is excluded on purpose.
 */

/**
 * Bumped BY HAND when the prompt template changes.
 *
 * It is part of the hash, so incrementing it invalidates every cached insight
 * at once and the next viewer of each scope regenerates. That is the intended
 * way to roll out a prompt change: there is no migration and no purge, the old
 * rows simply stop matching.
 *
 * Increment it when the wording, the instruction, the output shape or the
 * meaning of the insight changes. Do NOT increment it for a refactor that
 * leaves the sent text identical.
 */
export const PROMPT_VERSION = "2";

/**
 * Which model the cached answer came from, also part of the hash.
 *
 * Switching models is a change to the answer, so it must invalidate, exactly as
 * a prompt edit does. Read from the environment rather than pinned here, so the
 * hash follows the deployment rather than a constant somebody has to remember.
 */
export function modelId(): string {
  return process.env.GEMINI_MODEL ?? "gemini-default";
}

export type ScopeType = "DAY" | "WEEK" | "MONTH";

export type InsightScope = {
  instructorId: string;
  scopeType: ScopeType;
  /** Inclusive, YYYY-MM-DD, in the university's configured zone. */
  periodStart: string;
  periodEnd: string;
};

/** One entry, reduced to the four fields that can change what an insight says. */
export type CanonicalEntry = {
  /** YYYY-MM-DD. */
  date: string;
  /** The instructor's own words. `null` when they wrote none. */
  description: string | null;
  /** Hours, to two decimals. */
  duration: number;
  status: string;
};

export type CanonicalContext = {
  scopeType: ScopeType;
  periodStart: string;
  periodEnd: string;
  entries: CanonicalEntry[];
};

/* ── Normalisation ─────────────────────────────────────────────────────────
 * Each rule exists because a difference it erases cannot change an insight.
 * Nothing here lowercases: "OAuth" and "oauth" are not the same word to a
 * reader, and casing is content. */

/**
 * NFC, trimmed, and internal whitespace collapsed to single spaces.
 *
 * Newlines collapse too. A description re-typed with a line break in a
 * different place says the same thing, and treating it as new work would cost a
 * model call for nothing.
 *
 * Empty and null are one value — `null` — because "they wrote nothing" and
 * "they wrote an empty string" are the same fact told two ways, and only one of
 * them should be able to appear in a hash.
 */
export function normaliseText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/** Two decimals, and never `-0`, which serialises differently from `0`. */
export function normaliseNumber(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * JSON with keys sorted at every level and no insignificant whitespace.
 *
 * `JSON.stringify` preserves insertion order, which is whatever order the
 * object happened to be built in — so two identical contexts assembled by
 * different code paths would serialise differently and hash differently.
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
 * The entries a scope covers, canonicalised and deterministically ordered.
 *
 * Ordered by date, then description, and never by whatever the database
 * returned. Row order is not a property of the data — it changes with the plan
 * the planner picks — and letting it into the hash would invalidate the cache
 * for no reason at all.
 */
export async function buildCanonicalContext(scope: InsightScope): Promise<CanonicalContext> {
  const rows = await prisma.activityLog.findMany({
    where: {
      instructorId: scope.instructorId,
      workDate: { gte: toDateOnly(scope.periodStart), lte: toDateOnly(scope.periodEnd) },
    },
    select: { workDate: true, rawText: true, startTime: true, endTime: true, status: true },
  });

  const entries: CanonicalEntry[] = rows.map((row) => ({
    date: row.workDate.toISOString().slice(0, 10),
    description: normaliseText(row.rawText),
    duration: normaliseNumber((row.endTime.getTime() - row.startTime.getTime()) / 3_600_000),
    status: row.status,
  }));

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const left = a.description ?? "";
    const right = b.description ?? "";
    if (left !== right) return left < right ? -1 : 1;
    // A final tiebreak so two otherwise identical lines cannot swap places
    // between reads and change the serialised bytes.
    return a.duration - b.duration;
  });

  return {
    scopeType: scope.scopeType,
    periodStart: scope.periodStart,
    periodEnd: scope.periodEnd,
    entries,
  };
}

/** The canonical JSON. This is what is hashed and what the model is shown. */
export const canonicalJson = (context: CanonicalContext): string => stableStringify(context);

/**
 * `SHA256(canonical + "|" + promptVersion + "|" + modelId)`.
 *
 * The version and the model are inside the hash rather than beside it in the
 * row, so a prompt edit or a model switch invalidates by the same mechanism
 * that a data edit does. One comparison decides everything.
 */
export function contextHash(canonical: string, promptVersion: string, model: string): string {
  return createHash("sha256").update(`${canonical}|${promptVersion}|${model}`).digest("hex");
}
