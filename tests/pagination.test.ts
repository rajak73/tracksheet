import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Server-side pagination across the six list endpoints big enough to need it.
 *
 * The shape added everywhere is deliberately additive: the existing top-level
 * array key (`universities`, `instructors`, `activities`, `deliverables`,
 * `entries`, `report.rows`) is untouched, with `page`, `limit`, `total` and
 * `hasMore` added as siblings — every existing frontend/test call site reads
 * that array directly, so restructuring it into `{data: [...]}` would have
 * broken all of them for no benefit.
 *
 * Isolation: a "ZPAGE" name/employeeCode prefix scopes counts to rows this
 * file created, independent of whatever else the shared seeded database
 * contains, and every date used (2033-xx) is untouched by other test files.
 */

let admin: ApiClient;
let managerNorth: ApiClient;
let managerWest: ApiClient;
let north1: ApiClient;

beforeAll(async () => {
  admin = new ApiClient("admin");
  managerNorth = new ApiClient("managerNorth");
  managerWest = new ApiClient("managerWest");
  north1 = new ApiClient("north1");
  await admin.login(ACCOUNTS.admin);
  await managerNorth.login(ACCOUNTS.managerNorth);
  await managerWest.login(ACCOUNTS.managerWest);
  await north1.login(ACCOUNTS.instructorNorth1);
});

describe("GET /api/universities pagination", () => {
  const NAMES = ["ZPAGE Alpha", "ZPAGE Bravo", "ZPAGE Charlie", "ZPAGE Delta", "ZPAGE Echo"];

  beforeAll(async () => {
    for (const name of NAMES) {
      const res = await admin.post("/api/universities", {
        name,
        code: `ZPAGE-${name.split(" ")[1].toUpperCase()}`,
        slug: `zpage-${name.split(" ")[1].toLowerCase()}`,
        timezone: "UTC",
        workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
          startMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 540 : 0,
          endMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 1020 : 1,
        })),
      });
      expect(res.status).toBe(201);
    }
  });

  test("first page returns limit rows and reports total + hasMore", async () => {
    const res = await admin.get("/api/universities?search=ZPAGE&limit=2&page=1&sort=name&order=asc");
    expect(res.status).toBe(200);
    expect(res.body.universities).toHaveLength(2);
    expect(res.body.universities.map((u: { name: string }) => u.name)).toEqual([
      "ZPAGE Alpha",
      "ZPAGE Bravo",
    ]);
    expect(res.body.total).toBe(5);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
    expect(res.body.hasMore).toBe(true);
  });

  test("middle page continues where the first left off", async () => {
    const res = await admin.get("/api/universities?search=ZPAGE&limit=2&page=2&sort=name&order=asc");
    expect(res.body.universities.map((u: { name: string }) => u.name)).toEqual([
      "ZPAGE Charlie",
      "ZPAGE Delta",
    ]);
    expect(res.body.hasMore).toBe(true);
  });

  test("last page has the remainder and hasMore is false", async () => {
    const res = await admin.get("/api/universities?search=ZPAGE&limit=2&page=3&sort=name&order=asc");
    expect(res.body.universities.map((u: { name: string }) => u.name)).toEqual(["ZPAGE Echo"]);
    expect(res.body.total).toBe(5);
    expect(res.body.hasMore).toBe(false);
  });

  test("a page past the end returns zero rows, not an error", async () => {
    const res = await admin.get("/api/universities?search=ZPAGE&limit=2&page=10");
    expect(res.status).toBe(200);
    expect(res.body.universities).toHaveLength(0);
    expect(res.body.hasMore).toBe(false);
  });

  test("search narrows the result set (search+pagination)", async () => {
    const res = await admin.get("/api/universities?search=ZPAGE Charlie&limit=10&page=1");
    expect(res.body.total).toBe(1);
    expect(res.body.universities[0].name).toBe("ZPAGE Charlie");
  });

  test("a search with no matches is an empty page, not a 404", async () => {
    const res = await admin.get("/api/universities?search=ZPAGE-DOES-NOT-EXIST-XYZ&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.universities).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  test("sort+pagination: descending name order reverses the page", async () => {
    const res = await admin.get("/api/universities?search=ZPAGE&limit=2&page=1&sort=name&order=desc");
    expect(res.body.universities.map((u: { name: string }) => u.name)).toEqual([
      "ZPAGE Echo",
      "ZPAGE Delta",
    ]);
  });

  test("an invalid sort field is rejected", async () => {
    const res = await admin.get("/api/universities?sort=notAField");
    expect(res.status).toBe(400);
  });

  test("max page size: a huge limit is clamped, not honoured verbatim", async () => {
    const res = await admin.get("/api/universities?limit=999999");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(200);
  });

  test("invalid limit is a 400", async () => {
    expect((await admin.get("/api/universities?limit=abc")).status).toBe(400);
    expect((await admin.get("/api/universities?limit=-1")).status).toBe(400);
    expect((await admin.get("/api/universities?limit=0")).status).toBe(400);
  });

  test("invalid page is a 400", async () => {
    expect((await admin.get("/api/universities?page=abc")).status).toBe(400);
    expect((await admin.get("/api/universities?page=0")).status).toBe(400);
    expect((await admin.get("/api/universities?page=-3")).status).toBe(400);
  });

  test("unauthorized pagination: no session is a 401, regardless of page/limit", async () => {
    const anon = new ApiClient("anon-universities");
    const res = await anon.get("/api/universities?search=ZPAGE&limit=2&page=1");
    expect(res.status).toBe(401);
  });

  test("cross-tenant pagination: a scoped caller cannot page into other tenants", async () => {
    // Northfield's manager is narrowed to exactly their own university
    // regardless of the page/limit requested — pagination cannot widen scope.
    const res = await managerNorth.get("/api/universities?search=ZPAGE&limit=50&page=1");
    expect(res.body.total).toBe(0);
    expect(res.body.universities).toHaveLength(0);
  });
});

