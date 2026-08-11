import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Analytics / utilisation / reporting gate.
 *
 * Everything is driven over raw HTTP against a real server and real database.
 * The numbers asserted below are worked out by hand in the comments so a
 * failure tells you which side is wrong rather than just "not equal".
 *
 * Northfield: Mon-Fri 09:00-18:00 Asia/Kolkata, 60 min break.
 *   -> capacity per working day = 9h - 1h break = 8h.
 * Week under test: Mon 2026-09-07 .. Fri 2026-09-11 (5 working days, 40h).
 */

const MON = "2026-09-07";
const TUE = "2026-09-08";
const WED = "2026-09-09";
const FRI = "2026-09-11";
const SUN = "2026-09-06";
const WEEK_FROM = "2026-09-07";
const WEEK_TO = "2026-09-11";

let admin: ApiClient;
let managerNorth: ApiClient;
let north1: ApiClient;

let northId: string;
let north1Id: string;

/** Logs an activity in Kolkata local time (IST = UTC+5:30). */
function istToUtc(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const utcMinutes = h * 60 + m - (5 * 60 + 30);
  const base = Date.parse(`${date}T00:00:00.000Z`) + utcMinutes * 60_000;
  return new Date(base).toISOString();
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  managerNorth = new ApiClient("mgrN");
  north1 = new ApiClient("north1");
  await admin.login(ACCOUNTS.admin);
  await managerNorth.login(ACCOUNTS.managerNorth);
  const me = await north1.login(ACCOUNTS.instructorNorth1);
  north1Id = me.user.instructorId!;
  northId = me.user.universityId!;

  // MONDAY: two OVERLAPPING teaching blocks, 09:00-12:00 and 11:00-13:00 IST.
  // Union = 09:00-13:00 = 4h. Naive sum would be 5h.
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: istToUtc(MON, "09:00"),
    endTime: istToUtc(MON, "12:00"),
  });
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: istToUtc(MON, "11:00"),
    endTime: istToUtc(MON, "13:00"),
  });

  // TUESDAY: 2h teaching + 1h UNUTILIZED (not productive).
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: istToUtc(TUE, "09:00"),
    endTime: istToUtc(TUE, "11:00"),
  });
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "UNUTILIZED",
    startTime: istToUtc(TUE, "11:00"),
    endTime: istToUtc(TUE, "12:00"),
  });

  // WEDNESDAY: opening + closing logged, plus 1h learning.
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "DAILY_OPENING",
    startTime: istToUtc(WED, "09:00"),
    endTime: istToUtc(WED, "09:15"),
  });
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "LEARNING",
    startTime: istToUtc(WED, "10:00"),
    endTime: istToUtc(WED, "11:00"),
  });
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "DAILY_CLOSING",
    startTime: istToUtc(WED, "17:45"),
    endTime: istToUtc(WED, "18:00"),
  });

  // THURSDAY and FRIDAY: deliberately NO records -> MISSING_DATA, not zero.
});

