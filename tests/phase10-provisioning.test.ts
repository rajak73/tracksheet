import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Phase 10 §3 gate — admin provisioning.
 *
 * The substantive test is the second one: a university created through the API
 * is immediately, fully operational — staffable, and its working hours feed the
 * Phase 2 time engine with no special-casing. That is what distinguishes real
 * provisioning from a row insert.
 */

const NEW_CODE = `UNIV${Date.now().toString().slice(-6)}`;
const NEW_SLUG = `probe-${Date.now().toString().slice(-6)}`;
const PASSWORD = "ProvisionedPass123!";

let admin: ApiClient, mgrN: ApiClient, n1: ApiClient;
let northId: string;
let newUniversityId: string;

/** Mon-Fri 08:00-17:00, matching the payload posted below. */
const WORKING_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
  const isWorkingDay = dayOfWeek >= 1 && dayOfWeek <= 5;
  return {
    dayOfWeek,
    isWorkingDay,
    startMinute: isWorkingDay ? 8 * 60 : 0,
    endMinute: isWorkingDay ? 17 * 60 : 1,
  };
});

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  n1 = new ApiClient("n1");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  const me = await n1.login(ACCOUNTS.instructorNorth1);
  northId = me.user.universityId!;
});

describe("Gate 1 — only an admin can create a university", () => {
  test("manager, instructor and anonymous are all refused", async () => {
    const body = {
      name: "Rejected University", code: "REJECT1", slug: "rejected",
      timezone: "Europe/London", workingHours: WORKING_HOURS,
    };
    expect((await mgrN.post("/api/universities", body)).status).toBe(403);
    expect((await n1.post("/api/universities", body)).status).toBe(403);
    expect((await new ApiClient("anon").post("/api/universities", body)).status).toBe(401);
  });
});

