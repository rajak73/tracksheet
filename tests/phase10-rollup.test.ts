import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { seedDays } from "./helpers/worklog";

/**
 * Summary-table gate.
 *
 * The whole risk of adding aggregation tables is that they drift from the raw
 * data they summarise — which is exactly the failure this codebase already had
 * once, when reports and dashboards computed workload independently. These
 * tests assert the rollup and the live engine produce the SAME numbers, so a
 * drill-down can never contradict the summary above it.
 */

const MON = "2026-06-22";
const TUE = "2026-06-23";
const WEEK_FROM = "2026-06-22";
const WEEK_TO = "2026-06-26";

let admin: ApiClient;
let mgrN: ApiClient;
let n1: ApiClient;
let northId: string;
let n1Id: string;

/* `istToUtc` is gone with the clock ranges it built. A day is one row with
   the hours the instructor entered — there is no start and end to convert. */

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  n1 = new ApiClient("n1");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  const me = await n1.login(ACCOUNTS.instructorNorth1);
  n1Id = me.user.instructorId!;
  northId = me.user.universityId!;

  // Monday: 4h of teaching across two ADJACENT blocks. These used to overlap;
  // overlapping activity is now rejected at the API, so the fixture is
  // adjacent instead and Monday still totals exactly 4h.
  /* Two days, written through the route the instructor uses. This was four
     activity posts with clock ranges; the engine reads `WorklogEntry` now, so a
     day is one row carrying the hours they entered.

     The dates moved out of October, which was in the FUTURE — the activity
     route accepted that and the worklog route refuses it, so left alone this
     fixture would have written nothing and the rollup would have summarised an
     empty week. */
  await seedDays(n1, n1Id, [
    { date: MON, deliverable: "Teaching, two blocks", workingHours: "4h" },
    { date: TUE, deliverable: "Opening, then two hours teaching", workingHours: "2h 15m" },
  ]);

  // Build the summary tables from that raw activity.
  const res = await admin.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {});
  expect(res.status).toBe(200);
});

describe("the rollup agrees with the live engine", () => {
  test("admin overview (summary-backed) matches the live engine", async () => {
    const overview = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    expect(overview.status).toBe(200);

    const north = overview.body.universities.find(
      (u: { universityId: string }) => u.universityId === northId,
    );

    /* Both sides are read as the ADMIN, on purpose.
     *
     * This used to call the engine as a MANAGER, and it held only while that
     * manager happened to own every instructor in North. A manager's analytics
     * are now pinned to their own roster — `narrowManager` does it for the
     * tracker, the reports and this endpoint alike, so one question has one
     * answer — while the admin overview covers the whole university. The moment
     * any other test file adds a North instructor under a different manager,
     * the two are counting different people and the equality is meaningless:
     * capacity came back 120 against 80, three instructors against two.
     *
     * The comparison this test exists to make is between the two CODE PATHS,
     * not the two roles. Reading both as the admin holds the population fixed
     * so a difference can only come from the thing under test. */
    const analytics = await admin.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const totals = analytics.body.analytics.totals;

    // These come from two different code paths — one reads
    // UniversityDailyMetric, the other computes from ActivityLog.
    expect(north.capacityHours).toBe(totals.capacityHours);
    expect(north.productiveHours).toBe(totals.productiveHours);
    expect(north.unutilizedHours).toBe(totals.unutilizedHours);
    expect(north.missingDataHours).toBe(totals.missingDataHours);
    expect(north.recordedHoursPct).toBe(totals.recordedHoursPct);
  });

  test("multiple blocks on one day are summarised correctly", async () => {
    const overview = await admin.get(`/api/admin/overview?from=${MON}&to=${MON}`);
    const north = overview.body.universities.find(
      (u: { universityId: string }) => u.universityId === northId,
    );
    // Monday's two adjacent blocks total 4h.
    expect(north.productiveHours).toBe(4);
  });

  test("re-running the rollup is idempotent", async () => {
    const before = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    await admin.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {});
    await admin.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {});
    const after = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);

    expect(after.body.overview).toEqual(before.body.overview);
  });

  test("a late-submitted activity is picked up on the next rollup", async () => {
    const before = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    const beforeHours = before.body.overview.productiveHours;

    /* A day corrected after it was already summarised. Tuesday goes from
       2h 15m to 3h 15m — the worklog route upserts, so a second save of the
       same day is the correction, not a second row. */
    await seedDays(n1, n1Id, [
      { date: TUE, deliverable: "Opening, teaching, and an hour of learning", workingHours: "3h 15m" },
    ]);

    // Stale until recomputed — the summary is a cache, not a second truth.
    const stale = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    expect(stale.body.overview.productiveHours).toBe(beforeHours);

    await admin.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {});
    const fresh = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    expect(fresh.body.overview.productiveHours).toBe(beforeHours + 1);

    // …and it still matches the engine after recomputation. Read as the ADMIN
    // so both sides cover the whole university — a manager's analytics are
    // pinned to their own roster, and comparing that to a university-wide
    // summary compares two different populations. See the note above.
    const analytics = await admin.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const north = fresh.body.universities.find(
      (u: { universityId: string }) => u.universityId === northId,
    );
    expect(north.productiveHours).toBe(analytics.body.analytics.totals.productiveHours);
  });

  test("the dashboard's headline figures need no shared vocabulary", async () => {
    /* This asserted that TEACHING and LEARNING hours survived the rollup. Those
       two numbers led the admin dashboard and were read out of the TEACHING and
       LEARNING codes — a two-item taxonomy at the top of the page, which every
       instructor had to file their work under for the figures to mean anything.

       What replaced them counts days and adds up hours, and both mean the same
       thing in every instructor's own words. Read from `WorklogEntry`, so they
       are also the only headline figures on that page that are not currently
       marked unavailable. */
    const overview = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    expect(overview.status).toBe(200);

    for (const field of ["totalHours", "daysLogged", "instructorsLogging"]) {
      expect(overview.body.overview, field).toHaveProperty(field);
      expect(typeof overview.body.overview[field], field).toBe("number");
      expect(overview.body.overview[field], field).toBeGreaterThanOrEqual(0);
    }

    // And the category split is gone from the payload, not merely unrendered.
    expect(overview.body.overview).not.toHaveProperty("hoursByActivityType");
    expect(overview.body.overview).not.toHaveProperty("teachingHours");
    expect(overview.body.overview).not.toHaveProperty("learningHours");
  });

  test("missing data is preserved through the rollup, not folded into unutilized", async () => {
    const overview = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    // Wed/Thu/Fri have no records for this instructor.
    expect(overview.body.overview.missingDataHours).toBeGreaterThan(0);
  });
});

