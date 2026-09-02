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

  // MONDAY: 4h of teaching as two ADJACENT blocks, 09:00-12:00 and 12:00-13:00
  // IST.
  //
  // These used to overlap (09:00-12:00 + 11:00-13:00) to prove the engine
  // unions intervals instead of summing them. Overlapping activity is now
  // rejected at the API — an instructor cannot be in two places at once — so
  // the fixture can no longer be created that way. The blocks are adjacent
  // instead, which keeps Monday at exactly 4h and leaves every capacity,
  // utilisation and missing-data assertion below testing what it always did.
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: istToUtc(MON, "09:00"),
    endTime: istToUtc(MON, "12:00"),
  });
  await north1.post(`/api/instructors/${north1Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: istToUtc(MON, "12:00"),
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

describe("multiple activities on one day accumulate correctly", () => {
  test("Monday's two adjacent blocks count as 4h", async () => {
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    const monday = me.days.find((d: { date: string }) => d.date === MON);

    expect(monday.productiveHours).toBe(4);
  });

  test("no overlap is reported, because overlap can no longer be recorded", async () => {
    // The engine still computes worked time as a union rather than a sum —
    // that defence stays, since historical or imported rows may overlap. But
    // the API now refuses to create overlapping activity, so a freshly
    // recorded day should carry no overlap signal at all.
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    expect(me.overlapHours).toBe(0);
  });
});

describe("capacity, utilisation and the missing-data distinction", () => {
  test("a hand-computed week reconciles exactly", async () => {
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);

    // 5 working days x 8h = 40h capacity.
    expect(me.expectedWorkingDays).toBe(5);
    expect(me.capacityHours).toBe(40);

    /* Productive: every recorded hour. Mon 4h + Tue 3h + Wed 1.5h = 8.5h.
     *
     * It was 7.5h, because the UNUTILIZED hour on Tuesday was excluded — that
     * exclusion came from `countsAsProductive`, a flag on `ActivityType`. With
     * no types there is no way to file an hour as "recorded but not work", and
     * nothing for the product to base that judgement on. */
    expect(me.productiveHours).toBe(8.5);

    /* Unutilised counts ONLY days that have records: capacity less what was
       recorded on them. 15.5h now rather than 16.5h — the extra hour moved to
       productive when UNUTILIZED stopped being a type that did not count. */
    expect(me.unutilizedHours).toBe(15.5);

    // Thu + Fri have no records at all -> 16h of MISSING_DATA, never "0 hours worked".
    expect(me.missingDataHours).toBe(16);

    // Every capacity hour is accounted for exactly once.
    expect(me.productiveHours + me.unutilizedHours + me.missingDataHours).toBe(me.capacityHours);

    // 8.5 / 40 = 21.25%
    expect(me.utilizationPct).toBe(21.25);
  });

  test("an hour that was recorded is an hour that was worked", async () => {
    /* This asserted the opposite: "UNUTILIZED time is recorded but is not
       productive", 2h of Tuesday's 3h. That distinction lived on
       `ActivityType.countsAsProductive` — one of sixteen rows declaring whether
       time filed under it counted. There is no list to file under and no field
       to mark an hour as not-work, so an hour somebody recorded counts. */
    const a = await analytics(admin);
    const me = a.instructors.find((i: { instructorId: string }) => i.instructorId === north1Id);
    const tuesday = me.days.find((d: { date: string }) => d.date === TUE);

    expect(tuesday.productiveHours).toBe(3);
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

  /* "opening/closing compliance is measured against expected working days"
     was deleted with the measure. It counted days carrying an entry of type
     DAILY_OPENING or DAILY_CLOSING — two codes out of sixteen — and the question
     cannot be asked without a list of entry kinds to ask it about. */

});

describe("approved leave shrinks capacity without punishing utilisation", () => {
  test("adding leave for Friday raises the percentage rather than lowering it", async () => {
    const before = await analytics(admin);
    const meBefore = before.instructors.find(
      (i: { instructorId: string }) => i.instructorId === north1Id,
    );
    expect(meBefore.capacityHours).toBe(40);
    // 8.5h of 40h. It was 18.75% when the unutilised hour did not count.
    expect(meBefore.utilizationPct).toBe(21.25);

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
    // Productive time is unchanged by the leave…
    expect(meAfter.productiveHours).toBe(8.5);
    // …so the percentage RISES: 8.5 / 32 = 26.56%. Leave must not be a penalty.
    expect(meAfter.utilizationPct).toBe(26.56);
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
