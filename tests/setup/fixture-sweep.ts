/**
 * Clear everything a previous run left behind, BEFORE the next one starts.
 *
 * ── Why a sweep exists in addition to the seed ────────────────────────────
 * `prisma db seed` already deletes every user, manager, instructor and
 * university, so accounts genuinely cannot survive into the next run — that
 * was measured, not assumed. But the seed's delete list is the set of tables
 * the SEED owns, and the product has grown tables the seed never wrote:
 * metrics job history, insight and extraction caches, worklog rows that
 * outlive nothing. `metricsJobRun` had reached 338 rows on a freshly seeded
 * database, which is every run this project has ever done, still there.
 *
 * The seed's cleanup is also the LAST thing standing between a killed run and
 * the next one. `afterAll` does not run when a process is SIGKILLed to free a
 * port, and that happens constantly here. So cleanup belongs at the START of a
 * run, where an interrupted previous run cannot skip it.
 *
 * Reference data is deliberately absent from this list. Activity and
 * deliverable types are upserted by the seed and referenced by historical
 * rows; deleting them would change ids that history points at.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";

/**
 * Children before parents, so foreign keys are satisfied on the first pass.
 * The sweep retries anyway — knowing the order exactly is not a prerequisite
 * for the sweep being correct, only for it being quick.
 */
const SWEEP_ORDER = [
  "dayExtraction",
  "aiInsightCache",
  "worklogDaySummary",
  "worklogEntry",
  "worklogSubmission",
  "worklogDayNote",
  "worklogActivityArchive",
  "instructorDailyMetric",
  "instructorWeeklyMetric",
  "universityDailyMetric",
  "metricsJobRun",
  "reportJob",
  "courseAssignment",
  "scheduleSlot",
  "schedule",
  "course",
  "academicTerm",
  "program",
  "department",
  "breakPolicy",
  "reportingPeriod",
  "universitySettings",
] as const;

export type SweepResult = { table: string; deleted: number }[];

/**
 * `tables` exists so the sweep can be tested without the test doing to the
 * suite exactly what the sweep does to a dirty database. Global setup passes
 * nothing and gets the full list; a test passes two tables nothing else reads
 * and exercises the same retry, count and report path.
 */
export async function sweepFixtures(
  connectionString: string,
  tables: readonly string[] = SWEEP_ORDER,
): Promise<SweepResult> {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const deleted: SweepResult = [];
  try {
    let pending = [...tables] as string[];
    /* Three passes, because a foreign key that blocks a delete on pass one is
     * usually gone by pass two. A table that still refuses after three passes
     * is a real schema fact, not a transient, and is reported rather than
     * swallowed — a sweep that quietly gives up is worse than none. */
    for (let pass = 0; pass < 3 && pending.length; pass++) {
      const blocked: string[] = [];
      for (const table of pending) {
        const model = (db as unknown as Record<string, { deleteMany?: () => Promise<{ count: number }> }>)[table];
        if (!model?.deleteMany) continue;
        try {
          const { count } = await model.deleteMany();
          if (count > 0) deleted.push({ table, deleted: count });
        } catch {
          blocked.push(table);
        }
      }
      pending = blocked;
    }
    if (pending.length) {
      throw new Error(
        `Fixture sweep could not clear: ${pending.join(", ")}. ` +
          `A foreign key is holding them and the next run would start dirty.`,
      );
    }
  } finally {
    await db.$disconnect();
  }
  return deleted;
}
