/**
 * Fills a DEV database with a roster worth looking at.
 *
 *   npm run demo:roster
 *
 * Fifteen instructors on the seeded manager's roster, each with two days of
 * recorded work. The seed ships two instructors per university, which is right
 * for tests — every assertion in the suite is written against exactly that —
 * and useless for judging whether a dashboard built for a roster actually
 * reads like one.
 *
 * ── Why this is not in `prisma/seed.ts` ───────────────────────────────────
 * The test harness reseeds before every run, so anything added there lands in
 * the test database too. A great many tests count instructors, assert on roster
 * sizes, or read "the first instructor" positionally; fifteen more would break
 * them for reasons that have nothing to do with what they test. This is a
 * separate command, run deliberately, against whatever `DATABASE_URL` points
 * at.
 *
 * ── Idempotent ────────────────────────────────────────────────────────────
 * Instructors are keyed by a fixed email, and a day is skipped if that
 * instructor already has activities on it. Running it twice adds nothing and
 * removes nothing; it deletes no data under any circumstances.
 *
 * ── Why it writes through `logActivity` ───────────────────────────────────
 * The same writer the application uses, so the overlap rule, the once-per-day
 * rule, the interval limits and the timezone resolution all apply. Data that
 * skipped them would look fine and misrepresent what the product can hold.
 * It deliberately does NOT go through the worklog parser: that calls the
 * provider once per submission, which for thirty days of entries is a slow
 * bill for text nobody will read.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.TEST_ENV ? ".env.test" : ".env", quiet: true });

/* ── Everything below `main()` is imported DYNAMICALLY, and it has to be ────
 * `src/server/db.ts` reads `DATABASE_URL` at module scope and throws when it
 * is missing. Static imports are hoisted above every statement in this file,
 * so a plain `import` of anything that reaches `db.ts` runs before the
 * `loadEnv` call two lines up and dies on a variable that is about to exist.
 * `create-admin.ts` never hits this because it constructs its own client and
 * imports `db.ts` nowhere; this script wants the application's real writer, so
 * it defers instead. */

const PASSWORD = "Password123!";

const NAMES = [
  "Aditi Rao", "Rohan Mehta", "Kavya Nair", "Imran Sheikh", "Ananya Bose",
  "Vikram Chauhan", "Sneha Pillai", "Rahul Deshmukh", "Fatima Ansari", "Karthik Iyer",
  "Meera Joshi", "Sandeep Rana", "Divya Menon", "Arjun Kapoor", "Nisha Verma",
];

/**
 * A day's work, as a shape rather than as fifteen copies of one.
 *
 * `stated` is the point of the mix: an entry an instructor gave a clock for
 * prints that clock, and one that gave only a length prints the length. Both
 * exist in real data — the four-field form asks for a length and no clock —
 * so both exist here, or the dashboard would be demoed against a world it
 * does not actually see. See `ActivityLog.timesStated`.
 */
type Entry = {
  activityTypeCode: string;
  deliverable: string;
  start: string;
  end: string;
  quantity: number | null;
  remarks: string | null;
  stated: boolean;
};

const SHAPES: Entry[][] = [
  [
    { activityTypeCode: "TEACHING", deliverable: "CLASS_SESSION", start: "09:00", end: "11:00", quantity: 1, remarks: "Binary trees, section A", stated: true },
    { activityTypeCode: "MENTORING", deliverable: "ACADEMIC_GUIDANCE", start: "11:15", end: "12:00", quantity: 2, remarks: null, stated: true },
    { activityTypeCode: "ASSESSMENT", deliverable: "ASSIGNMENT_EVALUATION", start: "13:00", end: "15:30", quantity: 18, remarks: "Marked and returned", stated: false },
  ],
  [
    { activityTypeCode: "PRACTICAL_LAB", deliverable: "LAB_SESSION", start: "09:30", end: "12:30", quantity: 1, remarks: "Unit 3 practicals", stated: true },
    { activityTypeCode: "CONTENT_DEVELOPMENT", deliverable: null as unknown as string, start: "14:00", end: "16:00", quantity: null, remarks: "Slide deck for next week", stated: false },
  ],
  [
    { activityTypeCode: "TEACHING", deliverable: "TUTORIAL", start: "10:00", end: "11:30", quantity: 1, remarks: null, stated: true },
    { activityTypeCode: "STUDENT_SUPPORT", deliverable: null as unknown as string, start: "11:45", end: "13:15", quantity: 3, remarks: "Doubt clearing", stated: false },
    { activityTypeCode: "MEETING", deliverable: null as unknown as string, start: "15:00", end: "15:45", quantity: 1, remarks: "Department sync", stated: true },
  ],
  [
    { activityTypeCode: "ASSESSMENT", deliverable: "EXAM_EVALUATION", start: "09:00", end: "12:00", quantity: 25, remarks: "Mid-term scripts", stated: false },
    { activityTypeCode: "RESEARCH", deliverable: "LITERATURE_REVIEW", start: "13:30", end: "15:00", quantity: null, remarks: null, stated: false },
  ],
  [
    { activityTypeCode: "TEACHING", deliverable: "CLASS_SESSION", start: "08:45", end: "10:45", quantity: 1, remarks: "Graph traversal", stated: true },
    { activityTypeCode: "TEACHING", deliverable: "REVISION_SESSION", start: "11:00", end: "12:00", quantity: 1, remarks: null, stated: true },
    { activityTypeCode: "ADMINISTRATIVE", deliverable: null as unknown as string, start: "14:00", end: "15:00", quantity: null, remarks: "Attendance and records", stated: false },
  ],
];

