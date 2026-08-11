import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Phase 2 verification gate.
 *
 * Raw HTTP against the running server, exactly as Phase 1. Nothing here imports
 * `schedule-windows.ts` — the point is to prove the deployed API computes the
 * right windows, not that a function returns what it returns.
 *
 * Fixed dates are used throughout so results never depend on when the suite
 * runs. 2026-08-12 is a Wednesday; 2026-08-16 is a Sunday.
 */

const WEDNESDAY = "2026-08-12";
const NEXT_WEDNESDAY = "2026-08-19";
const SUNDAY = "2026-08-16";
const SATURDAY = "2026-08-15";

let admin: ApiClient;
let managerNorth: ApiClient;
let instructorNorth1: ApiClient;

let northId: string;
let westId: string;

/** Snapshot of Northfield's config, restored after the mutation tests. */
let northOriginal: {
  openingDurationMin: number;
  closingDurationMin: number;
  workingHours: Array<{
    dayOfWeek: number;
    isWorkingDay: boolean;
    startMinute: number;
    endMinute: number;
  }>;
};

const createdHolidayIds: Array<{ universityId: string; holidayId: string }> = [];

beforeAll(async () => {
  admin = new ApiClient("admin");
  managerNorth = new ApiClient("managerNorth");
  instructorNorth1 = new ApiClient("instructorNorth1");

  await admin.login(ACCOUNTS.admin);
  await managerNorth.login(ACCOUNTS.managerNorth);
  await instructorNorth1.login(ACCOUNTS.instructorNorth1);

  const unis = await admin.get("/api/universities");
  northId = unis.body.universities.find((u: { slug: string }) => u.slug === "northfield").id;
  westId = unis.body.universities.find((u: { slug: string }) => u.slug === "westbrook").id;

  const cfg = await admin.get(`/api/universities/${northId}/config`);
  northOriginal = {
    openingDurationMin: cfg.body.config.openingDurationMin,
    closingDurationMin: cfg.body.config.closingDurationMin,
    workingHours: cfg.body.config.workingHours,
  };
});

afterAll(async () => {
  // Leave the seeded state as found, so this file can run in any order.
  if (northOriginal) {
    await admin.request(`/api/universities/${northId}/config`, {
      method: "PATCH",
      body: JSON.stringify(northOriginal),
    });
  }
  for (const { universityId, holidayId } of createdHolidayIds) {
    await admin.request(`/api/universities/${universityId}/holidays/${holidayId}`, {
      method: "DELETE",
    });
  }
});

async function windowsFor(client: ApiClient, universityId: string, date: string) {
  const res = await client.get(`/api/universities/${universityId}/windows?date=${date}`);
  return res;
}

