/**
 * Automatic metric rollup.
 *
 * Why this exists: adding summary tables moved the dashboards off live
 * computation, but nothing populated those tables except a manual admin
 * request. A freshly seeded database therefore showed zeros until somebody
 * remembered to press a button. That is a regression in default behaviour, not
 * a configuration step, and this module is the fix.
 *
 * ── Cadence ────────────────────────────────────────────────────────────────
 * A tick every `ROLLUP_INTERVAL_MINUTES` (default 60) recomputes a TRAILING
 * WINDOW of `ROLLUP_WINDOW_DAYS` (default 3) for every active university.
 *
 * Trailing-window recompute rather than "roll up yesterday at midnight":
 *
 *   - Universities span timezones, so there is no single midnight. A window
 *     that always covers the last few days is correct in every zone without
 *     per-tenant scheduling.
 *   - Activity is logged late. A day summarised at midnight is wrong the moment
 *     someone back-fills it; recomputing it for a few more days self-corrects.
 *   - The rollup is idempotent (upserts on natural keys), so a missed tick,
 *     a restart, or two overlapping runs cost time, never correctness.
 *
 * The cost is recomputing days that have not changed. At the measured rate this
 * is cheap, and it buys freedom from the entire class of bugs where a job runs
 * at the wrong local hour or does not run at all.
 *
 * ── Concurrency ────────────────────────────────────────────────────────────
 * A LEASE, held as the RUNNING MetricsJobRun row, so N app instances behind a
 * load balancer produce one rollup rather than N.
 *
 * The first implementation used a session-level `pg_advisory_lock` held across
 * the whole job. That is broken under connection pooling: the lock is acquired
 * on one pooled connection and the unlock is issued on another, so the unlock
 * silently no-ops and the lock leaks until that connection is recycled. The
 * symptom was later rollups being refused for no visible reason.
 *
 * The lease is CLAIMED under a transaction-scoped advisory lock, which is
 * guaranteed to run on one connection and is released by the commit, so the
 * claim itself is atomic without holding anything across the long job. A lease
 * older than LEASE_TIMEOUT_MS is reclaimed, so a process dying mid-rollup does
 * not wedge the scheduler forever.
 */

import { prisma } from "@/server/db";
import { rollupAllUniversities } from "@/server/analytics/rollup";
import { runNotificationSweep } from "@/server/notifications/service";
import { workDateFor } from "@/server/time/workday";

/** Arbitrary but fixed: identifies THIS job among any future advisory locks. */
const ADVISORY_LOCK_KEY = 4_120_260_811;

/** A RUNNING row older than this is assumed to be from a dead process. */
const LEASE_TIMEOUT_MS = 30 * 60_000;

const INTERVAL_MINUTES = Number(process.env.ROLLUP_INTERVAL_MINUTES ?? 60);
const WINDOW_DAYS = Number(process.env.ROLLUP_WINDOW_DAYS ?? 3);

export type RollupTrigger = "SCHEDULED" | "MANUAL" | "SEED";

/**
 * The trailing window the rollup recomputes, in UTC, padded by a day each side.
 *
 * ── Why the padding is not slack ──────────────────────────────────────────
 * `rollupUniversityDaily` iterates these dates literally — it does not widen
 * them per university — so a UTC window is a UTC window, and a university is
 * not in UTC.
 *
 * At 01:00 in Asia/Kolkata it is still 19:30 the previous day in UTC, so an
 * unpadded window ran to "yesterday" while the university was already well into
 * today. Every entry logged in the first five and a half hours of an Indian
 * working day sat outside the window and was not summarised until UTC caught
 * up at 18:30 local. Nothing failed; the admin dashboard simply disagreed with
 * the live engine every morning, and self-corrected before anybody could
 * reproduce it.
 *
 * One day either side covers every zone that exists — UTC-12 through UTC+14 —
 * which is why the padding is stated in days rather than in hours, and why it
 * is derived from what timezones ARE rather than from where this happens to be
 * deployed. A university in Auckland or Honolulu is covered by the same line.
 *
 * Recomputing two extra days costs nothing that matters: the rollup upserts on
 * (instructor, date), so a day computed twice is corrected, never duplicated.
 */
