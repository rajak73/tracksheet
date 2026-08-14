import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Regression gate for the activity-integrity audit.
 *
 * Three defects were found by executing the flows rather than reading them:
 *
 *  1. Overlapping activities were accepted. An instructor could record
 *     10:00-11:00 and then 10:30-11:30 on the same day — a person in two
 *     places at once, which then had to be papered over by union-of-intervals
 *     maths downstream.
 *  2. The check-and-insert was not atomic, so two concurrent requests (a
 *     double-clicked Save, two tabs) both passed the check and both inserted.
 *  3. Rollup-backed admin figures were served silently even when the cache did
 *     not cover the requested window, so admin and manager quoted different
 *     numbers for the same university and period.
 *
 * Dates below are in 2032 and touched by no other test file — the suite shares
 * one seeded database, so isolation comes from picking an unused window.
 */

const DAY = "2032-02-02"; // Monday
const TUE = "2032-02-03";
const WED = "2032-02-04";

let admin: ApiClient;
let north1: ApiClient;
let n1Id: string;

/** Northfield is Asia/Kolkata (UTC+5:30). */
function istToUtc(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (h * 60 + m - 330) * 60_000).toISOString();
}

function activity(day: string, start: string, end: string, code = "TEACHING") {
  return {
    activityTypeCode: code,
    startTime: istToUtc(day, start),
    endTime: istToUtc(day, end),
  };
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  north1 = new ApiClient("north1");
  await admin.login(ACCOUNTS.admin);
  const me = await north1.login(ACCOUNTS.instructorNorth1);
  n1Id = me.user.instructorId!;
});

describe("an instructor cannot be in two places at once", () => {
  beforeAll(async () => {
    const res = await north1.post(`/api/instructors/${n1Id}/activities`, activity(DAY, "10:00", "11:00"));
    expect(res.status).toBe(201);
  });

  test("an identical interval is rejected", async () => {
    const res = await north1.post(`/api/instructors/${n1Id}/activities`, activity(DAY, "10:00", "11:00"));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACTIVITY_OVERLAP");
  });

  test("an interval overlapping the end is rejected", async () => {
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(DAY, "10:30", "11:30"))).status,
    ).toBe(409);
  });

  test("an interval overlapping the start is rejected", async () => {
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(DAY, "09:30", "10:30"))).status,
    ).toBe(409);
  });

  test("an interval fully contained inside another is rejected", async () => {
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(DAY, "10:15", "10:45"))).status,
    ).toBe(409);
  });

  test("an interval fully containing another is rejected", async () => {
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(DAY, "09:00", "12:00"))).status,
    ).toBe(409);
  });

  test("back-to-back activities are allowed — touching is not overlapping", async () => {
    // The boundary case is the one that must NOT be rejected: a class ending
    // at 11:00 and the next starting at 11:00 is normal, and an off-by-one
    // in the comparison would make the product unusable.
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(DAY, "11:00", "12:00"))).status,
    ).toBe(201);
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(DAY, "09:00", "10:00"))).status,
    ).toBe(201);
  });

  test("the same interval on a DIFFERENT day is allowed", async () => {
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(TUE, "10:00", "11:00"))).status,
    ).toBe(201);
  });

  test("a zero-length interval is rejected", async () => {
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(WED, "14:00", "14:00"))).status,
    ).toBe(400);
  });

  test("an interval ending before it starts is rejected", async () => {
    expect(
      (await north1.post(`/api/instructors/${n1Id}/activities`, activity(WED, "15:00", "14:00"))).status,
    ).toBe(400);
  });
});

