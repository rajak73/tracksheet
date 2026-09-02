import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { RUN } from "./helpers/fixtures";
/**
 * Phase 1 verification gate.
 *
 * Every request below is a raw HTTP call against the running server. No test
 * imports application code, so nothing here can be satisfied by a frontend-only
 * check — which is the whole point of the gate.
 */

let admin: ApiClient;
let managerNorth: ApiClient;
let managerWest: ApiClient;
let instructorNorth1: ApiClient;
let instructorNorth2: ApiClient;

let northUniversityId: string;
let westUniversityId: string;
let north2InstructorId: string;
let west1InstructorId: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  managerNorth = new ApiClient("managerNorth");
  managerWest = new ApiClient("managerWest");
  instructorNorth1 = new ApiClient("instructorNorth1");
  instructorNorth2 = new ApiClient("instructorNorth2");

  const adminLogin = await admin.login(ACCOUNTS.admin);
  expect(adminLogin.user.role).toBe("ADMIN");

  const northLogin = await managerNorth.login(ACCOUNTS.managerNorth);
  await managerWest.login(ACCOUNTS.managerWest);
  await instructorNorth1.login(ACCOUNTS.instructorNorth1);
  const north2Login = await instructorNorth2.login(ACCOUNTS.instructorNorth2);

  northUniversityId = northLogin.user.universityId!;
  north2InstructorId = north2Login.user.instructorId!;

  const unis = await admin.get("/api/universities");
  const west = unis.body.universities.find((u: { slug: string }) => u.slug === "westbrook");
  westUniversityId = west.id;

  const westInstructors = await admin.get(`/api/instructors?universityId=${westUniversityId}`);
  west1InstructorId = westInstructors.body.instructors[0].id;
});

