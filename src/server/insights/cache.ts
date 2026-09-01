import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import {
  activitiesIn,
  buildCanonicalContext,
  canonicalJson,
  contextHash,
  modelId,
  promptVersionFor,
  type CanonicalContext,
  type InsightScope,
} from "@/server/insights/context";

/**
 * Serving an insight for a period, and paying for it at most once.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * For a given (instructor, scope, period) the model is called at most once per
 * distinct state of the underlying work logs. If the data has not changed since
 * the stored insight was written, the stored one is returned and NO provider
 * call is made — the client is never even constructed on that path.
 *
 * Generation is lazy. It happens when somebody opens the view and at no other
 * time: no background job, no pre-warming, nothing on write. A period nobody
 * looks at costs nothing.
 *
 * ── Why hashing rather than cascade ───────────────────────────────────────
 * Editing one day must invalidate that day, the week containing it and the
 * month containing it — and nothing else. There is no code here that does that.
 * The week's context CONTAINS the day's rows, so the week's hash moves when the
 * day's rows move, and an untouched adjacent day's hash does not. Cascade logic
 * would be a second description of a relationship the data already has, and the
 * two would eventually disagree.
 *
 * ── What a failure may not do ─────────────────────────────────────────────
 * Break a good answer. A provider outage leaves the previous insight exactly
 * where it was and serves it flagged stale; only the failure counters move. And
 * after three consecutive failures the view stops trying on its own, because a
 * broken provider that is retried once per page load is a bill, not a retry.
 */

/** Consecutive failures after which the view stops trying and offers a retry. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export type InsightPayload = { summary: string };

export type ServedInsight = {
  scope: { type: InsightScope["scopeType"]; period_start: string; period_end: string };
  insight: InsightPayload | null;
  /** True when this came from storage with no provider call. */
  cached: boolean;
  /** True when the data has moved on but this is the best answer available. */
  is_stale: boolean;
  generated_at: string | null;
  status: "READY" | "GENERATING" | "FAILED" | "EMPTY";
};

/** Why a request could not be served from storage. Logged, never shown. */
type MissReason = "no_row" | "hash_mismatch" | "status_not_ready";

/* ── Observability ─────────────────────────────────────────────────────────
 * A counter pair and one structured line per request. This is how the saving is
 * verified: hits are calls not made, and a hit rate that falls is a
 * canonicalisation bug letting irrelevant changes through the hash. */

let hits = 0;
let misses = 0;

export const insightCacheCounters = () => ({ hits, misses });
export const resetInsightCacheCounters = () => {
  hits = 0;
  misses = 0;
};

function report(input: {
  scope: InsightScope;
  cacheHit: boolean;
  reason?: MissReason;
  latencyMs?: number;
}): void {
  const parts = [
    `scope_type=${input.scope.scopeType}`,
    `period_start=${input.scope.periodStart}`,
    `cache_hit=${input.cacheHit}`,
  ];
  if (input.reason) parts.push(`reason_for_miss=${input.reason}`);
  if (input.latencyMs !== undefined) parts.push(`generation_ms=${input.latencyMs}`);
  console.info(`[insight] ${parts.join(" ")}`);
}

/* ── The one entry point ───────────────────────────────────────────────── */

/**
 * Returns the insight for a scope, generating it only if the data has changed.
 *
 * `generate` is injected rather than imported so the caller decides what a
 * "generation" is, and so the tests can count calls without a provider. It is
 * given the canonical context — the same bytes that were hashed — and nothing
 * else.
 */