describe("Test 1 — two universities compute different windows for the same date", () => {
  test("Northfield and Westbrook differ per their own configuration", async () => {
    const north = await windowsFor(admin, northId, WEDNESDAY);
    const west = await windowsFor(admin, westId, WEDNESDAY);

    expect(north.status).toBe(200);
    expect(west.status).toBe(200);

    const n = north.body.windows;
    const w = west.body.windows;

    expect(n.isWorkingDay).toBe(true);
    expect(w.isWorkingDay).toBe(true);

    // Northfield: 09:00-18:00 IST, 15 min opening / 15 min closing.
    expect(n.timezone).toBe("Asia/Kolkata");
    expect(n.opening.startLocal).toBe("09:00");
    expect(n.opening.endLocal).toBe("09:15");
    expect(n.opening.durationMinutes).toBe(15);
    expect(n.closing.startLocal).toBe("17:45");
    expect(n.closing.endLocal).toBe("18:00");
    expect(n.closing.durationMinutes).toBe(15);

    // Westbrook: 08:30-16:30 New York, 20 min opening / 10 min closing.
    expect(w.timezone).toBe("America/New_York");
    expect(w.opening.startLocal).toBe("08:30");
    expect(w.opening.endLocal).toBe("08:50");
    expect(w.opening.durationMinutes).toBe(20);
    expect(w.closing.startLocal).toBe("16:20");
    expect(w.closing.endLocal).toBe("16:30");
    expect(w.closing.durationMinutes).toBe(10);

    // Same calendar date, genuinely different instants — proves the timezone is
    // applied per university rather than from one shared global.
    expect(n.opening.startUtc).not.toBe(w.opening.startUtc);
    expect(n.opening.startUtc).toBe("2026-08-12T03:30:00.000Z");
    expect(w.opening.startUtc).toBe("2026-08-12T12:30:00.000Z");
  });

  test("interleaved requests do not contaminate each other", async () => {
    // Round-robin rather than sequential, so any shared mutable state between
    // tenants would surface as a wrong answer.
    const [a, b, c, d] = await Promise.all([
      windowsFor(admin, northId, WEDNESDAY),
      windowsFor(admin, westId, WEDNESDAY),
      windowsFor(admin, northId, WEDNESDAY),
      windowsFor(admin, westId, WEDNESDAY),
    ]);
    expect(a.body.windows.opening.startLocal).toBe("09:00");
    expect(c.body.windows.opening.startLocal).toBe("09:00");
    expect(b.body.windows.opening.startLocal).toBe("08:30");
    expect(d.body.windows.opening.startLocal).toBe("08:30");
  });
});

