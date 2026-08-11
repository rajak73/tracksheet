import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Role architecture gate.
 *
 * Covers: one shared login, role-based redirect targets, page-level route
 * guards for all three trees, server-side authorization independent of those
 * guards, and session termination.
 */

let admin: ApiClient, mgrN: ApiClient, mgrW: ApiClient, n1: ApiClient, n2: ApiClient;
let northId: string, westId: string, n1Id: string, n2Id: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  mgrW = new ApiClient("mgrW");
  n1 = new ApiClient("n1");
  n2 = new ApiClient("n2");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  await mgrW.login(ACCOUNTS.managerWest);
  const a = await n1.login(ACCOUNTS.instructorNorth1);
  const b = await n2.login(ACCOUNTS.instructorNorth2);
  n1Id = a.user.instructorId!;
  n2Id = b.user.instructorId!;
  northId = a.user.universityId!;
  const u = await admin.get("/api/universities");
  westId = u.body.universities.find((x: { slug: string }) => x.slug === "westbrook").id;
});

describe("one login, three applications", () => {
  test("all three roles authenticate at the same endpoint", async () => {
    for (const email of [ACCOUNTS.admin, ACCOUNTS.managerNorth, ACCOUNTS.instructorNorth1]) {
      const c = new ApiClient("t");
      const res = await c.post("/api/auth/login", { email, password: "Password123!" });
      expect(res.status).toBe(200);
    }
  });

  test("the login page is reachable without a session", async () => {
    const anon = new ApiClient("anon");
    expect((await anon.request("/login", { method: "GET" })).status).toBe(200);
  });

  test("the role in the response determines the destination", async () => {
    const expectations: Array<[string, string]> = [
      [ACCOUNTS.admin, "ADMIN"],
      [ACCOUNTS.managerNorth, "MANAGER"],
      [ACCOUNTS.instructorNorth1, "INSTRUCTOR"],
    ];
    for (const [email, role] of expectations) {
      const c = new ApiClient("t");
      const { user } = await c.login(email);
      expect(user.role).toBe(role);
    }
  });
});

describe("page-level route guards", () => {
  const OWN = 200;
  const DENIED = 307; // redirected to /login

  test("each role reaches only its own tree", async () => {
    const matrix: Array<[ApiClient, string, number]> = [
      [admin, "/admin/dashboard", OWN],
      [admin, "/manager/dashboard", DENIED],
      [admin, "/instructor/dashboard", DENIED],

      [mgrN, "/admin/dashboard", DENIED],
      [mgrN, "/manager/dashboard", OWN],
      [mgrN, "/instructor/dashboard", DENIED],

      [n1, "/admin/dashboard", DENIED],
      [n1, "/manager/dashboard", DENIED],
      [n1, "/instructor/dashboard", OWN],
    ];

    for (const [client, path, expected] of matrix) {
      const res = await client.request(path, { method: "GET" });
      expect(res.status, `${client.label} -> ${path}`).toBe(expected);
    }
  });

  test("every role page is closed to anonymous callers", async () => {
    const anon = new ApiClient("anon");
    for (const path of [
      "/admin/dashboard",
      "/admin/universities",
      "/admin/instructors",
      "/admin/reports",
      "/manager/dashboard",
      "/manager/instructors",
      "/manager/activities",
      "/manager/reports",
      "/instructor/dashboard",
      "/instructor/activities",
    ]) {
      expect((await anon.request(path, { method: "GET" })).status, path).toBe(307);
    }
  });

  test("navigation targets all resolve for their own role", async () => {
    for (const path of ["/admin/dashboard", "/admin/universities", "/admin/instructors", "/admin/reports"]) {
      expect((await admin.request(path, { method: "GET" })).status, path).toBe(200);
    }
    for (const path of ["/manager/dashboard", "/manager/instructors", "/manager/activities", "/manager/reports"]) {
      expect((await mgrN.request(path, { method: "GET" })).status, path).toBe(200);
    }
    for (const path of ["/instructor/dashboard", "/instructor/activities"]) {
      expect((await n1.request(path, { method: "GET" })).status, path).toBe(200);
    }
  });
});