describe("concurrent submission cannot create two conflicting records", () => {
  test("two simultaneous identical creates produce exactly one activity", async () => {
    // The original defect: read-then-write with no transaction meant both
    // requests saw "no conflict" and both inserted. Only serialising the
    // check-and-insert fixes it, so this must be tested concurrently rather
    // than sequentially.
    const day = "2032-03-01";
    const [a, b] = await Promise.all([
      north1.post(`/api/instructors/${n1Id}/activities`, activity(day, "09:00", "10:00")),
      north1.post(`/api/instructors/${n1Id}/activities`, activity(day, "09:00", "10:00")),
    ]);

    const created = [a.status, b.status].filter((s) => s === 201);
    const rejected = [a.status, b.status].filter((s) => s === 409);
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  test("two simultaneous overlapping (not identical) creates produce exactly one", async () => {
    const day = "2032-03-02";
    const [a, b] = await Promise.all([
      north1.post(`/api/instructors/${n1Id}/activities`, activity(day, "09:00", "11:00")),
      north1.post(`/api/instructors/${n1Id}/activities`, activity(day, "10:00", "12:00")),
    ]);
    expect([a.status, b.status].filter((s) => s === 201)).toHaveLength(1);
  });
});

describe("admin figures never silently disagree with the analytics engine", () => {
  test("the overview reports whether its rollup covers the requested window", async () => {
    // The defect was silence: the endpoint aggregated over whatever days
    // happened to be cached and presented the result as complete. It must now
    // say when it is not.
    const res = await admin.get("/api/admin/overview?from=2032-02-02&to=2032-02-06");
    expect(res.status).toBe(200);
    expect(res.body.overview).toHaveProperty("rollupComplete");
    for (const university of res.body.universities) {
      expect(university.coverage).toMatchObject({
        expectedDays: 5,
        complete: expect.any(Boolean),
      });
    }
  });

  test("a window that was never rolled up is reported incomplete", async () => {
    // 2036 has never been summarised. Universities that actually have
    // instructors must be flagged; the check is only meaningful if it can
    // still say "no".
    const res = await admin.get("/api/admin/overview?from=2036-06-02&to=2036-06-06");
    expect(res.body.overview.rollupComplete).toBe(false);
    const withInstructors = res.body.universities.filter(
      (u: { instructors: number; coverage: { complete: boolean } }) => u.coverage.complete === false,
    );
    expect(withInstructors.length).toBeGreaterThan(0);
  });

  test("a university with no instructors is not flagged as stale forever", async () => {
    // Regression for a false positive introduced by the coverage check
    // itself: the rollup iterates instructor-days, so an empty tenant
    // produces no rows and would otherwise report "incomplete" permanently,
    // showing a warning that could never be cleared.
    //
    // The tenant is created here rather than assumed, because the response's
    // `instructors` field is read from the metric rows — in an un-rolled
    // window every university reports 0, so filtering on it would also catch
    // universities that genuinely DO have instructors and are correctly
    // flagged stale.
    const created = await admin.post("/api/universities", {
      name: "Coverage Probe University",
      code: "COVPROBE",
      slug: "coverage-probe",
      timezone: "UTC",
      workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
        startMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 540 : 0,
        endMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 1020 : 1,
      })),
    });
    expect(created.status).toBe(201);
    const probeId = created.body.university.id as string;

    const res = await admin.get("/api/admin/overview?from=2032-02-02&to=2032-02-06");
    const probe = res.body.universities.find(
      (u: { universityId: string }) => u.universityId === probeId,
    );
    expect(probe, "probe university missing from overview").toBeDefined();
    // It has no instructors, so there is nothing to summarise — complete.
    expect(probe.coverage.complete).toBe(true);
  });

  test("after a rollup for the window, admin totals match the engine exactly", async () => {
    const from = "2032-02-02";
    const to = "2032-02-06";
    expect((await admin.post(`/api/admin/rollup?from=${from}&to=${to}`, {})).status).toBe(200);

    const overview = await admin.get(`/api/admin/overview?from=${from}&to=${to}`);
    expect(overview.body.overview.rollupComplete).toBe(true);

    const me = await north1.get("/api/auth/me");
    const universityId = me.body.user.universityId as string;
    const analytics = await admin.get(
      `/api/universities/${universityId}/analytics?from=${from}&to=${to}`,
    );

    const row = overview.body.universities.find(
      (u: { universityId: string }) => u.universityId === universityId,
    );
    const engine = analytics.body.analytics.totals;

    expect(row.capacityHours).toBe(engine.capacityHours);
    expect(row.productiveHours).toBe(engine.productiveHours);
    expect(row.unutilizedHours).toBe(engine.unutilizedHours);
    expect(row.missingDataHours).toBe(engine.missingDataHours);
    expect(row.utilizationPct).toBe(engine.utilizationPct);
  });
});

describe("wall-clock entry resolves in the UNIVERSITY timezone, not the browser's", () => {
  // Browser UI regression found instants being built client-side with
  // `new Date("...T10:00")` — the BROWSER's zone — so an instructor in a
  // Kolkata browser posting to a New-York university stored the previous
  // calendar day. The API now accepts the wall-clock fields as typed
  // (`local: {date, start, end}`) and resolves them server-side against the
  // university's IANA zone. Northfield is Asia/Kolkata (UTC+5:30).
  const DAY = "2049-02-01"; // untouched by any other test

  test("local 10:00–11:00 stores 04:30Z–05:30Z and the typed workDate", async () => {
    const res = await north1.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: "TEACHING",
      local: { date: DAY, start: "10:00", end: "11:00" },
    });
    expect(res.status).toBe(201);
    expect(res.body.activity.startTime).toBe("2049-02-01T04:30:00.000Z");
    expect(res.body.activity.endTime).toBe("2049-02-01T05:30:00.000Z");
    // The typed date IS the stored university-local work date.
    expect(res.body.activity.workDate.slice(0, 10)).toBe(DAY);
  });

  test("overlap detection spans both entry forms", async () => {
    // Absolute-instant entry overlapping the local-entry activity above:
    // 10:30–11:30 IST = 05:00Z–06:00Z.
    const res = await north1.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2049-02-01T05:00:00.000Z",
      endTime: "2049-02-01T06:00:00.000Z",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACTIVITY_OVERLAP");
  });

  test("neither entry form present is a 400, not a crash", async () => {
    const res = await north1.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: "TEACHING",
    });
    expect(res.status).toBe(400);
  });

  test("malformed local fields are 400", async () => {
    const res = await north1.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: "TEACHING",
      local: { date: DAY, start: "25:99", end: "11:00" },
    });
    expect(res.status).toBe(400);
  });

  test("the activities list now carries the display timezone", async () => {
    const res = await north1.get(`/api/instructors/${n1Id}/activities?from=${DAY}&to=${DAY}`);
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe("Asia/Kolkata");
  });
});