export async function serveInsight(
  scope: InsightScope,
  generate: (context: CanonicalContext) => Promise<InsightPayload>,
): Promise<ServedInsight> {
  const context = await buildCanonicalContext(scope);
  const canonical = canonicalJson(context);
  const model = modelId();
  /* Per SCOPE, so editing the week prompt does not invalidate every cached day.
     The version is inside the hash, so one scope's bump is invisible to the
     others by construction rather than by a filter somebody has to remember. */
  const promptVersion = promptVersionFor(scope.scopeType);
  const currentHash = contextHash(canonical, promptVersion, model);

  const where = {
    instructorId_scopeType_periodStart_periodEnd: {
      instructorId: scope.instructorId,
      scopeType: scope.scopeType,
      periodStart: toDateOnly(scope.periodStart),
      periodEnd: toDateOnly(scope.periodEnd),
    },
  };

  const row = await prisma.aiInsightCache.findUnique({ where });

  /* ── The only path that costs nothing ──────────────────────────────────
   * Deliberately first, and deliberately before anything to do with a
   * provider: on a hit no AI client is constructed at all. */
  if (row && row.status === "READY" && row.contextHash === currentHash) {
    hits += 1;
    report({ scope, cacheHit: true });
    await prisma.aiInsightCache.update({
      where: { id: row.id },
      data: { lastServedAt: new Date(), serveCount: { increment: 1 } },
    });
    return served(scope, row.insightPayload as InsightPayload, {
      cached: true,
      isStale: false,
      generatedAt: row.generatedAt,
      status: "READY",
    });
  }

  /* A period with nothing in it has nothing to summarise. No call, and no row
     either — an empty cache row would have to be invalidated later by the same
     hash it never had. */
  if (activitiesIn(context).length === 0) {
    return {
      scope: { type: scope.scopeType, period_start: scope.periodStart, period_end: scope.periodEnd },
      insight: null,
      cached: false,
      is_stale: false,
      generated_at: null,
      status: "EMPTY",
    };
  }

  const reason: MissReason = !row
    ? "no_row"
    : row.contextHash !== currentHash
      ? "hash_mismatch"
      : "status_not_ready";

  /* Three consecutive failures and the view stops asking. The stale answer, if
     there is one, is still the best thing available; a retry is a person's
     decision from here. */
  if (row && row.failureCount >= MAX_CONSECUTIVE_FAILURES) {
    misses += 1;
    report({ scope, cacheHit: false, reason });
    return served(scope, row.insightPayload as InsightPayload, {
      cached: true,
      isStale: true,
      generatedAt: row.generatedAt,
      status: "FAILED",
    });
  }

  misses += 1;
  report({ scope, cacheHit: false, reason });

  return generateUnderLock({
    scope,
    canonical,
    currentHash,
    model,
    promptVersion,
    context,
    generate,
  });
}

/* ── Generation ───────────────────────────────────────────────────────────── */