export function trailingWindow(now: Date = new Date(), days: number = WINDOW_DAYS) {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return { from: workDateFor(start, "UTC"), to: workDateFor(end, "UTC") };
}

/**
 * Runs one rollup, recording the attempt either way.
 *
 * Returns null when another instance already holds the lock — that is a normal
 * outcome, not an error.
 */
export async function runRollup(
  trigger: RollupTrigger,
  window?: { from: string; to: string },
): Promise<{ id: string; instructorDays: number; instructorWeeks: number } | null> {
  const { from, to } = window ?? trailingWindow();

  const started = Date.now();

  // Claim the lease atomically. The advisory lock here is transaction-scoped,
  // so it lives and dies on a single connection inside this short transaction —
  // it is NOT held for the duration of the rollup.
  const run = await prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}::bigint) AS locked
    `;
    if (!locked) return null;

    // Reclaim a lease abandoned by a crashed process before checking for one.
    await tx.metricsJobRun.updateMany({
      where: {
        status: "RUNNING",
        startedAt: { lt: new Date(Date.now() - LEASE_TIMEOUT_MS) },
      },
      data: {
        status: "FAILED",
        errorMessage: "Lease expired — process presumed dead",
        completedAt: new Date(),
      },
    });

    const active = await tx.metricsJobRun.findFirst({ where: { status: "RUNNING" } });
    if (active) return null;

    return tx.metricsJobRun.create({
      data: { trigger, fromDate: from, toDate: to, status: "RUNNING" },
    });
  });

  // Another instance holds the lease. A normal outcome, not an error.
  if (!run) return null;

  try {
    const results = await rollupAllUniversities(from, to);
    const instructorDays = results.reduce((a, r) => a + r.instructorDays, 0);
    const instructorWeeks = results.reduce((a, r) => a + r.instructorWeeks, 0);

    // Notifications ride the same tick as the rollup: the conditions they
    // report are computed from the data just summarised, so running them apart
    // would let the two disagree about the same period. Deduped by key, so a
    // standing condition notifies once, not once an hour.
    for (const r of results) {
      try {
        await runNotificationSweep(r.universityId, from, to);
      } catch (error) {
        // One tenant's notification failure must not abandon the others.
        console.error("[metrics] notification sweep failed", r.universityId, error);
      }
    }

    await prisma.metricsJobRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        universitiesProcessed: results.length,
        instructorDaysWritten: instructorDays,
        instructorWeeksWritten: instructorWeeks,
        completedAt: new Date(),
        durationMs: Date.now() - started,
      },
    });

    return { id: run.id, instructorDays, instructorWeeks };
  } catch (error) {
    // Recorded rather than swallowed: a silently failing rollup looks exactly
    // like "no activity happened", which is the misreading this whole codebase
    // works to avoid.
    await prisma.metricsJobRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
        durationMs: Date.now() - started,
      },
    });
    throw error;
  }
}

let timer: NodeJS.Timeout | undefined;

/**
 * Starts the periodic rollup. Idempotent — calling twice in one process does
 * not create two timers, which matters because Next.js may evaluate a module
 * more than once in development.
 */
export function startMetricsScheduler(): void {
  if (timer) return;
  if (process.env.DISABLE_ROLLUP_SCHEDULER === "1") {
    console.log("[metrics] scheduler disabled via DISABLE_ROLLUP_SCHEDULER");
    return;
  }

  const tick = async () => {
    try {
      const result = await runRollup("SCHEDULED");
      if (result) {
        console.log(
          `[metrics] rollup complete: ${result.instructorDays} instructor-days, ` +
            `${result.instructorWeeks} instructor-weeks`,
        );
      }
    } catch (error) {
      // Never let a failed tick kill the timer; the next one retries.
      console.error("[metrics] scheduled rollup failed", error);
    }
  };

  console.log(
    `[metrics] scheduler started: every ${INTERVAL_MINUTES} min, ` +
      `trailing ${WINDOW_DAYS} days`,
  );

  // Run once shortly after boot so a fresh deployment does not wait a full
  // interval before its dashboards have data.
  setTimeout(() => void tick(), 5_000).unref?.();
  timer = setInterval(() => void tick(), INTERVAL_MINUTES * 60_000);
  timer.unref?.();
}
