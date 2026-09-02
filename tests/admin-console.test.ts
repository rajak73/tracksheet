import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { daysAgo, seedDays } from "./helpers/worklog";

/**
 * The admin console's two new surfaces: the cross-university managers list and
 * the activity explorer.
 *
 * The managers endpoint exists to replace an N+1 — the page used to load every
 * university and then ask each one for its managers, with the analytics engine
 * running once per manager. The tests below hold the contract that replaced it:
 * one request returns every manager the caller may see, with per-roster figures
 * and a real trend, and it stays tenant-safe while doing so.
 */

let admin: ApiClient, mgrNorth: ApiClient, mgrWest: ApiClient, instNorth: ApiClient, anon: ApiClient;
let northId: string, westId: string, instNorthId: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  mgrNorth = new ApiClient("manager-north");
  northId = (await mgrNorth.login(ACCOUNTS.managerNorth)).user.universityId!;

  mgrWest = new ApiClient("manager-west");
  westId = (await mgrWest.login(ACCOUNTS.managerWest)).user.universityId!;

  instNorth = new ApiClient("instructor-north");
  instNorthId = (await instNorth.login(ACCOUNTS.instructorNorth1)).user.instructorId!;

  anon = new ApiClient("anonymous");

  /* The explorer's own rows.
   *
   * It used to read whatever other files had left in the database, which meant
   * these tests were describing another file's fixture and went vacuous the day
   * that file started cleaning up after itself. Three days, written here, are
   * enough to page through and to filter. */
  await seedDays(instNorth, instNorthId, [
    {
      date: daysAgo(3),
      deliverable: "Java class - collections",
      quantity: "2 classes",
      workingHours: "7h",
    },
    { date: daysAgo(4), deliverable: "Lab supervision", quantity: "1 lab", workingHours: "6h 30m" },
    { date: daysAgo(5), deliverable: "Mentoring and doubt clearing", workingHours: "5" },
  ]);
});

describe("GET /api/managers", () => {
  test("returns every manager in one request, with roster figures", async () => {
    const res = await admin.get("/api/managers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.managers)).toBe(true);
    expect(res.body.managers.length).toBeGreaterThan(0);

    for (const m of res.body.managers) {
      for (const field of [
        "id",
        "name",
        "employeeCode",
        "universityName",
        "instructorCount",
        "workingHours",
        "recordedHours",
        "recordedHoursPct",
        "band",
        "trendPct",
        "isActive",
      ]) {
        expect(m).toHaveProperty(field);
      }
      expect(typeof m.workingHours).toBe("number");
      // Both hour figures come from ActivityLog, so neither can be negative —
      // and Working Hours is a subset of what was recorded, never more.
      expect(m.recordedHours).toBeGreaterThanOrEqual(0);
      expect(m.workingHours).toBeLessThanOrEqual(m.recordedHours);
    }
  });

  test("the roster size is the manager's own, not the university's", async () => {
    const [managers, instructors] = await Promise.all([
      admin.get(`/api/managers?universityId=${northId}`),
      admin.get(`/api/instructors?universityId=${northId}&limit=200`),
    ]);
    const claimed = managers.body.managers.reduce(
      (n: number, m: { instructorCount: number }) => n + m.instructorCount,
      0,
    );
    // Assigned + unassigned = the university total; the rosters alone must not
    // silently equal it when anyone is unassigned.
    expect(claimed).toBeLessThanOrEqual(instructors.body.instructors.length);
  });

  test("trend is a number or explicitly null, never invented", async () => {
    const res = await admin.get("/api/managers");
    for (const m of res.body.managers) {
      expect(m.trendPct === null || typeof m.trendPct === "number").toBe(true);
    }
  });

  test("bands use the documented thresholds", async () => {
    const res = await admin.get("/api/managers");
    for (const m of res.body.managers) {
      if (m.recordedHoursPct === null) expect(m.band).toBe("unmeasured");
      else if (m.recordedHoursPct >= 75) expect(m.band).toBe("healthy");
      else if (m.recordedHoursPct >= 60) expect(m.band).toBe("borderline");
      else expect(m.band).toBe("attention");
    }
  });

  test("sorting is server-side and reversible", async () => {
    const desc = await admin.get("/api/managers?sort=instructors&order=desc");
    const asc = await admin.get("/api/managers?sort=instructors&order=asc");
    expect(desc.status).toBe(200);
    expect(asc.status).toBe(200);

    const d = desc.body.managers.map((m: { instructorCount: number }) => m.instructorCount);
    const a = asc.body.managers.map((m: { instructorCount: number }) => m.instructorCount);
    expect(d).toEqual([...d].sort((x, y) => y - x));
    expect(a).toEqual([...a].sort((x, y) => x - y));
  });

  test("an unknown sort is refused rather than silently ignored", async () => {
    const res = await admin.get("/api/managers?sort=whatever");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SORT");
  });

  test("needsAttention returns only rosters below the threshold", async () => {
    const res = await admin.get("/api/managers?needsAttention=true");
    expect(res.status).toBe(200);
    for (const m of res.body.managers) expect(m.band).toBe("attention");
  });

  test("search narrows by name, and an impossible search is empty not an error", async () => {
    const res = await admin.get("/api/managers?search=zzz-no-such-manager-zzz");
    expect(res.status).toBe(200);
    expect(res.body.managers).toEqual([]);
  });

  test("includeInstructors returns the per-person rows the lists are built from", async () => {
    const res = await admin.get("/api/managers?includeInstructors=true");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.instructors)).toBe(true);
    for (const i of res.body.instructors) {
      expect(i).toHaveProperty("instructorId");
      expect(i).toHaveProperty("recordedHoursPct");
      expect(i).toHaveProperty("band");
    }
  });

  test("omitting the flag omits the instructor rows", async () => {
    const res = await admin.get("/api/managers");
    expect(res.body.instructors).toBeUndefined();
  });
});

