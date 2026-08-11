import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

let admin: ApiClient;
let managerNorth: ApiClient;
let managerWest: ApiClient;
let instructorNorth1: ApiClient;

let northUniversityId: string;
let westUniversityId: string;
let north1InstructorId: string;

const activityTypes: Record<string, string> = {}; // code to id

beforeAll(async () => {
  admin = new ApiClient("admin");
  managerNorth = new ApiClient("managerNorth");
  managerWest = new ApiClient("managerWest");
  instructorNorth1 = new ApiClient("instructorNorth1");

  await admin.login(ACCOUNTS.admin);
  const northLogin = await managerNorth.login(ACCOUNTS.managerNorth);
  const westLogin = await managerWest.login(ACCOUNTS.managerWest);
  const instNorth1Login = await instructorNorth1.login(ACCOUNTS.instructorNorth1);

  northUniversityId = northLogin.user.universityId!;
  westUniversityId = westLogin.user.universityId!;
  north1InstructorId = instNorth1Login.user.instructorId!;

  // Fetch activity types seeded in Phase 1/2
  const typesRes = await admin.get("/api/activity-types");
  for (const t of typesRes.body.activityTypes) {
    activityTypes[t.code] = t.id;
  }
});

describe("Phase 3 - Activity Logging", () => {
  test("Instructor can log DAILY_OPENING", async () => {
    const res = await instructorNorth1.post(`/api/instructors/${north1InstructorId}/activities`, {
      activityTypeCode: "DAILY_OPENING",
      startTime: "2026-08-11T09:00:00Z",
      endTime: "2026-08-11T09:15:00Z",
    });

    expect(res.status).toBe(201);
    expect(res.body.activity.activityTypeId).toBe(activityTypes["DAILY_OPENING"]);
  });

  test("Logging a second DAILY_OPENING on the same working day fails", async () => {
    const res = await instructorNorth1.post(`/api/instructors/${north1InstructorId}/activities`, {
      activityTypeCode: "DAILY_OPENING",
      startTime: "2026-08-11T12:00:00Z", // Same day, different time
      endTime: "2026-08-11T12:15:00Z",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_ONCE_PER_DAY_ACTIVITY");
  });

  test("Instructor can log overlapping TEACHING activities (stored, flagged later)", async () => {
    const res1 = await instructorNorth1.post(`/api/instructors/${north1InstructorId}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2026-08-11T10:00:00Z",
      endTime: "2026-08-11T11:00:00Z",
    });
    expect(res1.status).toBe(201);

    const res2 = await instructorNorth1.post(`/api/instructors/${north1InstructorId}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2026-08-11T10:30:00Z", // Overlaps with res1
      endTime: "2026-08-11T11:30:00Z",
    });
    expect(res2.status).toBe(201); // No 409 error
  });

  test("Manager can fetch activities for their university", async () => {
    const res = await managerNorth.get(`/api/universities/${northUniversityId}/activities`);
    expect(res.status).toBe(200);
    expect(res.body.activities.length).toBeGreaterThan(0);
    
    // Should contain the TEACHING and DAILY_OPENING logs from above
    const codes = res.body.activities.map((a: { activityType: { code: string } }) => a.activityType.code);
    expect(codes).toContain("DAILY_OPENING");
    expect(codes).toContain("TEACHING");
  });

  test("Manager cannot fetch activities for another university", async () => {
    const res = await managerNorth.get(`/api/universities/${westUniversityId}/activities`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });
});