async function analytics(client: ApiClient, from = WEEK_FROM, to = WEEK_TO) {
  const res = await client.get(`/api/universities/${northId}/analytics?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  return res.body.analytics;
}

describe("overlapping activities are merged, never summed", () => {
  test("Monday's two overlapping blocks count as 4h, not 5h", async () => {
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    const monday = me.days.find((d: { date: string }) => d.date === MON);

    expect(monday.productiveHours).toBe(4);
    // The double-count is surfaced as a data-quality signal rather than hidden.
    expect(me.overlapHours).toBeGreaterThan(0);
  });
});

describe("capacity, utilisation and the missing-data distinction", () => {
  test("a hand-computed week reconciles exactly", async () => {
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);

    // 5 working days x 8h = 40h capacity.
    expect(me.expectedWorkingDays).toBe(5);
    expect(me.capacityHours).toBe(40);

    // Productive: Mon 4h + Tue 2h + Wed (0.25 opening + 1 learning + 0.25 closing) = 7.5h
    expect(me.productiveHours).toBe(7.5);

    // Unutilised counts ONLY days that have records: Mon 4h + Tue 6h + Wed 6.5h = 16.5h
    expect(me.unutilizedHours).toBe(16.5);

    // Thu + Fri have no records at all -> 16h of MISSING_DATA, never "0 hours worked".
    expect(me.missingDataHours).toBe(16);

    // Every capacity hour is accounted for exactly once.
    expect(me.productiveHours + me.unutilizedHours + me.missingDataHours).toBe(me.capacityHours);

    // 7.5 / 40 = 18.75%
    expect(me.utilizationPct).toBe(18.75);
  });

  test("UNUTILIZED time is recorded but is not productive", async () => {
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    const tuesday = me.days.find((d: { date: string }) => d.date === TUE);

    expect(me.hoursByActivityType.UNUTILIZED).toBe(1);
    expect(tuesday.productiveHours).toBe(2); // the unutilised hour is excluded
  });

  test("days without records report null rather than zero", async () => {
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    const friday = me.days.find((d: { date: string }) => d.date === FRI);

    expect(friday.hasData).toBe(false);
    expect(friday.unutilizedHours).toBeNull();
    expect(friday.capacityHours).toBe(8);
  });

  test("a non-working Sunday contributes no capacity", async () => {
    const a = await analytics(admin, SUN, SUN);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    expect(me.capacityHours).toBe(0);
    expect(me.expectedWorkingDays).toBe(0);
    expect(me.days[0].nonWorkingReason).toBe("NOT_A_WORKING_DAY");
  });

  test("opening/closing compliance is measured against expected working days", async () => {
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    // Opening logged on 1 of 5 expected working days.
    expect(me.openingCompliancePct).toBe(20);
    expect(me.closingCompliancePct).toBe(20);
  });
});

describe("approved leave shrinks capacity without punishing utilisation", () => {
  test("adding leave for Friday raises the percentage rather than lowering it", async () => {
    const before = await analytics(admin);
    const meBefore = before.instructors.find(
      (i: { instructorId: string }) => i.instructorId === north1Id,
    );
    expect(meBefore.capacityHours).toBe(40);
    expect(meBefore.utilizationPct).toBe(18.75);

    const leave = await managerNorth.post(`/api/instructors/${north1Id}/leave`, {
      startDate: FRI,
      endDate: FRI,
      status: "APPROVED",
      reason: "Approved leave",
    });
    expect(leave.status).toBe(201);

    const after = await analytics(admin);
    const meAfter = after.instructors.find(
      (i: { instructorId: string }) => i.instructorId === north1Id,
    );

    // Capacity drops by exactly one working day (8h).
    expect(meAfter.capacityHours).toBe(32);
    expect(meAfter.expectedWorkingDays).toBe(4);
    // Productive time is unchanged…
    expect(meAfter.productiveHours).toBe(7.5);
    // …so the percentage RISES: 7.5 / 32 = 23.44%. Leave must not be a penalty.
    expect(meAfter.utilizationPct).toBe(23.44);
    expect(meAfter.utilizationPct).toBeGreaterThan(meBefore.utilizationPct);

    const friday = meAfter.days.find((d: { date: string }) => d.date === FRI);
    expect(friday.nonWorkingReason).toBe("LEAVE");
    expect(friday.capacityHours).toBe(0);

    // Missing data shrinks too — Friday is no longer an unexplained gap.
    expect(meAfter.missingDataHours).toBe(8);
  });

  test("an instructor cannot approve their own leave", async () => {
    const res = await north1.post(`/api/instructors/${north1Id}/leave`, {
      startDate: MON,
      endDate: MON,
      status: "APPROVED",
    });
    expect(res.status).toBe(403);
  });
});

describe("dashboard and report agree (single engine)", () => {
  test("the report endpoint returns the same numbers as analytics", async () => {
    const a = await analytics(managerNorth);
    const rep = await managerNorth.get(
      `/api/universities/${northId}/reports?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    expect(rep.status).toBe(200);

    expect(rep.body.report.totals).toEqual(a.totals);

    const fromAnalytics = a.instructors.find(
      (i: { instructorId: string }) => i.instructorId === north1Id,
    );
    const fromReport = rep.body.report.rows.find(
      (r: { instructorName: string }) => r.instructorName === fromAnalytics.instructorName,
    );

    expect(fromReport.productiveHours).toBe(fromAnalytics.productiveHours);
    expect(fromReport.capacityHours).toBe(fromAnalytics.capacityHours);
    expect(fromReport.unutilizedHours).toBe(fromAnalytics.unutilizedHours);
    expect(fromReport.utilizationPct).toBe(fromAnalytics.utilizationPct);
  });

  test("the CSV export carries the same figures", async () => {
    const csv = await managerNorth.request(
      `/api/universities/${northId}/reports?from=${WEEK_FROM}&to=${WEEK_TO}&export=csv`,
      { method: "GET" },
    );
    expect(csv.status).toBe(200);

    const a = await analytics(managerNorth);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);

    const line = String(csv.body)
      .split("\n")
      .find((l) => l.startsWith(me.instructorName));
    expect(line).toBeDefined();
    expect(line!.split(",")).toContain(String(me.productiveHours));
  });
});

describe("the reporting period is honoured", () => {
  test("a range containing no data returns zero, not everything", async () => {
    const a = await analytics(admin, "2030-01-07", "2030-01-11");
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    expect(me.productiveHours).toBe(0);
  });

  test("a single day returns only that day", async () => {
    const a = await analytics(admin, MON, MON);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    expect(me.days).toHaveLength(1);
    expect(me.productiveHours).toBe(4);
    expect(me.capacityHours).toBe(8);
  });

  test("a malformed or reversed period is rejected", async () => {
    expect((await admin.get(`/api/universities/${northId}/analytics?from=${WEEK_TO}&to=${WEEK_FROM}`)).status).toBe(400);
    expect((await admin.get(`/api/universities/${northId}/analytics?from=nonsense&to=${WEEK_TO}`)).status).toBe(400);
    expect((await admin.get(`/api/universities/${northId}/analytics?from=${WEEK_FROM}`)).status).toBe(400);
  });
});

describe("activity logging rejects corrupt intervals", () => {
  test("endTime before startTime is refused", async () => {
    const res = await north1.post(`/api/instructors/${north1Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: istToUtc(TUE, "15:00"),
      endTime: istToUtc(TUE, "09:00"),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INTERVAL");
  });

  test("a zero-length activity is refused", async () => {
    const res = await north1.post(`/api/instructors/${north1Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: istToUtc(TUE, "15:00"),
      endTime: istToUtc(TUE, "15:00"),
    });
    expect(res.status).toBe(400);
  });

  test("an activity longer than a day is refused", async () => {
    const res = await north1.post(`/api/instructors/${north1Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2026-09-20T00:00:00Z",
      endTime: "2026-09-22T00:00:00Z",
    });
    expect(res.status).toBe(400);
  });
});

describe("an instructor's analytics cover only themselves", () => {
  test("self-scoped analytics returns one instructor", async () => {
    const res = await north1.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.analytics.instructors).toHaveLength(1);
    expect(res.body.analytics.instructors[0].instructorId).toBe(north1Id);
  });

  test("a self-scoped report contains only their own row", async () => {
    const res = await north1.get(
      `/api/universities/${northId}/reports?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.report.rows).toHaveLength(1);
  });
});
