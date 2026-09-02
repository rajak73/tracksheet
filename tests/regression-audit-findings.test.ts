import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { seedDays } from "./helpers/worklog";

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
const SAT = "2026-06-06"; // non-working day, same week
/* The week Saturday sits in. Monday is only a bound now — the day itself
   carries nothing since the status tests went. */
const WEEK_FROM = "2026-06-01";
const WEEK_TO = "2026-06-06";

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

/* "MISSED and EXCUSED activity is not counted as productive time" was deleted
   with the model it described.
   
   It filed four hour-long activities on one day with statuses COMPLETED,
   MISSED, LATE and EXCUSED, and held that only two of them counted. That is an
   `ActivityStatus` on `ActivityLog` — a per-entry claim that a scheduled thing
   did not happen. A `WorklogEntry` has no equivalent: an instructor writes the
   hours they worked, and there is no status on that row meaning "these hours
   did not". The second half, that the exceptions detector agreed with the
   engine about the same row, goes with it for the same reason.

   What the file still holds is below, and was never about status. */

describe("work logged on a non-working day still counts toward the period total", () => {
  // Saturday is not a working day at Northfield, so it contributes 0 capacity —
  // but if someone actually logged 2h of teaching on it, that is 2h of real
  // work, and the live engine's period total must not silently drop it while
  // the per-day breakdown (and the rollup, which sums that same per-day
  // figure) both still show it. Disagreeing on this was the exact bug.
  beforeAll(async () => {
    /* Written through the route the instructor uses, so a Saturday day exists
       exactly as they would file it. The two-hour activity this replaced went
       to a table the engine no longer reads. */
    await seedDays(north2, north2Id, [
      { date: SAT, deliverable: "Two hours on a Saturday", workingHours: "2h" },
    ]);
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
    /* Saturday's 2h, and nothing else — the Monday block that used to add
       another 2h went with the MISSED/EXCUSED tests above. The claim is
       unchanged and is the one the bug was about: a period total must not drop
       a day just because the calendar says nobody was expected to work it. */
    expect(mine.productiveHours).toBe(2);
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