describe("GET /api/instructors pagination", () => {
  let universityId: string;
  const CODES = ["ZPAGE-I1", "ZPAGE-I2", "ZPAGE-I3"];

  beforeAll(async () => {
    const created = await admin.post("/api/universities", {
      name: "ZPAGE Instructor University",
      code: "ZPAGEIU",
      slug: "zpage-instructor-university",
      timezone: "UTC",
      workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
        startMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 540 : 0,
        endMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 1020 : 1,
      })),
    });
    universityId = created.body.university.id;

    for (const code of CODES) {
      const res = await admin.post("/api/instructors", {
        email: `${code.toLowerCase()}@fixture.test`,
        name: `Pagination Test ${code}`,
        password: "Password123!",
        employeeCode: code,
        universityId,
      });
      expect(res.status).toBe(201);
    }
  });

  test("first/middle/last pages partition a known instructor set", async () => {
    const first = await admin.get(`/api/instructors?universityId=${universityId}&limit=1&page=1`);
    const second = await admin.get(`/api/instructors?universityId=${universityId}&limit=1&page=2`);
    const third = await admin.get(`/api/instructors?universityId=${universityId}&limit=1&page=3`);

    expect(first.body.total).toBe(3);
    expect([first, second, third].map((r) => r.body.instructors[0].employeeCode)).toEqual(CODES);
    expect(first.body.hasMore).toBe(true);
    expect(second.body.hasMore).toBe(true);
    expect(third.body.hasMore).toBe(false);
  });

  test("search+pagination narrows by name/email/employeeCode", async () => {
    const res = await admin.get(`/api/instructors?universityId=${universityId}&search=ZPAGE-I2`);
    expect(res.body.total).toBe(1);
    expect(res.body.instructors[0].employeeCode).toBe("ZPAGE-I2");
  });

  test("empty page: a search matching nothing returns zero rows", async () => {
    const res = await admin.get(`/api/instructors?universityId=${universityId}&search=NO-SUCH-CODE`);
    expect(res.body.total).toBe(0);
    expect(res.body.instructors).toHaveLength(0);
  });

  test("cross-tenant pagination: a manager cannot page into another university's roster", async () => {
    // managerWest belongs to a different tenant than the ZPAGE university.
    const res = await managerWest.get(`/api/instructors?universityId=${universityId}&limit=50`);
    expect(res.status).toBe(403);
  });

  test("unauthorized pagination: no session is a 401", async () => {
    const anon = new ApiClient("anon-instructors");
    const res = await anon.get(`/api/instructors?universityId=${universityId}&page=1`);
    expect(res.status).toBe(401);
  });

  test("invalid limit/page are 400s", async () => {
    expect((await admin.get(`/api/instructors?limit=0`)).status).toBe(400);
    expect((await admin.get(`/api/instructors?page=-1`)).status).toBe(400);
  });
});


