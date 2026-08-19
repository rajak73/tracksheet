/**
 * Read-only look at what is actually in the database.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The deployed image carries no `psql` — it is a Node runtime, not a database
 * client — and the addon is not reachable from outside the project, which is
 * the correct posture for a database holding one client's instructors across
 * every university they work with. So "what is in there?" needs an answer that
 * runs INSIDE the container, using the Prisma client that is already shipped.
 *
 * ── It only reads ─────────────────────────────────────────────────────────
 * No writes, no deletes, no schema changes, nothing that takes a lock. Safe to
 * run against production at any time, including while people are using it.
 *
 * ── It prints no personal data by default ─────────────────────────────────
 * Counts, names of universities, and employee codes — the things you need to
 * answer "did the import work" and "is anybody recording". Not email addresses,
 * not the text of anyone's worklog. Pass `--detail` when you genuinely need the
 * roster, and even then it stays to names and codes.
 *
 *   npm run db:inspect
 *   npm run db:inspect -- --detail
 */

// Locally the URL lives in `.env`; in the container it arrives as a real
// environment variable and this is a no-op.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const DETAIL = process.argv.includes("--detail");

const fmtHours = (h: number) => {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}h ${String(m % 60).padStart(2, "0")}m`;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  // Host only — never the password, because this output gets pasted into chats.
  const host = url.replace(/^.*@/, "").replace(/\?.*$/, "");
  console.log(`\nDatabase: ${host}\n`);

  const counts: Record<string, number> = {};
  for (const model of [
    "user",
    "university",
    "manager",
    "instructor",
    "activityLog",
    "worklogSubmission",
    "notification",
    "auditLog",
    "activityType",
    "deliverableType",
    "instructorCategory",
  ] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    counts[model] = await (db as any)[model].count();
  }
  console.log("── Row counts ──────────────────────────────────────────");
  console.table(counts);

  /* Reference data is the one thing whose ABSENCE breaks everything: with no
   * activity types, recording anything fails and every report is empty. So it
   * gets its own line rather than being read off the table above. */
  const ok =
    counts.activityType === 16 && counts.deliverableType === 44 && counts.instructorCategory === 4;
  console.log(
    `\nReference data: ${ok ? "complete" : "INCOMPLETE — run `npm run db:reference-data`"}` +
      `  (${counts.activityType}/16 activity types, ${counts.deliverableType}/44 deliverables, ` +
      `${counts.instructorCategory}/4 categories)`,
  );

  if (counts.user === 0) {
    console.log("\nNo users yet. Nobody can sign in — run `npm run admin:create`.");
  }

  const universities = await db.university.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      timezone: true,
      _count: { select: { instructors: true, managers: true } },
    },
  });

  if (universities.length > 0) {
    console.log("\n── Universities ────────────────────────────────────────");
    console.table(
      universities.map((u) => ({
        name: u.name,
        code: u.code,
        timezone: u.timezone,
        managers: u._count.managers,
        instructors: u._count.instructors,
      })),
    );
  }

  const recent = await db.activityLog.findMany({
    orderBy: { workDate: "desc" },
    take: 1,
    select: { workDate: true },
  });
  console.log(
    `\nMost recent recorded day: ${
      recent[0] ? recent[0].workDate.toISOString().slice(0, 10) : "nothing recorded yet"
    }`,
  );

  if (DETAIL) {
    const instructors = await db.instructor.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        employeeCode: true,
        user: { select: { name: true, isActive: true } },
        university: { select: { name: true } },
        manager: { select: { user: { select: { name: true } } } },
        category: { select: { label: true } },
        _count: { select: { activityLogs: true } },
      },
    });

    console.log("\n── Instructors ─────────────────────────────────────────");
    console.table(
      instructors.map((i) => ({
        name: i.user.name,
        code: i.employeeCode ?? "—",
        university: i.university.name,
        manager: i.manager?.user.name ?? "unassigned",
        category: i.category?.label ?? "—",
        entries: i._count.activityLogs,
        status: i.user.isActive ? "active" : "former",
      })),
    );

    /* Working Hours, by the product's own rule, so this agrees with every
     * screen rather than being a fourth answer. */
    const { workingHoursByInstructor } = await import("../src/server/analytics/hours-by-instructor.js");
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const hours = await workingHoursByInstructor({ from, to: today });
    const total = [...hours.values()].reduce((n, h) => n + h, 0);
    console.log(`\nWorking Hours across the network, ${from} → ${today}: ${fmtHours(total)}`);
  }

  console.log("");
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