async function main() {
  const { prisma } = await import("../src/server/db");
  const { hashPassword } = await import("../src/server/auth/password");
  const { logActivity } = await import("../src/server/activities/logger");
  const { workDateFor } = await import("../src/server/time/workday");

  const university = await prisma.university.findFirst({
    where: { primaryManagerId: { not: null } },
    select: { id: true, name: true, timezone: true, primaryManagerId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!university) throw new Error("No university with a primary manager. Run `npm run db:seed` first.");

  const deliverables = await prisma.deliverableType.findMany({ select: { id: true, code: true } });
  const deliverableId = new Map(deliverables.map((d) => [d.code, d.id]));

  const passwordHash = await hashPassword(PASSWORD);
  // Yesterday and today, in the UNIVERSITY's zone — the only zone a work day
  // is judged in anywhere in this product.
  const now = new Date();
  const today = workDateFor(now, university.timezone);
  const yesterday = workDateFor(new Date(now.getTime() - 86_400_000), university.timezone);

  let created = 0;
  let written = 0;
  let skipped = 0;

  for (const [i, name] of NAMES.entries()) {
    const email = `demo.instructor${i + 1}@example.edu`;

    let instructor = await prisma.instructor.findFirst({
      where: { user: { email } },
      select: { id: true },
    });

    if (!instructor) {
      const user = await prisma.user.create({
        data: { email, name, role: "INSTRUCTOR", passwordHash, universityId: university.id },
      });
      instructor = await prisma.instructor.create({
        data: {
          userId: user.id,
          universityId: university.id,
          employeeCode: `NF-1${String(i + 1).padStart(2, "0")}`,
          // On the seeded manager's roster, or they are on nobody's and the
          // manager's dashboard — the thing this exists to populate — cannot
          // see them at all.
          managerId: university.primaryManagerId,
        },
        select: { id: true },
      });
      created += 1;
    }

    for (const [d, date] of [yesterday, today].entries()) {
      const already = await prisma.activityLog.count({
        where: { instructorId: instructor.id, workDate: new Date(`${date}T00:00:00.000Z`) },
      });
      if (already > 0) {
        skipped += 1;
        continue;
      }

      // Two different shapes per person, so a roster does not read as fifteen
      // copies of one day.
      const shape = SHAPES[(i + d) % SHAPES.length]!;
      for (const entry of shape) {
        try {
          await logActivity({
            instructorId: instructor.id,
            universityId: university.id,
            activityTypeCode: entry.activityTypeCode,
            local: { date, start: entry.start, end: entry.end },
            timesStated: entry.stated,
            remarks: entry.remarks,
            ...(entry.deliverable && deliverableId.has(entry.deliverable)
              ? { deliverableTypeId: deliverableId.get(entry.deliverable)! }
              : {}),
            ...(entry.quantity !== null ? { quantity: entry.quantity } : {}),
          });
          written += 1;
        } catch (error) {
          // Reported rather than swallowed: a refusal here means the writer's
          // own rules rejected this shape, which is worth knowing about.
          console.warn(`  ${name} ${date} ${entry.activityTypeCode}: ${(error as Error).message}`);
        }
      }
    }
  }

  console.log(`Demo roster on ${university.name}:`);
  console.log(`  instructors created: ${created} (of ${NAMES.length}; the rest already existed)`);
  console.log(`  activities written:  ${written}`);
  console.log(`  days skipped:        ${skipped} (already had entries)`);
  console.log(`  sign in as any of:   demo.instructor1..${NAMES.length}@example.edu / ${PASSWORD}`);

  // The dashboards read the rollup tables, so a roster that never rolled up
  // shows zeros and looks broken rather than new.
  const { runRollup, trailingWindow } = await import("../src/server/jobs/metrics-scheduler");
  const result = await runRollup("SEED", trailingWindow(new Date(), 7));
  console.log(`  rollup: ${JSON.stringify(result)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