describe("Test 2 — a configuration change takes effect immediately", () => {
  test("changing the opening duration changes the computed window with no redeploy", async () => {
    const before = await windowsFor(admin, northId, NEXT_WEDNESDAY);
    expect(before.body.windows.opening.endLocal).toBe("09:15");

    const patch = await admin.request(`/api/universities/${northId}/config`, {
      method: "PATCH",
      body: JSON.stringify({ openingDurationMin: 45, closingDurationMin: 30 }),
    });
    expect(patch.status).toBe(200);

    const after = await windowsFor(admin, northId, NEXT_WEDNESDAY);
    expect(after.body.windows.opening.endLocal).toBe("09:45");
    expect(after.body.windows.opening.durationMinutes).toBe(45);
    expect(after.body.windows.closing.startLocal).toBe("17:30");
    expect(after.body.windows.closing.durationMinutes).toBe(30);
  });

  test("changing working hours changes the windows derived from them", async () => {
    const patch = await admin.request(`/api/universities/${northId}/config`, {
      method: "PATCH",
      body: JSON.stringify({
        workingHours: [
          { dayOfWeek: 3, isWorkingDay: true, startMinute: 7 * 60, endMinute: 15 * 60 },
        ],
      }),
    });
    expect(patch.status).toBe(200);

    const after = await windowsFor(admin, northId, NEXT_WEDNESDAY);
    expect(after.body.windows.workingHours.startLocal).toBe("07:00");
    expect(after.body.windows.opening.startLocal).toBe("07:00");
    expect(after.body.windows.closing.endLocal).toBe("15:00");
  });

  test("the other university is unaffected by its neighbour's change", async () => {
    const west = await windowsFor(admin, westId, NEXT_WEDNESDAY);
    expect(west.body.windows.opening.startLocal).toBe("08:30");
    expect(west.body.windows.opening.durationMinutes).toBe(20);
  });

  test("a configuration that would not fit the working day is rejected", async () => {
    const res = await admin.request(`/api/universities/${westId}/config`, {
      method: "PATCH",
      body: JSON.stringify({ openingDurationMin: 400, closingDurationMin: 400 }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DURATION");

    // …and nothing was persisted.
    const cfg = await admin.get(`/api/universities/${westId}/config`);
    expect(cfg.body.config.openingDurationMin).toBe(20);
  });

  test("an unknown timezone is rejected", async () => {
    const res = await admin.request(`/api/universities/${westId}/config`, {
      method: "PATCH",
      body: JSON.stringify({ timezone: "Mars/Olympus_Mons" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TIMEZONE");
  });
});

describe("Test 3 — a holiday overrides an otherwise-working weekday", () => {
  test("the holiday date is non-working; the same weekday a week later is not", async () => {
    const before = await windowsFor(admin, westId, WEDNESDAY);
    expect(before.body.windows.isWorkingDay).toBe(true);

    const created = await admin.post(`/api/universities/${westId}/holidays`, {
      date: WEDNESDAY,
      name: "Founders Day",
    });
    expect(created.status).toBe(201);
    createdHolidayIds.push({ universityId: westId, holidayId: created.body.holiday.id });

    const onHoliday = await windowsFor(admin, westId, WEDNESDAY);
    expect(onHoliday.body.windows.isWorkingDay).toBe(false);
    expect(onHoliday.body.windows.nonWorkingReason).toBe("HOLIDAY");
    expect(onHoliday.body.windows.holiday.name).toBe("Founders Day");
    expect(onHoliday.body.windows.opening).toBeNull();
    expect(onHoliday.body.windows.closing).toBeNull();

    const weekLater = await windowsFor(admin, westId, NEXT_WEDNESDAY);
    expect(weekLater.body.windows.isWorkingDay).toBe(true);
    expect(weekLater.body.windows.nonWorkingReason).toBeNull();
    expect(weekLater.body.windows.opening.startLocal).toBe("08:30");
  });

  test("the holiday belongs to one university only", async () => {
    // Northfield's Wednesday is still a working day despite Westbrook's holiday.
    const north = await windowsFor(admin, northId, WEDNESDAY);
    expect(north.body.windows.isWorkingDay).toBe(true);
  });

  test("the same holiday date cannot be added twice", async () => {
    const dup = await admin.post(`/api/universities/${westId}/holidays`, {
      date: WEDNESDAY,
      name: "Duplicate",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("HOLIDAY_EXISTS");
  });
});

describe("Test 4 — a non-working day of week is reported independently of holidays", () => {
  test("Sunday is non-working for Northfield with reason NOT_A_WORKING_DAY", async () => {
    const res = await windowsFor(admin, northId, SUNDAY);
    expect(res.body.windows.dayOfWeek).toBe(0);
    expect(res.body.windows.isWorkingDay).toBe(false);
    expect(res.body.windows.nonWorkingReason).toBe("NOT_A_WORKING_DAY");
    expect(res.body.windows.holiday).toBeNull();
    expect(res.body.windows.opening).toBeNull();
    expect(res.body.windows.closing).toBeNull();
  });

  test("Saturday differs between the two universities", async () => {
    // Northfield works Mon-Fri; Westbrook works Mon-Sat.
    const north = await windowsFor(admin, northId, SATURDAY);
    const west = await windowsFor(admin, westId, SATURDAY);

    expect(north.body.windows.isWorkingDay).toBe(false);
    expect(north.body.windows.nonWorkingReason).toBe("NOT_A_WORKING_DAY");

    expect(west.body.windows.isWorkingDay).toBe(true);
    expect(west.body.windows.opening.startLocal).toBe("08:30");
  });

  test("a malformed date is rejected", async () => {
    expect((await windowsFor(admin, northId, "12-08-2026")).status).toBe(400);
    expect((await windowsFor(admin, northId, "2026-02-30")).status).toBe(400);
    expect((await admin.get(`/api/universities/${northId}/windows`)).status).toBe(400);
  });
});

describe("Test 5 — windows are structurally singular per working day", () => {
  test("exactly one opening and one closing, as objects rather than lists", async () => {
    const res = await windowsFor(admin, westId, NEXT_WEDNESDAY);
    const w = res.body.windows;

    expect(Array.isArray(w.opening)).toBe(false);
    expect(Array.isArray(w.closing)).toBe(false);
    expect(typeof w.opening).toBe("object");
    expect(typeof w.closing).toBe("object");

    // The payload contains no other window-bearing keys — nothing that could
    // grow into a per-class or per-activity-type collection.
    expect(Object.keys(w).filter((k) => /opening|closing/i.test(k)).sort()).toEqual([
      "closing",
      "opening",
    ]);
  });

  test("repeated calls for the same day are identical", async () => {
    const a = await windowsFor(admin, westId, NEXT_WEDNESDAY);
    const b = await windowsFor(admin, westId, NEXT_WEDNESDAY);
    expect(a.body.windows).toEqual(b.body.windows);
  });

  test("only DAILY_OPENING and DAILY_CLOSING are once-per-day activity types", async () => {
    const res = await admin.get("/api/activity-types");
    expect(res.status).toBe(200);

    const codes = res.body.activityTypes.map((t: { code: string }) => t.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DAILY_OPENING",
        "TEACHING",
        "LEARNING",
        "STUDENT_SUPPORT",
        "ADMINISTRATIVE",
        "MEETING",
        "DELIVERABLE",
        "RESEARCH",
        "OTHER",
        "DAILY_CLOSING",
        "UNUTILIZED",
      ]),
    );

    const oncePerDay = res.body.activityTypes
      .filter((t: { isOncePerDay: boolean }) => t.isOncePerDay)
      .map((t: { code: string }) => t.code)
      .sort();
    expect(oncePerDay).toEqual(["DAILY_CLOSING", "DAILY_OPENING"]);

    // LEARNING must never be conflated with opening/closing.
    const learning = res.body.activityTypes.find((t: { code: string }) => t.code === "LEARNING");
    expect(learning.isOncePerDay).toBe(false);
    expect(learning.isDerivedFromWorkingHours).toBe(false);

    // MISSING_DATA is computed, never stored, so it must not exist as a type.
    expect(codes).not.toContain("MISSING_DATA");

    // UNUTILIZED is a real recordable state, and is not productive time.
    const unutilized = res.body.activityTypes.find(
      (t: { code: string }) => t.code === "UNUTILIZED",
    );
    expect(unutilized.isUnutilized).toBe(true);
    expect(unutilized.countsAsProductive).toBe(false);
  });
});

describe("Test 6 — authorization follows Phase 1's scope model", () => {
  test("a manager can read their own university's config", async () => {
    const res = await managerNorth.get(`/api/universities/${northId}/config`);
    expect(res.status).toBe(200);
    expect(res.body.config.id).toBe(northId);
  });

  test("a manager reading another university's config gets the Phase 1 403", async () => {
    const res = await managerNorth.get(`/api/universities/${westId}/config`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("a manager cannot update any config, including their own", async () => {
    const own = await managerNorth.request(`/api/universities/${northId}/config`, {
      method: "PATCH",
      body: JSON.stringify({ openingDurationMin: 5 }),
    });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe("FORBIDDEN");

    const other = await managerNorth.request(`/api/universities/${westId}/config`, {
      method: "PATCH",
      body: JSON.stringify({ openingDurationMin: 5 }),
    });
    expect(other.status).toBe(403);
  });

  test("a manager cannot add or remove holidays", async () => {
    const res = await managerNorth.post(`/api/universities/${northId}/holidays`, {
      date: "2026-12-25",
      name: "Attempted",
    });
    expect(res.status).toBe(403);
  });

  test("an instructor can read their own university's windows but not another's", async () => {
    const own = await windowsFor(instructorNorth1, northId, NEXT_WEDNESDAY);
    expect(own.status).toBe(200);

    const other = await windowsFor(instructorNorth1, westId, NEXT_WEDNESDAY);
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("unauthenticated callers reach none of the new endpoints", async () => {
    const anon = new ApiClient("anon");
    expect((await anon.get(`/api/universities/${northId}/config`)).status).toBe(401);
    expect((await anon.get(`/api/universities/${northId}/windows?date=${WEDNESDAY}`)).status).toBe(401);
    expect((await anon.get("/api/activity-types")).status).toBe(401);
    expect((await anon.post(`/api/universities/${northId}/holidays`, { date: WEDNESDAY, name: "x" })).status).toBe(401);
  });
});