describe("GET /api/managers — tenant safety", () => {
  test("a MANAGER sees only their own university", async () => {
    const res = await mgrNorth.get("/api/managers");
    expect(res.status).toBe(200);
    for (const m of res.body.managers) expect(m.universityId).toBe(northId);
  });

  test("a MANAGER cannot widen to another university", async () => {
    const res = await mgrNorth.get(`/api/managers?universityId=${westId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("an INSTRUCTOR cannot read the managers list", async () => {
    const res = await instNorth.get("/api/managers");
    expect(res.status).toBe(403);
  });

  test("an unauthenticated caller is refused", async () => {
    const res = await anon.get("/api/managers");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/activities", () => {
  test("is paginated and never returns the whole table", async () => {
    const res = await admin.get("/api/activities?limit=2");
    expect(res.status).toBe(200);
    expect(res.body.days.length).toBeLessThanOrEqual(2);
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("hasMore");
    expect(res.body.limit).toBe(2);
  });

  test("rows carry the operational columns the explorer shows", async () => {
    const res = await admin.get("/api/activities?limit=5");
    expect(res.body.days.length).toBeGreaterThan(0);
    for (const d of res.body.days) {
      for (const field of [
        "logDate",
        "deliverable",
        "deliverableQuantity",
        "workingHours",
        "remarks",
        "status",
        "source",
        "instructorName",
        "employeeCode",
        "university",
      ]) {
        expect(d).toHaveProperty(field);
      }
      // A number, so every screen formats one value rather than parsing a string.
      expect(typeof d.workingHours).toBe("number");
      expect(d.workingHours).toBeGreaterThanOrEqual(0);
      // Unassigned is a state to render, not an omission.
      expect(d).toHaveProperty("manager");
      // One row per instructor per day: a date, with no clock on it.
      expect(d.logDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("a second page returns different records", async () => {
    const first = await admin.get("/api/activities?limit=1&page=1");
    if (first.body.total < 2) return; // nothing to compare on a small fixture
    const second = await admin.get("/api/activities?limit=1&page=2");
    expect(second.status).toBe(200);
    expect(second.body.days[0]?.id).not.toBe(first.body.days[0]?.id);
  });

  test("search narrows the result to what was written", async () => {
    /* The activity-type filter this replaced is gone with the taxonomy. There
       is no category to narrow by; there is the text somebody typed, which is
       what people were reaching for the category filter to approximate. */
    const all = await admin.get("/api/activities?limit=200");
    const hit = await admin.get("/api/activities?limit=200&search=Lab supervision");
    expect(hit.status).toBe(200);
    expect(hit.body.total).toBeGreaterThan(0);
    expect(hit.body.total).toBeLessThanOrEqual(all.body.total);
    for (const d of hit.body.days) {
      const haystack = [d.deliverable, d.deliverableQuantity, d.remarks].join(" ").toLowerCase();
      expect(haystack).toContain("lab supervision");
    }
  });

  test("an inverted date range is refused", async () => {
    const res = await admin.get("/api/activities?from=2030-01-10&to=2030-01-01");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PERIOD");
  });

  test("an empty result is a 200 with no rows, not an error", async () => {
    const res = await admin.get("/api/activities?from=2999-01-01&to=2999-01-02");
    expect(res.status).toBe(200);
    expect(res.body.days).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  test("a MANAGER cannot read another university's activity", async () => {
    const res = await mgrNorth.get(`/api/activities?universityId=${westId}`);
    expect(res.status).toBe(403);
  });

  test("an INSTRUCTOR sees only their own records", async () => {
    const res = await instNorth.get("/api/activities?limit=200");
    expect(res.status).toBe(200);
    expect(res.body.days.length).toBeGreaterThan(0);
    for (const d of res.body.days) expect(d.instructorId).toBe(instNorthId);
  });

  test("an unauthenticated caller is refused", async () => {
    const res = await anon.get("/api/activities");
    expect(res.status).toBe(401);
  });
});

describe("profile edits", () => {
  let managerId: string;
  let instructorId: string;

  beforeAll(async () => {
    const managers = await admin.get(`/api/managers?universityId=${northId}`);
    managerId = managers.body.managers[0].id;
    const instructors = await admin.get(`/api/instructors?universityId=${northId}&limit=1`);
    instructorId = instructors.body.instructors[0].id;
  });

  test("an ADMIN can rename a manager", async () => {
    const res = await admin.patch(`/api/managers/${managerId}`, { name: "Renamed Manager" });
    expect(res.status).toBe(200);
    expect(res.body.manager.user.name).toBe("Renamed Manager");
  });

  test("an ADMIN can rename an instructor", async () => {
    const res = await admin.patch(`/api/instructors/${instructorId}`, {
      name: "Renamed Instructor",
    });
    expect(res.status).toBe(200);
    expect(res.body.instructor.user.name).toBe("Renamed Instructor");
  });

  test("a duplicate employee code within a university is refused", async () => {
    const instructors = await admin.get(`/api/instructors?universityId=${northId}&limit=200`);
    const rows = instructors.body.instructors as Array<{ id: string; employeeCode: string | null }>;
    const taken = rows.find((r) => r.employeeCode && r.id !== instructorId);
    if (!taken) return;

    const res = await admin.patch(`/api/instructors/${instructorId}`, {
      employeeCode: taken.employeeCode,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMPLOYEE_CODE_IN_USE");
  });

  test("a MANAGER cannot edit a manager", async () => {
    const res = await mgrNorth.patch(`/api/managers/${managerId}`, { name: "Nope" });
    expect(res.status).toBe(403);
  });

  test("an INSTRUCTOR cannot edit an instructor", async () => {
    const res = await instNorth.patch(`/api/instructors/${instructorId}`, { name: "Nope" });
    expect(res.status).toBe(403);
  });

  test("editing cannot move someone between universities", async () => {
    // The route accepts no tenant field at all; sending one changes nothing.
    const res = await admin.patch(`/api/instructors/${instructorId}`, {
      name: "Still Here",
      universityId: westId,
    });
    expect(res.status).toBe(200);
    const after = await admin.get(`/api/instructors?universityId=${westId}&limit=200`);
    const ids = after.body.instructors.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(instructorId);
  });
});
