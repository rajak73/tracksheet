import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Phase 5 gate — role dashboards.
 *
 * The three required tests, plus coverage of the endpoints the dashboards
 * actually call. Asserting at the API layer rather than on rendered HTML is
 * deliberate: the requirement is that a manager's dashboard cannot OBTAIN
 * another university's data, and that is a property of the endpoints, not of
 * what the markup happens to display.
 */

const TUE = "2026-12-08";

let admin: ApiClient, mgrN: ApiClient, mgrW: ApiClient, n1: ApiClient, n2: ApiClient;
let northId: string, westId: string, n1Id: string, n2Id: string, west1Id: string;

function ist(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (h * 60 + m - 330) * 60_000).toISOString();
}

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
  west1Id = (await admin.get(`/api/instructors?universityId=${westId}`)).body.instructors[0].id;

});

describe("Gate 1 — a manager's dashboard can only obtain its own university", () => {
  test("every endpoint the manager dashboard calls is tenant-scoped", async () => {
    // Exactly the calls manager/dashboard, /instructors, /activities,
    // /deliverables and /reports make.
    const own = [
      `/api/universities/${northId}/analytics`,
      `/api/universities/${northId}/reports`,
      `/api/universities/${northId}/exceptions`,
      `/api/universities/${northId}/managers`,
      "/api/instructors",
      "/api/notifications",
    ];
    for (const path of own) {
      expect((await mgrN.get(path)).status, path).toBe(200);
    }

    const foreign = [
      `/api/universities/${westId}/analytics`,
      `/api/universities/${westId}/reports`,
      `/api/universities/${westId}/exceptions`,
      `/api/universities/${westId}/managers`,
    ];
    for (const path of foreign) {
      expect((await mgrN.get(path)).status, path).toBe(403);
    }
  });

  test("the instructor list a manager receives contains no foreign instructor", async () => {
    const res = await mgrN.get("/api/instructors");
    for (const i of res.body.instructors) expect(i.universityId).toBe(northId);
    expect(JSON.stringify(res.body)).not.toContain(westId);
  });

  test("a manager cannot reach a foreign instructor's detail endpoints", async () => {
    for (const path of [
      `/api/instructors/${west1Id}`,
      `/api/instructors/${west1Id}/activities`,
      `/api/instructors/${west1Id}/deliverables`,
      `/api/instructors/${west1Id}/schedule`,
      `/api/instructors/${west1Id}/metrics`,
    ]) {
      expect((await mgrN.get(path)).status, path).toBe(404);
    }
  });
});

describe("Gate 2 — no instructor dashboard endpoint returns another instructor's data", () => {
  test("every endpoint the instructor dashboard calls is self-scoped", async () => {
    const calls = [
      `/api/instructors/${n1Id}/deliverables`,
      `/api/instructors/${n1Id}/activities`,
      `/api/instructors/${n1Id}/schedule`,
      `/api/instructors/${n1Id}/metrics`,
      `/api/universities/${northId}/analytics`,
      `/api/universities/${northId}/exceptions`,
    ];
    for (const path of calls) {
      const res = await n1.get(path);
      expect(res.status, path).toBe(200);
      // The colleague's id must not appear anywhere in any dashboard payload.
      expect(JSON.stringify(res.body), `${path} leaked colleague id`).not.toContain(n2Id);
    }
  });

  test("the colleague's own endpoints are unreachable", async () => {
    for (const path of [
      `/api/instructors/${n2Id}/deliverables`,
      `/api/instructors/${n2Id}/activities`,
      `/api/instructors/${n2Id}/schedule`,
      `/api/instructors/${n2Id}/metrics`,
    ]) {
      expect((await n1.get(path)).status, path).toBe(404);
    }
  });

  test("an instructor cannot plan their own schedule", async () => {
    const res = await n1.post(`/api/instructors/${n1Id}/schedule`, {
      date: TUE,
      activityTypeCode: "TEACHING",
      startTime: ist(TUE, "10:00"),
      endTime: ist(TUE, "11:00"),
    });
    expect(res.status).toBe(403);
  });
});

describe("Gate 3 — the admin drill-down resolves through real data at every level", () => {
  test("the admin overview links to every university in the drill-down", async () => {
    const overview = await admin.get("/api/admin/overview");
    expect(overview.status).toBe(200);
    for (const u of overview.body.universities) {
      expect((await admin.get(`/api/universities/${u.universityId}/managers`)).status).toBe(200);
    }
  });

  test("managers are admin/manager only — an instructor cannot enumerate them", async () => {
    expect((await n1.get(`/api/universities/${northId}/managers`)).status).toBe(403);
  });
});

describe("dashboards are backed by real data, not literals", () => {
  test("a manager can assign a deliverable and it appears against the instructor", async () => {
    const created = await mgrN.post(`/api/instructors/${n1Id}/deliverables`, {
      title: "Phase 5 deliverable", targetQuantity: 5, targetHours: 6, dueDate: "2027-01-15",
    });
    expect(created.status).toBe(201);

    const listed = await mgrN.get(`/api/instructors/${n1Id}/deliverables`);
    expect(listed.body.deliverables.some((d: { title: string }) => d.title === "Phase 5 deliverable")).toBe(true);
  });

  test("a manager can plan a slot and the instructor sees it on that day", async () => {
    const slot = await mgrN.post(`/api/instructors/${n1Id}/schedule`, {
      date: TUE,
      activityTypeCode: "TEACHING",
      startTime: ist(TUE, "10:00"),
      endTime: ist(TUE, "11:00"),
      location: "Room 2",
    });
    expect(slot.status).toBe(201);

    const schedule = await n1.get(`/api/instructors/${n1Id}/schedule?date=${TUE}`);
    expect(schedule.status).toBe(200);
    expect(schedule.body.slots).toHaveLength(1);
    expect(schedule.body.slots[0].location).toBe("Room 2");
    // The day's opening/closing come from configuration, not from slots.
    expect(schedule.body.opening).not.toBeNull();
    expect(schedule.body.closing).not.toBeNull();
  });

  test("opening and closing cannot be scheduled as slots", async () => {
    for (const code of ["DAILY_OPENING", "DAILY_CLOSING"]) {
      const res = await mgrN.post(`/api/instructors/${n1Id}/schedule`, {
        date: TUE, activityTypeCode: code,
        startTime: ist(TUE, "09:00"), endTime: ist(TUE, "09:15"),
      });
      expect(res.status, code).toBe(400);
      expect(res.body.error.code).toBe("NOT_SCHEDULABLE");
    }
  });

  test("the admin overview reports real counts, at least the seeded platform", async () => {
    // Floors, not fixed totals: universities and staff can now be provisioned
    // through the API, so another test file may legitimately have added some.
    const res = await admin.get("/api/admin/overview");
    expect(res.body.overview.totalUniversities).toBeGreaterThanOrEqual(2);
    expect(res.body.overview.totalManagers).toBeGreaterThanOrEqual(2);
    expect(res.body.overview.totalInstructors).toBeGreaterThanOrEqual(4);
  });
});