async function generateUnderLock(input: {
  scope: InsightScope;
  canonical: string;
  currentHash: string;
  model: string;
  promptVersion: string;
  context: CanonicalContext;
  generate: (context: CanonicalContext) => Promise<InsightPayload>;
}): Promise<ServedInsight> {
  /* The row read before the lock is deliberately NOT carried in here. Whoever
     held the lock first may have written the very answer this call was about to
     pay for, so the only reading worth acting on is the one taken INSIDE the
     lock — see `fresh` below. */
  const { scope, canonical, currentHash, model, promptVersion, context, generate } = input;

  /* ── Single flight ──────────────────────────────────────────────────────
   * Two people opening the same week at once must not buy the same answer
   * twice. A transaction-scoped advisory lock on the scope key serialises them:
   * the second waits, then finds the first one's row already matching its hash
   * and returns it without calling anything.
   *
   * A database lock rather than one in memory, because the app runs more than
   * one instance and an in-process lock would serialise only its own callers.
   * `pg_advisory_xact_lock` releases with the transaction, so a crash cannot
   * strand it — the same reason the worklog writer uses this and not a
   * session-level lock. */
  const lockKey = `insight:${scope.instructorId}:${scope.scopeType}:${scope.periodStart}`;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      // Re-read inside the lock: whoever held it before us may have just
      // written exactly the answer we were about to pay for.
      const fresh = await tx.aiInsightCache.findUnique({
        where: {
          instructorId_scopeType_periodStart_periodEnd: {
            instructorId: scope.instructorId,
            scopeType: scope.scopeType,
            periodStart: toDateOnly(scope.periodStart),
            periodEnd: toDateOnly(scope.periodEnd),
          },
        },
      });
      if (fresh && fresh.status === "READY" && fresh.contextHash === currentHash) {
        hits += 1;
        misses = Math.max(0, misses - 1); // it was not a miss after all
        await tx.aiInsightCache.update({
          where: { id: fresh.id },
          data: { lastServedAt: new Date(), serveCount: { increment: 1 } },
        });
        return served(scope, fresh.insightPayload as InsightPayload, {
          cached: true,
          isStale: false,
          generatedAt: fresh.generatedAt,
          status: "READY",
        });
      }

      const startedAt = Date.now();
      try {
        const payload = await generate(context);

        /* The four fields that must always agree, written together. A snapshot
           that does not match the payload beside it is a cache that cannot be
           audited. */
        const data = {
          contextHash: currentHash,
          contextSnapshot: JSON.parse(canonical) as object,
          insightPayload: payload as unknown as object,
          promptVersion,
          modelId: model,
          status: "READY" as const,
          generatedAt: new Date(),
          failureCount: 0,
          lastError: null,
        };

        const saved = await tx.aiInsightCache.upsert({
          where: {
            instructorId_scopeType_periodStart_periodEnd: {
              instructorId: scope.instructorId,
              scopeType: scope.scopeType,
              periodStart: toDateOnly(scope.periodStart),
              periodEnd: toDateOnly(scope.periodEnd),
            },
          },
          create: {
            instructorId: scope.instructorId,
            scopeType: scope.scopeType,
            periodStart: toDateOnly(scope.periodStart),
            periodEnd: toDateOnly(scope.periodEnd),
            ...data,
          },
          update: data,
        });

        report({ scope, cacheHit: false, latencyMs: Date.now() - startedAt });
        return served(scope, payload, {
          cached: false,
          isStale: false,
          generatedAt: saved.generatedAt,
          status: "READY",
        });
      } catch (error) {
        /* A failure may cost an attempt and never an answer. Whatever READY row
           exists keeps its payload, its snapshot and its hash; only the counters
           and the error move. */
        const message = error instanceof Error ? error.message : "Generation failed";
        if (fresh) {
          await tx.aiInsightCache.update({
            where: { id: fresh.id },
            data: { failureCount: { increment: 1 }, lastError: message },
          });
          return served(scope, fresh.insightPayload as InsightPayload, {
            cached: true,
            isStale: true,
            generatedAt: fresh.generatedAt,
            status: "FAILED",
          });
        }

        // Nothing to fall back on. No row is written: a FAILED row with no
        // payload would be a cache entry that can never be served.
        return {
          scope: {
            type: scope.scopeType,
            period_start: scope.periodStart,
            period_end: scope.periodEnd,
          },
          insight: null,
          cached: false,
          is_stale: false,
          generated_at: null,
          status: "FAILED",
        };
      }
    },
    /* Long enough for a provider round trip. The lock is held for exactly this
       transaction, so a slow generation delays only other viewers of the SAME
       period. */
    { timeout: 60_000, maxWait: 20_000 },
  );
}

function served(
  scope: InsightScope,
  payload: InsightPayload | null,
  meta: { cached: boolean; isStale: boolean; generatedAt: Date | null; status: ServedInsight["status"] },
): ServedInsight {
  return {
    scope: { type: scope.scopeType, period_start: scope.periodStart, period_end: scope.periodEnd },
    insight: payload,
    cached: meta.cached,
    is_stale: meta.isStale,
    generated_at: meta.generatedAt ? meta.generatedAt.toISOString() : null,
    status: meta.status,
  };
}
