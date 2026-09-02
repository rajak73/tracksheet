import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Regression gate for HIGH-severity findings from an independent Phase-DoD
 * audit (124 agents, adversarially challenged). Each block below reproduces
 * exactly the scenario the audit's evidence described, on dates no other test
 * file touches — the shared test database is seeded once for the whole run,
 * so isolation here comes from using a week nothing else claims, not from a
 * fresh database.
 *
 * Northfield: Mon-Fri 09:00-18:00 Asia/Kolkata, 60 min break -> 8h/working day.
 */

// 2031 is not referenced by any other test file, and Northfield's second
// instructor is far less contended than the first — both matter because the
// test database is seeded once for the whole run and shared across every
// file, so isolation has to come from the data, not a fresh database.
const MON = "2031-06-02"; // working day (Monday)
const SAT = "2031-06-07"; // non-working day, same week
const WEEK_FROM = "2031-06-02";
const WEEK_TO = "2031-06-07";

let admin: ApiClient;
let north2: ApiClient;
let northId: string;
let north2Id: string;

function istToUtc(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const utcMinutes = h * 60 + m - (5 * 60 + 30);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + utcMinutes * 60_000).toISOString();
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  north2 = new ApiClient("north2");
  await admin.login(ACCOUNTS.admin);
  const me = await north2.login(ACCOUNTS.instructorNorth2);
  north2Id = me.user.instructorId!;
  northId = me.user.universityId!;
});

describe("MISSED and EXCUSED activity is not counted as productive time", () => {
  // Monday: one COMPLETED block (counts), one MISSED block (must not count),
  // one LATE block (counts — it happened, just late), one EXCUSED block (must
  // not count). All four are disjoint so there is no union/overlap to reason
  // about — this isolates the status filter specifically.
  beforeAll(async () => {
    await north2.post(`/api/instructors/${north2Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: istToUtc(MON, "09:00"),
      endTime: istToUtc(MON, "10:00"),
      status: "COMPLETED",
    });
    await north2.post(`/api/instructors/${north2Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: istToUtc(MON, "10:00"),
      endTime: istToUtc(MON, "11:00"),
      status: "MISSED",
    });
    await north2.post(`/api/instructors/${north2Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: istToUtc(MON, "11:00"),
      endTime: istToUtc(MON, "12:00"),
      status: "LATE",
    });
    await north2.post(`/api/instructors/${north2Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: istToUtc(MON, "12:00"),
      endTime: istToUtc(MON, "13:00"),
      status: "EXCUSED",
    });
  });

  test("productive hours count only COMPLETED and LATE — 2h, not 4h", async () => {
    const res = await admin.get(`/api/universities/${northId}/analytics?from=${MON}&to=${MON}`);
    expect(res.status).toBe(200);
    const mine = res.body.analytics.instructors.find(
      (i: { instructorId: string }) => i.instructorId === north2Id,
    );
    expect(mine.productiveHours).toBe(2);
    // Capacity is untouched by status — only the numerator moves.
    expect(mine.capacityHours).toBe(8);
    expect(mine.unutilizedHours).toBe(6);
  });

  test("the exceptions detector still flags the MISSED row as UNEXPECTED_ABSENCE", async () => {
    // This is the other half of the contradiction the audit found: the two
    // subsystems must not just individually make sense, they must agree with
    // each other about the same row. A flagged absence must not also be
    // counted as work in the utilisation figure asserted above.
    const res = await admin.get(
      `/api/universities/${northId}/exceptions?from=${MON}&to=${MON}&types=UNEXPECTED_ABSENCE`,
    );
    expect(res.status).toBe(200);
    const flags = res.body.exceptions.exceptions as Array<{
      type: string;
      instructorName: string;
    }>;
    expect(flags.some((f) => f.type === "UNEXPECTED_ABSENCE")).toBe(true);
  });
});