describe("the instructor summary matches the engine too", () => {
  test("per-instructor totals agree with the live analytics engine", async () => {
    const metrics = await n1.get(
      `/api/instructors/${n1Id}/metrics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    expect(metrics.status).toBe(200);

    const analytics = await n1.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const mine = analytics.body.analytics.instructors[0];

    // Two independent paths: InstructorDailyMetric rows vs live computation.
    expect(metrics.body.totals.capacityHours).toBe(mine.capacityHours);
    expect(metrics.body.totals.productiveHours).toBe(mine.productiveHours);
    expect(metrics.body.totals.unutilizedHours).toBe(mine.unutilizedHours);
    expect(metrics.body.totals.missingDataHours).toBe(mine.missingDataHours);
    expect(metrics.body.totals.recordedHoursPct).toBe(mine.recordedHoursPct);
  });

  test("each summarised day matches its engine equivalent", async () => {
    const metrics = await n1.get(
      `/api/instructors/${n1Id}/metrics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const analytics = await n1.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const engineDays = analytics.body.analytics.instructors[0].days;

    expect(metrics.body.days.length).toBe(engineDays.length);
    for (const day of metrics.body.days) {
      const engineDay = engineDays.find((d: { date: string }) => d.date === day.date);
      expect(engineDay, `no engine day for ${day.date}`).toBeDefined();
      expect(day.productiveHours, day.date).toBe(engineDay.productiveHours);
      expect(day.capacityHours, day.date).toBe(engineDay.capacityHours);
      expect(day.isWorkingDay, day.date).toBe(engineDay.isWorkingDay);
    }
  });

  test("re-running the rollup leaves instructor metrics unchanged", async () => {
    const before = await n1.get(
      `/api/instructors/${n1Id}/metrics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    await admin.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {});
    const after = await n1.get(
      `/api/instructors/${n1Id}/metrics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    expect(after.body).toEqual(before.body);
  });

  test("an instructor cannot read a colleague's summary", async () => {
    const colleague = await admin.get(`/api/instructors?universityId=${northId}`);
    const other = colleague.body.instructors.find(
      (i: { id: string }) => i.id !== n1Id,
    ).id;
    expect((await n1.get(`/api/instructors/${other}/metrics`)).status).toBe(404);
  });
});

describe("rollup authorization", () => {
  test("only an admin can trigger a rollup", async () => {
    expect((await mgrN.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {})).status).toBe(403);
    expect((await n1.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {})).status).toBe(403);
    expect((await new ApiClient("anon").post(`/api/admin/rollup`, {})).status).toBe(401);
  });
});
