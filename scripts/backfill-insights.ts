/**
 * Analyses days that were recorded before the analysis existed.
 *
 * ── Why this is needed ────────────────────────────────────────────────────
 * `analyseDay` runs when a day is written, so every day recorded BEFORE that
 * hook existed has no stored reading and its AI Insight column shows an em
 * dash. That is honest but unhelpful on an existing database, where the whole
 * history predates the feature.
 *
 * This walks the days that already have activity and analyses each one through
 * exactly the same function the write path calls — no second implementation,
 * so a backfilled row and a freshly written one are indistinguishable.
 *
 * ── Run it ────────────────────────────────────────────────────────────────
 *   npx tsx scripts/backfill-insights.ts [--days 30] [--force]
 *
 * `--days` bounds how far back to go (default 30). `--force` re-analyses days
 * that already have an insight; without it those are skipped, which makes the
 * script safe to re-run and cheap on the second pass.
 *
 * Sequential on purpose. Each day may call the model through `summariseDays`,
 * and firing a month of a large roster at a provider in parallel is how a rate
 * limit turns a backfill into a pile of fallback prose.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.TEST_ENV ? ".env.test" : ".env", quiet: true });

/* Everything that reaches `src/server/db.ts` is imported DYNAMICALLY inside
 * `main()`, for the reason `demo-roster.ts` documents at length: `db.ts` reads
 * `DATABASE_URL` at module scope and throws when it is missing, and static
 * imports are hoisted above the `loadEnv` call two lines up — so a plain
 * import dies on a variable that is about to exist. */

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const { prisma } = await import("@/server/db");
  const { analyseDay, DAY_INSIGHT_TYPE } = await import("@/server/worklog/analysis");

  const days = arg("days", 30);
  const force = process.argv.includes("--force");

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  /* Distinct instructor-days that actually hold work. Grouping in the database
     rather than pulling every activity row: a month of a large roster is tens
     of thousands of activities and a few hundred days. */
  const recorded = await prisma.activityLog.groupBy({
    by: ["instructorId", "workDate"],
    where: { workDate: { gte: since } },
    _count: { _all: true },
  });

  console.log(`Found ${recorded.length} recorded instructor-days in the last ${days} days.`);
  if (recorded.length === 0) return;

  const instructorIds = [...new Set(recorded.map((r) => r.instructorId))];
  const instructors = await prisma.instructor.findMany({
    where: { id: { in: instructorIds } },
    select: { id: true, universityId: true },
  });
  const universityOf = new Map(instructors.map((i) => [i.id, i.universityId]));

  const existing = force
    ? new Set<string>()
    : new Set(
        (
          await prisma.aiInsight.findMany({
            where: { type: DAY_INSIGHT_TYPE, periodStart: { gte: since } },
            select: { instructorId: true, periodStart: true },
          })
        ).map((r) => `${r.instructorId}:${r.periodStart.toISOString().slice(0, 10)}`),
      );

  let analysed = 0;
  let skipped = 0;

  for (const row of recorded) {
    const workDate = row.workDate.toISOString().slice(0, 10);
    const universityId = universityOf.get(row.instructorId);
    if (!universityId) {
      skipped += 1;
      continue;
    }
    if (existing.has(`${row.instructorId}:${workDate}`)) {
      skipped += 1;
      continue;
    }

    // The same function the write path calls. It swallows its own failures, so
    // one unreadable day cannot end the run.
    await analyseDay({ instructorId: row.instructorId, universityId, workDate });
    analysed += 1;

    if (analysed % 10 === 0) console.log(`  …${analysed} analysed`);
  }

  const total = await prisma.aiInsight.count({ where: { type: DAY_INSIGHT_TYPE } });
  console.log(`\nAnalysed ${analysed}, skipped ${skipped}.`);
  console.log(`${total} day insights now stored.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("@/server/db");
    await prisma.$disconnect();
  });