describe("GET /api/instructors/[id]/deliverables pagination", () => {
  let instructorId: string;
  const TITLES = ["ZPAGE Deliverable A", "ZPAGE Deliverable B", "ZPAGE Deliverable C"];

  beforeAll(async () => {
    // A dedicated instructor, not the shared seeded one: other test files
    // also assign deliverables to north1's instructor, and since deliverables
    // are ordered by dueDate ASC, sharing it would interleave unrelated rows
    // between these three and break the page-boundary assertions below.
    const university = await admin.post("/api/universities", {
      name: "ZPAGE Deliverable University",
      code: "ZPAGEDU",
      slug: "zpage-deliverable-university",
      timezone: "UTC",
      workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
        startMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 540 : 0,
        endMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 1020 : 1,
      })),
    });
    const universityId = university.body.university.id;

    const instructor = await admin.post("/api/instructors", {
      email: "zpage-deliverable-instructor@fixture.test",
      name: "ZPAGE Deliverable Instructor",
      password: "Password123!",
      universityId,
    });
    instructorId = instructor.body.instructor.id;

    for (const title of TITLES) {
      const res = await admin.post(`/api/instructors/${instructorId}/deliverables`, {
        title,
        targetQuantity: 1,
        targetHours: 1,
        dueDate: "2033-06-01",
      });
      expect(res.status).toBe(201);
    }
  });

  test("first/middle/last pages partition a known deliverable set", async () => {
    const first = await admin.get(`/api/instructors/${instructorId}/deliverables?limit=1&page=1`);
    const second = await admin.get(`/api/instructors/${instructorId}/deliverables?limit=1&page=2`);
    const third = await admin.get(`/api/instructors/${instructorId}/deliverables?limit=1&page=3`);

    expect(first.body.total).toBe(3);
    const titles = [first, second, third].map((r) => r.body.deliverables[0].title);
    expect(titles).toEqual(TITLES);
    expect(third.body.hasMore).toBe(false);
  });

  test("empty page past the end", async () => {
    const res = await admin.get(`/api/instructors/${instructorId}/deliverables?limit=1&page=999`);
    expect(res.status).toBe(200);
    expect(res.body.deliverables).toHaveLength(0);
  });
});

describe("GET /api/universities/[id]/audit pagination", () => {
  let universityId: string;

  beforeAll(async () => {
    const created = await admin.post("/api/universities", {
      name: "ZPAGE Audit University",
      code: "ZPAGEAU",
      slug: "zpage-audit-university",
      timezone: "UTC",
      workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
        startMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 540 : 0,
        endMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 1020 : 1,
      })),
    });
    universityId = created.body.university.id;

    // Three UNIVERSITY_CREATED-adjacent audit events: the creation above, plus
    // two instructor creations, all filterable by action.
    for (const suffix of ["1", "2"]) {
      const res = await admin.post("/api/instructors", {
        email: `zpage-audit-${suffix}@fixture.test`,
        name: `ZPAGE Audit Instructor ${suffix}`,
        password: "Password123!",
        universityId,
      });
      expect(res.status).toBe(201);
    }
  });

  test("filter+pagination: action filter narrows before paging", async () => {
    const res = await admin.get(
      `/api/universities/${universityId}/audit?action=INSTRUCTOR_CREATED&limit=1&page=1`,
    );
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.total).toBe(2);
    expect(res.body.hasMore).toBe(true);
  });

  test("pages 1 and 2 are disjoint and together cover the full filtered set", async () => {
    const page1 = await admin.get(
      `/api/universities/${universityId}/audit?action=INSTRUCTOR_CREATED&limit=1&page=1`,
    );
    const page2 = await admin.get(
      `/api/universities/${universityId}/audit?action=INSTRUCTOR_CREATED&limit=1&page=2`,
    );
    const ids = [...page1.body.entries, ...page2.body.entries].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(2);
    expect(page2.body.hasMore).toBe(false);
  });

  test("unauthorized pagination: an instructor role cannot read the audit log at all", async () => {
    const res = await north1.get(`/api/universities/${universityId}/audit?limit=1`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/universities/[id]/reports pagination", () => {
  test("rows are paginated but totals reflect the whole university, not the page", async () => {
    const me = await north1.get("/api/auth/me");
    const universityId = me.body.user.universityId;

    const full = await managerNorth.get(
      `/api/universities/${universityId}/reports?from=2026-08-07&to=2026-08-13&limit=50`,
    );
    expect(full.status).toBe(200);
    const fullTotal = full.body.total;
    expect(fullTotal).toBeGreaterThan(0);

    const paged = await managerNorth.get(
      `/api/universities/${universityId}/reports?from=2026-08-07&to=2026-08-13&limit=1&page=1`,
    );
    expect(paged.body.report.rows).toHaveLength(1);
    expect(paged.body.total).toBe(fullTotal);
    // Totals are computed over the WHOLE university regardless of the slice.
    expect(paged.body.report.totals).toEqual(full.body.report.totals);
  });
});