describe("Gate 1 — login returns the correct role and universityId", () => {
  test("admin gets ADMIN with a null universityId", async () => {
    const c = new ApiClient("t");
    const { user } = await c.login(ACCOUNTS.admin);
    expect(user.role).toBe("ADMIN");
    expect(user.universityId).toBeNull();
  });

  test("manager gets MANAGER bound to exactly one university", async () => {
    const c = new ApiClient("t");
    const { user } = await c.login(ACCOUNTS.managerNorth);
    expect(user.role).toBe("MANAGER");
    expect(user.universityId).toBe(northUniversityId);
  });

  test("instructor gets INSTRUCTOR with a university and an instructor profile", async () => {
    const c = new ApiClient("t");
    const { user } = await c.login(ACCOUNTS.instructorNorth1);
    expect(user.role).toBe("INSTRUCTOR");
    expect(user.universityId).toBe(northUniversityId);
    expect(user.instructorId).toBeTruthy();
  });

  test("the client cannot elevate itself by sending role or universityId at login", async () => {
    const c = new ApiClient("t");
    const res = await c.post("/api/auth/login", {
      email: ACCOUNTS.instructorNorth1,
      password: "Password123!",
      role: "ADMIN",
      universityId: westUniversityId,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("INSTRUCTOR");
    expect(res.body.user.universityId).toBe(northUniversityId);
  });

  test("wrong password and unknown email are both rejected", async () => {
    const c = new ApiClient("t");
    const bad = await c.post("/api/auth/login", {
      email: ACCOUNTS.admin,
      password: "wrong",
    });
    expect(bad.status).toBe(401);

    const unknown = await c.post("/api/auth/login", {
      email: `nobody.${RUN}@fixture.test`,
      password: "Password123!",
    });
    expect(unknown.status).toBe(401);
  });

  test("unauthenticated requests are rejected", async () => {
    const c = new ApiClient("anon");
    expect((await c.get("/api/instructors")).status).toBe(401);
    expect((await c.get("/api/universities")).status).toBe(401);
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });
});

describe("Gate 2 — a manager cannot reach another university", () => {
  test("manager list is scoped to their own university by default", async () => {
    const res = await managerNorth.get("/api/instructors");
    expect(res.status).toBe(200);
    expect(res.body.instructors.length).toBeGreaterThan(0);
    for (const i of res.body.instructors) {
      expect(i.universityId).toBe(northUniversityId);
    }
  });

  test("passing another university's id in the QUERY STRING is refused", async () => {
    const res = await managerNorth.get(`/api/instructors?universityId=${westUniversityId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("a manager cannot read a specific instructor from another university", async () => {
    const res = await managerNorth.get(`/api/instructors/${west1InstructorId}`);
    expect(res.status).toBe(404);
  });

  test("the universities list shows a manager only their own", async () => {
    const res = await managerWest.get("/api/universities");
    expect(res.status).toBe(200);
    expect(res.body.universities).toHaveLength(1);
    expect(res.body.universities[0].id).toBe(westUniversityId);
  });

  test("narrowing to one's OWN university is still allowed", async () => {
    const res = await managerNorth.get(`/api/instructors?universityId=${northUniversityId}`);
    expect(res.status).toBe(200);
    expect(res.body.instructors.length).toBeGreaterThan(0);
  });
});

describe("Gate 3 — an instructor cannot reach another instructor", () => {
  test("the shared list endpoint returns only the caller", async () => {
    const res = await instructorNorth1.get("/api/instructors");
    expect(res.status).toBe(200);
    expect(res.body.instructors).toHaveLength(1);
    expect(res.body.instructors[0].user.email).toBe(ACCOUNTS.instructorNorth1);
  });

  test("a same-university colleague's record is not readable", async () => {
    const res = await instructorNorth1.get(`/api/instructors/${north2InstructorId}`);
    expect(res.status).toBe(404);
  });

  test("a cross-university instructor's record is not readable", async () => {
    const res = await instructorNorth1.get(`/api/instructors/${west1InstructorId}`);
    expect(res.status).toBe(404);
  });

  test("an instructor cannot widen to their own university's roster", async () => {
    const res = await instructorNorth1.get(`/api/instructors?universityId=${northUniversityId}`);
    expect(res.status).toBe(200);
    expect(res.body.instructors).toHaveLength(1);
    expect(res.body.instructors[0].user.email).toBe(ACCOUNTS.instructorNorth1);
  });

  test("an instructor can read their own record directly", async () => {
    const res = await instructorNorth2.get(`/api/instructors/${north2InstructorId}`);
    expect(res.status).toBe(200);
    expect(res.body.instructor.user.email).toBe(ACCOUNTS.instructorNorth2);
  });
});

describe("Gate 4 — an admin spans universities in one session", () => {
  test("the unfiltered list contains instructors from both universities", async () => {
    const res = await admin.get("/api/instructors");
    expect(res.status).toBe(200);
    const universityIds = new Set(
      res.body.instructors.map((i: { universityId: string }) => i.universityId),
    );
    expect(universityIds.has(northUniversityId)).toBe(true);
    expect(universityIds.has(westUniversityId)).toBe(true);
  });

  test("the admin can narrow to either university in the same session", async () => {
    const north = await admin.get(`/api/instructors?universityId=${northUniversityId}`);
    const west = await admin.get(`/api/instructors?universityId=${westUniversityId}`);

    expect(north.status).toBe(200);
    expect(west.status).toBe(200);
    expect(north.body.instructors.length).toBeGreaterThan(0);
    expect(west.body.instructors.length).toBeGreaterThan(0);
    expect(north.body.instructors.every((i: { universityId: string }) =>
      i.universityId === northUniversityId)).toBe(true);
    expect(west.body.instructors.every((i: { universityId: string }) =>
      i.universityId === westUniversityId)).toBe(true);
  });

  test("the admin's scope resolves to global, not to a null university", async () => {
    const res = await admin.get("/api/auth/me");
    expect(res.body.scope.kind).toBe("global");
    expect(res.body.user.universityId).toBeNull();
  });

  test("the admin sees both seeded universities with their distinct configurations", async () => {
    // Asserted by identity rather than by count: universities can now be
    // provisioned through the API, so a fixed total would be order-dependent
    // on whichever test files ran first.
    const res = await admin.get("/api/universities");
    const seeded = res.body.universities.filter((u: { slug: string }) =>
      ["northfield", "westbrook"].includes(u.slug),
    );
    expect(seeded).toHaveLength(2);
    const timezones = seeded.map((u: { timezone: string }) => u.timezone);
    expect(new Set(timezones).size).toBe(2);
  });
});

describe("Session handling", () => {
  test("logout revokes the session server-side", async () => {
    const c = new ApiClient("logout");
    await c.login(ACCOUNTS.instructorWest1);
    expect((await c.get("/api/auth/me")).status).toBe(200);

    expect((await c.post("/api/auth/logout")).status).toBe(200);
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });

  test("a forged session cookie is rejected", async () => {
    const c = new ApiClient("forged");
    const res = await c.request("/api/auth/me", {
      method: "GET",
      headers: { cookie: "tracksheet_session=not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});