describe("signing out terminates the session server-side", () => {
  test("a captured cookie stops working after logout", async () => {
    const c = new ApiClient("signout");
    await c.login(ACCOUNTS.managerNorth);
    expect((await c.get("/api/auth/me")).status).toBe(200);

    // Capture the cookie BEFORE logging out, exactly as an attacker who had
    // copied it would hold it.
    const stolen = c.captureCookie();
    expect(stolen).toBeTruthy();

    expect((await c.post("/api/auth/logout")).status).toBe(200);

    // Replay the captured cookie. Clearing the client's cookie is not enough —
    // the session must be dead on the server.
    const replay = new ApiClient("replay");
    replay.restoreCookie(stolen);
    expect((await replay.get("/api/auth/me")).status).toBe(401);
    expect((await replay.request("/manager/dashboard", { method: "GET" })).status).toBe(307);
  });

  test("merely visiting /login does NOT end the session", async () => {
    // Documents the real behaviour so the fix cannot silently regress into a
    // link again: only the logout endpoint terminates a session.
    const c = new ApiClient("nav");
    await c.login(ACCOUNTS.managerNorth);
    await c.request("/login", { method: "GET" });
    expect((await c.get("/api/auth/me")).status).toBe(200);

    await c.post("/api/auth/logout");
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });
});

describe("backend authorization is independent of the UI", () => {
  test("admin has global scope", async () => {
    expect((await admin.get("/api/admin/overview")).status).toBe(200);
    expect((await admin.get(`/api/universities/${northId}/analytics`)).status).toBe(200);
    expect((await admin.get(`/api/universities/${westId}/analytics`)).status).toBe(200);
  });

  test("manager is confined to one university", async () => {
    expect((await mgrN.get(`/api/universities/${northId}/analytics`)).status).toBe(200);
    expect((await mgrN.get(`/api/universities/${westId}/analytics`)).status).toBe(403);
    expect((await mgrW.get(`/api/universities/${northId}/analytics`)).status).toBe(403);
    expect((await mgrN.get("/api/admin/overview")).status).toBe(403);
  });

  test("instructor is confined to themselves", async () => {
    expect((await n1.get(`/api/instructors/${n1Id}/activities`)).status).toBe(200);
    expect((await n1.get(`/api/instructors/${n2Id}/activities`)).status).toBe(404);
    expect((await n1.get("/api/admin/overview")).status).toBe(403);
    expect((await n1.get(`/api/universities/${northId}/insights`)).status).toBe(403);
  });

  test("only an admin can change university configuration", async () => {
    const body = { openingDurationMin: 15 };
    expect((await mgrN.request(`/api/universities/${northId}/config`, { method: "PATCH", body: JSON.stringify(body) })).status).toBe(403);
    expect((await n1.request(`/api/universities/${northId}/config`, { method: "PATCH", body: JSON.stringify(body) })).status).toBe(403);
    expect((await admin.request(`/api/universities/${northId}/config`, { method: "PATCH", body: JSON.stringify(body) })).status).toBe(200);
  });
});

describe("instructor self-service permissions", () => {
  test("an instructor may submit a leave request for themselves", async () => {
    const res = await n1.post(`/api/instructors/${n1Id}/leave`, {
      startDate: "2027-05-03",
      endDate: "2027-05-03",
      reason: "Personal",
    });
    expect(res.status).toBe(201);
    // Forced to PENDING regardless of intent.
    expect(res.body.leave.status).toBe("PENDING");
  });

  test("an instructor cannot approve their own leave", async () => {
    const res = await n1.post(`/api/instructors/${n1Id}/leave`, {
      startDate: "2027-05-04",
      endDate: "2027-05-04",
      status: "APPROVED",
    });
    expect(res.status).toBe(403);
  });

  test("an instructor cannot submit leave for a colleague", async () => {
    const res = await n1.post(`/api/instructors/${n2Id}/leave`, {
      startDate: "2027-05-05",
      endDate: "2027-05-05",
    });
    expect(res.status).toBe(404);
  });

  test("a manager can approve leave in their own university", async () => {
    const res = await mgrN.post(`/api/instructors/${n1Id}/leave`, {
      startDate: "2027-05-06",
      endDate: "2027-05-06",
      status: "APPROVED",
    });
    expect(res.status).toBe(201);
    expect(res.body.leave.status).toBe("APPROVED");
  });

  test("personal insights are self-scoped and never expose a colleague", async () => {
    const mine = await n1.get(`/api/instructors/${n1Id}/insights`);
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.body.insights)).toBe(true);

    const theirs = await n1.get(`/api/instructors/${n2Id}/insights`);
    expect(theirs.status).toBe(404);
  });
});