describe("Gate 2 — a created university is immediately operational", () => {
  test("it can be created with its full configuration", async () => {
    const res = await admin.post("/api/universities", {
      name: "Probe University",
      code: NEW_CODE,
      slug: NEW_SLUG,
      timezone: "Europe/London",
      openingDurationMin: 20,
      closingDurationMin: 10,
      breakDurationMin: 45,
      workingHours: WORKING_HOURS,
      holidays: [{ date: "2027-12-24", name: "Christmas Eve" }],
      country: "United Kingdom",
    });
    expect(res.status).toBe(201);
    newUniversityId = res.body.university.id;
    expect(res.body.university.code).toBe(NEW_CODE);
  });

  test("its working hours feed the Phase 2 time engine with no special-casing", async () => {
    // 2027-06-02 is a Wednesday.
    const res = await admin.get(`/api/universities/${newUniversityId}/windows?date=2027-06-02`);
    expect(res.status).toBe(200);

    const w = res.body.windows;
    expect(w.isWorkingDay).toBe(true);
    expect(w.timezone).toBe("Europe/London");
    // Opening runs from the configured start for the configured duration.
    expect(w.opening.startLocal).toBe("08:00");
    expect(w.opening.endLocal).toBe("08:20");
    // Closing ends at the configured end.
    expect(w.closing.startLocal).toBe("16:50");
    expect(w.closing.endLocal).toBe("17:00");
  });

  test("its holiday and non-working days are honoured immediately", async () => {
    // A Friday, so the holiday is what makes it non-working. A holiday landing
    // on a weekend would report NOT_A_WORKING_DAY instead — the more
    // fundamental reason — which would not exercise the holiday path at all.
    const holiday = await admin.get(`/api/universities/${newUniversityId}/windows?date=2027-12-24`);
    expect(holiday.body.windows.isWorkingDay).toBe(false);
    expect(holiday.body.windows.nonWorkingReason).toBe("HOLIDAY");
    expect(holiday.body.windows.holiday.name).toBe("Christmas Eve");

    // 2027-06-06 is a Sunday.
    const sunday = await admin.get(`/api/universities/${newUniversityId}/windows?date=2027-06-06`);
    expect(sunday.body.windows.nonWorkingReason).toBe("NOT_A_WORKING_DAY");
  });

  test("a manager can be created and becomes primary", async () => {
    const res = await admin.post(`/api/universities/${newUniversityId}/managers`, {
      email: `mgr-${NEW_SLUG}@example.edu`,
      name: "Probe Manager",
      password: PASSWORD,
      employeeCode: "PM-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.manager.isPrimary).toBe(true);

    const listed = await admin.get(`/api/universities/${newUniversityId}/managers`);
    expect(listed.body.managers).toHaveLength(1);
    expect(listed.body.managers[0].isPrimary).toBe(true);
  });

  test("that manager can log in and sees only their new university", async () => {
    const c = new ApiClient("newMgr");
    const { user } = await c.login(`mgr-${NEW_SLUG}@example.edu`, PASSWORD);
    expect(user.role).toBe("MANAGER");
    expect(user.universityId).toBe(newUniversityId);

    // Session-derived scope works immediately — no extra wiring step.
    expect((await c.get(`/api/universities/${newUniversityId}/analytics`)).status).toBe(200);
    expect((await c.get(`/api/universities/${northId}/analytics`)).status).toBe(403);
  });

  test("that manager can staff their own university, and the instructor can log in", async () => {
    const mgr = new ApiClient("newMgr2");
    await mgr.login(`mgr-${NEW_SLUG}@example.edu`, PASSWORD);

    const created = await mgr.post("/api/instructors", {
      email: `inst-${NEW_SLUG}@example.edu`,
      name: "Probe Instructor",
      password: PASSWORD,
      employeeCode: "PI-01",
    });
    expect(created.status).toBe(201);
    expect(created.body.instructor.universityId).toBe(newUniversityId);

    const inst = new ApiClient("newInst");
    const { user } = await inst.login(`inst-${NEW_SLUG}@example.edu`, PASSWORD);
    expect(user.role).toBe("INSTRUCTOR");
    expect(user.instructorId).toBeTruthy();

    // Fully functional end to end: the new instructor can record work against
    // the new university's configured hours.
    const log = await inst.post(`/api/instructors/${user.instructorId}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2027-06-02T09:00:00Z",
      endTime: "2027-06-02T11:00:00Z",
    });
    expect(log.status).toBe(201);

    const analytics = await mgr.get(
      `/api/universities/${newUniversityId}/analytics?from=2027-06-02&to=2027-06-02`,
    );
    const row = analytics.body.analytics.instructors[0];
    expect(row.productiveHours).toBe(2);
    // 9h day minus a 45-minute configured break = 8.25h capacity.
    expect(row.capacityHours).toBe(8.25);
  });

  test("duplicate code or slug is refused rather than silently shadowing", async () => {
    const dup = await admin.post("/api/universities", {
      name: "Duplicate", code: NEW_CODE, slug: `${NEW_SLUG}-other`,
      timezone: "Europe/London", workingHours: WORKING_HOURS,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("UNIVERSITY_EXISTS");
  });

  test("an invalid configuration is refused at creation, not stored broken", async () => {
    const bad = await admin.post("/api/universities", {
      name: "Bad Config", code: `${NEW_CODE}X`, slug: `${NEW_SLUG}-bad`,
      timezone: "Mars/Olympus_Mons", workingHours: WORKING_HOURS,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_TIMEZONE");

    const tooLong = await admin.post("/api/universities", {
      name: "Bad Durations", code: `${NEW_CODE}Y`, slug: `${NEW_SLUG}-bad2`,
      timezone: "Europe/London",
      openingDurationMin: 400, closingDurationMin: 400,
      workingHours: WORKING_HOURS,
    });
    expect(tooLong.status).toBe(400);
  });
});

describe("Gate 3 — a manager can only create instructors in their own university", () => {
  test("a universityId in the body is ignored, not trusted", async () => {
    const res = await mgrN.post("/api/instructors", {
      email: `smuggled-${Date.now()}@example.edu`,
      name: "Smuggled",
      password: PASSWORD,
      universityId: newUniversityId, // a university this manager cannot see
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("an instructor created by a manager lands in that manager's university", async () => {
    const email = `own-${Date.now()}@example.edu`;
    const res = await mgrN.post("/api/instructors", {
      email, name: "Own University Instructor", password: PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.body.instructor.universityId).toBe(northId);

    // And it is visible in the manager's own roster, nowhere else.
    const roster = await mgrN.get("/api/instructors");
    expect(roster.body.instructors.some((i: { user: { email: string } }) => i.user.email === email)).toBe(true);
  });

  test("an instructor cannot create anyone", async () => {
    const res = await n1.post("/api/instructors", {
      email: `nope-${Date.now()}@example.edu`, name: "Nope", password: PASSWORD,
    });
    expect(res.status).toBe(403);
  });

  test("an admin must name the university explicitly", async () => {
    const res = await admin.post("/api/instructors", {
      email: `noUni-${Date.now()}@example.edu`, name: "No University", password: PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNIVERSITY_REQUIRED");
  });

  test("a duplicate email is refused", async () => {
    const res = await mgrN.post("/api/instructors", {
      email: ACCOUNTS.instructorNorth1, name: "Clash", password: PASSWORD,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_IN_USE");
  });

  test("a weak initial password is refused", async () => {
    const res = await mgrN.post("/api/instructors", {
      email: `weak-${Date.now()}@example.edu`, name: "Weak", password: "short",
    });
    expect(res.status).toBe(400);
  });

  test("provisioning is recorded in the audit log", async () => {
    const audit = await admin.get(`/api/universities/${northId}/audit?action=INSTRUCTOR_CREATED`);
    expect(audit.status).toBe(200);
    expect(audit.body.entries.length).toBeGreaterThan(0);
  });
});


describe("deployment health check", () => {
  test("reports ok and is reachable without authentication", async () => {
    // Render probes this without credentials.
    const res = await new ApiClient("anon").get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("reachable");
  });

  test("it discloses nothing about the data", async () => {
    const res = await new ApiClient("anon").get("/api/health");
    const blob = JSON.stringify(res.body);
    for (const leak of ["university", "instructor", "email", "count", "postgres", "@"]) {
      expect(blob.toLowerCase(), `health check leaked ${leak}`).not.toContain(leak);
    }
  });
});