describe("work logged on a non-working day still counts toward the period total", () => {
  // Saturday is not a working day at Northfield, so it contributes 0 capacity —
  // but if someone actually logged 2h of teaching on it, that is 2h of real
  // work, and the live engine's period total must not silently drop it while
  // the per-day breakdown (and the rollup, which sums that same per-day
  // figure) both still show it. Disagreeing on this was the exact bug.
  beforeAll(async () => {
    await north2.post(`/api/instructors/${north2Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: istToUtc(SAT, "10:00"),
      endTime: istToUtc(SAT, "12:00"),
      status: "COMPLETED",
    });
  });

  test("the per-day breakdown shows the 2h on Saturday", async () => {
    const res = await admin.get(`/api/universities/${northId}/analytics?from=${SAT}&to=${SAT}`);
    const mine = res.body.analytics.instructors.find(
      (i: { instructorId: string }) => i.instructorId === north2Id,
    );
    const saturday = mine.days.find((d: { date: string }) => d.date === SAT);
    expect(saturday.isWorkingDay).toBe(false);
    expect(saturday.productiveHours).toBe(2);
  });

  test("the week total includes Saturday's 2h, not just the working days'", async () => {
    const res = await admin.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const mine = res.body.analytics.instructors.find(
      (i: { instructorId: string }) => i.instructorId === north2Id,
    );
    // Monday contributed 2h of countable productive time (see the block
    // above); Saturday contributes another 2h that a working-day-only total
    // would have dropped.
    expect(mine.productiveHours).toBe(4);
  });

  test("the rollup agrees with the live engine on the same period", async () => {
    // This is the actual regression: before the fix, the rollup (which sums
    // each day's own productiveHours unconditionally) and the live engine
    // (which used to skip non-working days when accumulating its total)
    // disagreed on this exact period.
    const rollup = await admin.post(
      `/api/admin/rollup?from=${WEEK_FROM}&to=${WEEK_TO}`,
      {},
    );
    expect(rollup.status).toBe(200);

    const overview = await admin.get(
      `/api/admin/overview?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );
    const analytics = await admin.get(
      `/api/universities/${northId}/analytics?from=${WEEK_FROM}&to=${WEEK_TO}`,
    );

    const north = overview.body.universities.find(
      (u: { universityId: string }) => u.universityId === northId,
    );
    expect(north.productiveHours).toBe(analytics.body.analytics.totals.productiveHours);
  });
});

describe("Deliverable.category is accepted and persisted", () => {
  test("a category posted at creation is readable back", async () => {
    const created = await admin.post(`/api/instructors/${north2Id}/deliverables`, {
      title: "Audit-fix regression deliverable",
      category: "Research",
      targetQuantity: 1,
      targetHours: 1,
      dueDate: "2027-03-01",
    });
    expect(created.status).toBe(201);
    expect(created.body.deliverable.category).toBe("Research");

    const list = await admin.get(`/api/instructors/${north2Id}/deliverables`);
    const mine = list.body.deliverables.find(
      (d: { id: string }) => d.id === created.body.deliverable.id,
    );
    expect(mine.category).toBe("Research");
  });
});

describe("breakDurationMin is part of the readable and patchable config", () => {
  test("GET returns it and PATCH can change it", async () => {
    const before = await admin.get(`/api/universities/${northId}/config`);
    expect(before.status).toBe(200);
    expect(typeof before.body.config.breakDurationMin).toBe("number");

    const original = before.body.config.breakDurationMin;
    const patch = await admin.patch(`/api/universities/${northId}/config`, {
      breakDurationMin: original + 5,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.config.breakDurationMin).toBe(original + 5);

    // Restore it — this university's break duration is asserted on by
    // unrelated capacity tests elsewhere in the suite.
    await admin.patch(`/api/universities/${northId}/config`, {
      breakDurationMin: original,
    });
  });
});

describe("malformed JSON is a 400, not a 500", () => {
  async function postRaw(path: string, method: string, rawBody: string) {
    return admin.request(path, { method, body: rawBody });
  }

  test("PATCH /api/notifications", async () => {
    const res = await postRaw("/api/notifications", "PATCH", "{not json");
    expect(res.status).toBe(400);
  });

  test("PATCH /api/insights/[id]", async () => {
    // Called as admin so the request clears the role gate added earlier in
    // this file and actually reaches the body-parsing code this guards —
    // otherwise a 403 from the gate would pass this test for the wrong reason.
    const res = await postRaw("/api/insights/does-not-exist", "PATCH", "{not json");
    expect(res.status).toBe(400);
  });
});

describe("a once-per-day race never surfaces as a 500", () => {
  test("two concurrent opening logs for the same day resolve to 201 and 409, never 500", async () => {
    const day = "2031-06-03"; // Tuesday, untouched by any other test in this file
    const start = istToUtc(day, "09:00");
    const end = istToUtc(day, "09:15");

    const [a, b] = await Promise.all([
      north2.post(`/api/instructors/${north2Id}/activities`, {
        activityTypeCode: "DAILY_OPENING",
        startTime: start,
        endTime: end,
      }),
      north2.post(`/api/instructors/${north2Id}/activities`, {
        activityTypeCode: "DAILY_OPENING",
        startTime: start,
        endTime: end,
      }),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    // Exactly one wins; the loser is a conflict, whether the app's own
    // pre-check caught it or the database's unique index did (previously a
    // 500 INTERNAL_ERROR when the index fired first).
    expect(statuses).toEqual([201, 409]);
  });
});

describe("an admin-performed action on one university is readable through its audit trail", () => {
  test("UNIVERSITY_CONFIG_UPDATED is attributed to the university, not written as null", async () => {
    const before = await admin.get(`/api/universities/${northId}/config`);
    expect(before.status).toBe(200);

    const patch = await admin.patch(`/api/universities/${northId}/config`, {
      closingDurationMin: before.body.config.closingDurationMin,
    });
    expect(patch.status).toBe(200);

    const entries = await admin.get(
      `/api/universities/${northId}/audit?action=UNIVERSITY_CONFIG_UPDATED`,
    );
    expect(entries.status).toBe(200);
    expect(entries.body.entries.length).toBeGreaterThan(0);
  });
});
