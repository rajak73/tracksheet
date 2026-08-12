import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Summary-table gate.
 *
 * The whole risk of adding aggregation tables is that they drift from the raw
 * data they summarise — which is exactly the failure this codebase already had
 * once, when reports and dashboards computed workload independently. These
 * tests assert the rollup and the live engine produce the SAME numbers, so a
 * drill-down can never contradict the summary above it.
 */

const MON = "2026-10-05";
const TUE = "2026-10-06";
const WEEK_FROM = "2026-10-05";
const WEEK_TO = "2026-10-09";

let admin: ApiClient;
let mgrN: ApiClient;
let n1: ApiClient;
let northId: string;
let n1Id: string;

/** Northfield is Asia/Kolkata (UTC+5:30). */
function istToUtc(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const utcMinutes = h * 60 + m - (5 * 60 + 30);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + utcMinutes * 60_000).toISOString();
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  n1 = new ApiClient("n1");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  const me = await n1.login(ACCOUNTS.instructorNorth1);
  n1Id = me.user.instructorId!;
  northId = me.user.universityId!;

  // Monday: 4h of teaching from two overlapping blocks (union, not sum).
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: istToUtc(MON, "09:00"),
    endTime: istToUtc(MON, "12:00"),
  });
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: istToUtc(MON, "11:00"),
    endTime: istToUtc(MON, "13:00"),
  });
  // Tuesday: opening + 2h teaching.
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "DAILY_OPENING",
    startTime: istToUtc(TUE, "09:00"),
    endTime: istToUtc(TUE, "09:15"),
  });
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: istToUtc(TUE, "10:00"),
    endTime: istToUtc(TUE, "12:00"),
  });

  // Build the summary tables from that raw activity.
  const res = await admin.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {});
  expect(res.status).toBe(200);
});

describe("the rollup agrees with the live engine", () => {
  test("admin overview (summary-backed) matches manager analytics (engine)", async () => {
    const overview = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    expect(overview.status).toBe(200);

    const north = overview.body.universities.find(
      (u: { universityId: string }) => u.universityId === northId,
    );

    const analytics = await mgrN.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const totals = analytics.body.analytics.totals;

    // These come from two different code paths — one reads
    // UniversityDailyMetric, the other computes from ActivityLog.
    expect(north.capacityHours).toBe(totals.capacityHours);
    expect(north.productiveHours).toBe(totals.productiveHours);
    expect(north.unutilizedHours).toBe(totals.unutilizedHours);
    expect(north.missingDataHours).toBe(totals.missingDataHours);
    expect(north.utilizationPct).toBe(totals.utilizationPct);
  });

  test("overlapping activity is merged in the summary too", async () => {
    const overview = await admin.get(`/api/admin/overview?from=${MON}&to=${MON}`);
    const north = overview.body.universities.find(
      (u: { universityId: string }) => u.universityId === northId,
    );
    // Monday's two overlapping blocks are 4h of union, not 5h of sum.
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

    // Activity logged after the day was already summarised.
    await n1.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: "LEARNING",
      startTime: istToUtc(TUE, "14:00"),
      endTime: istToUtc(TUE, "15:00"),
    });

    // Stale until recomputed — the summary is a cache, not a second truth.
    const stale = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    expect(stale.body.overview.productiveHours).toBe(beforeHours);

    await admin.post(`/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`, {});
    const fresh = await admin.get(`/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`);
    expect(fresh.body.overview.productiveHours).toBe(beforeHours + 1);

    // …and it still matches the engine after recomputation.
    const analytics = await mgrN.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const north = fresh.body.universities.find(
      (u: { universityId: string }) => u.universityId === northId,
    );
    expect(north.productiveHours).toBe(analytics.body.analytics.totals.productiveHours);
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
    expect(metrics.body.totals.utilizationPct).toBe(mine.utilizationPct);
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
      expect(day.openingLogged, day.date).toBe(engineDay.openingLogged);
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
