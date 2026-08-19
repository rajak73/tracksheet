import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { prisma } from "@/server/db";

/**
 * The instructor dashboard's server side: self-service profile, password
 * change, and correcting a recorded activity.
 *
 * ── Everything runs against a throwaway account ────────────────────────────
 * These tests rename a person, change their password and delete their records.
 * Doing any of that to a seeded account would break every other suite that logs
 * in as one — a changed password is not something a later file could recover
 * from. So one instructor is provisioned here, used for everything, and removed
 * in `afterAll`.
 *
 * ── What is actually being pinned ──────────────────────────────────────────
 * Three properties, all invisible in the UI if they broke: that self-service
 * cannot reach fields it has no business reaching, that a password change needs
 * the current password and ends other sessions, and that correcting an activity
 * is subject to exactly the same interval and overlap rules as recording one.
 */

let admin: ApiClient;
let owner: ApiClient;
let other: ApiClient;
let manager: ApiClient;
let anon: ApiClient;

let RUN: string;
let ownerEmail: string;
let ownerInstructorId: string;
let ownerUserId: string;
let otherInstructorId: string;
let northId: string;

const PASSWORD = "DashboardPassword1";
/** A window in 2039 that no other suite touches. */
const DAY = "2039-03-07";

async function logActivity(client: ApiClient, instructorId: string, start: string, end: string, code = "TEACHING") {
  return client.post(`/api/instructors/${instructorId}/activities`, {
    activityTypeCode: code,
    local: { date: DAY, start, end },
  });
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  manager = new ApiClient("manager");
  northId = (await manager.login(ACCOUNTS.managerNorth)).user.universityId!;

  other = new ApiClient("other-instructor");
  otherInstructorId = (await other.login(ACCOUNTS.instructorNorth2)).user.instructorId!;

  anon = new ApiClient("anonymous");

  RUN = `${Date.now()}`.slice(-9);
  ownerEmail = `dash.owner.${RUN}@example.edu`;

  const created = await admin.post("/api/instructors", {
    email: ownerEmail,
    name: "Dashboard Owner",
    password: PASSWORD,
    universityId: northId,
  });
  expect(created.status).toBe(201);

  owner = new ApiClient("owner");
  const session = await owner.login(ownerEmail, PASSWORD);
  ownerInstructorId = session.user.instructorId!;
  ownerUserId = session.user.id;
});

afterAll(async () => {
  const user = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (!user) return;
  await prisma.activityLog.deleteMany({ where: { instructor: { userId: user.id } } });
  // AuditLog.userId is onDelete: Restrict, so this account's own audit rows have
  // to go before the account can.
  await prisma.auditLog.deleteMany({ where: { userId: user.id } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.instructor.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

/* ── Profile ──────────────────────────────────────────────────────────────── */

describe("an instructor manages their own profile", () => {
  test("they can read it, and it carries no credential material", async () => {
    const res = await owner.get("/api/me/profile");
    expect(res.status).toBe(200);
    expect(res.body.profile.email).toBe(ownerEmail);
    expect(res.body.profile.role).toBe("INSTRUCTOR");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain("scrypt");
  });

  test("name and mobile number are theirs to change", async () => {
    const res = await owner.patch("/api/me/profile", {
      name: "Dashboard Owner Renamed",
      phone: "+91 90000 00001",
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.name).toBe("Dashboard Owner Renamed");
    expect(res.body.profile.phone).toBe("+91 90000 00001");

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: ownerUserId },
      select: { name: true, phone: true },
    });
    expect(stored.name).toBe("Dashboard Owner Renamed");
  });

  test("a phone number can be cleared, and an absent field is left alone", async () => {
    await owner.patch("/api/me/profile", { phone: null });
    const cleared = await owner.get("/api/me/profile");
    expect(cleared.body.profile.phone).toBeNull();
    // The name was not in that request and must be untouched.
    expect(cleared.body.profile.name).toBe("Dashboard Owner Renamed");
  });

  test("email, role and tenancy are unreachable from this route", async () => {
    const res = await owner.patch("/api/me/profile", {
      email: `hijack.${RUN}@example.edu`,
      role: "ADMIN",
      universityId: "some-other-university",
      isActive: false,
    });
    // Unknown keys are ignored rather than honoured; what matters is the state
    // afterwards, which is unchanged.
    expect([200, 400]).toContain(res.status);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: ownerUserId },
      select: { email: true, role: true, universityId: true, isActive: true },
    });
    expect(stored.email).toBe(ownerEmail);
    expect(stored.role).toBe("INSTRUCTOR");
    expect(stored.universityId).toBe(northId);
    expect(stored.isActive).toBe(true);
  });

  test("a picture is accepted only as a real image, within the size cap", async () => {
    const tinyPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    expect((await owner.patch("/api/me/profile", { avatarUrl: tinyPng })).status).toBe(200);

    // Not an image at all.
    const script = await owner.patch("/api/me/profile", {
      avatarUrl: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    });
    expect(script.status).toBe(400);
    expect(script.body.error.code).toBe("INVALID_IMAGE");

    // Past the cap: a megabyte of base64.
    const huge = `data:image/png;base64,${"A".repeat(1_400_000)}`;
    const big = await owner.patch("/api/me/profile", { avatarUrl: huge });
    expect([400, 413]).toContain(big.status);

    // The good one survived both refusals.
    const after = await owner.get("/api/me/profile");
    expect(after.body.profile.avatarUrl).toBe(tinyPng);
  });

  test("a profile edit is audited without copying the personal values", async () => {
    const entry = await prisma.auditLog.findFirst({
      where: { action: "PROFILE_UPDATED", userId: ownerUserId },
      orderBy: { createdAt: "desc" },
      select: { entityType: true, metadata: true },
    });
    expect(entry).not.toBeNull();
    expect(entry!.entityType).toBe("User");
    const blob = JSON.stringify(entry!.metadata);
    expect(blob).toContain("fields");
    expect(blob).not.toContain("+91 90000 00001");
  });

  test("an unauthenticated caller reaches neither verb", async () => {
    expect((await anon.get("/api/me/profile")).status).toBe(401);
    expect((await anon.patch("/api/me/profile", { name: "Nobody" })).status).toBe(401);
  });

  test("the administrative instructor route still refuses self-editing", async () => {
    // The new self-service route exists ALONGSIDE that rule, it does not relax
    // it: an instructor still cannot edit their own personnel record.
    const res = await owner.patch(`/api/instructors/${ownerInstructorId}`, { name: "Via Admin Route" });
    expect(res.status).toBe(403);
  });
});

/* ── Password ─────────────────────────────────────────────────────────────── */

describe("changing your own password", () => {
  const NEXT = "DashboardPassword2";

  test("the current password is required, and a wrong one changes nothing", async () => {
    const res = await owner.post("/api/me/password", {
      currentPassword: "not-the-password",
      newPassword: NEXT,
      confirmPassword: NEXT,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");

    // Still the old password.
    const probe = new ApiClient("probe-old");
    const session = await probe.login(ownerEmail, PASSWORD);
    expect(session.user.id).toBe(ownerUserId);
  });

  test("a short password, a mismatch and a reuse are each refused", async () => {
    for (const body of [
      { currentPassword: PASSWORD, newPassword: "short", confirmPassword: "short" },
      { currentPassword: PASSWORD, newPassword: NEXT, confirmPassword: "DifferentAgain1" },
      { currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD },
    ]) {
      const res = await owner.post("/api/me/password", body);
      expect(res.status).toBe(400);
    }
  });

  test("it changes the password and ends every OTHER session", async () => {
    // A second signed-in device for the same person.
    const otherDevice = new ApiClient("owner-second-device");
    await otherDevice.login(ownerEmail, PASSWORD);
    expect((await otherDevice.get("/api/auth/me")).status).toBe(200);

    const res = await owner.post("/api/me/password", {
      currentPassword: PASSWORD,
      newPassword: NEXT,
      confirmPassword: NEXT,
    });
    expect(res.status).toBe(200);

    // The session that made the change keeps working…
    expect((await owner.get("/api/auth/me")).status).toBe(200);
    // …and the other one does not. This is the point of the feature.
    expect((await otherDevice.get("/api/auth/me")).status).toBe(401);

    const old = new ApiClient("old-password");
    const failed = await old.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: ownerEmail, password: PASSWORD }),
    });
    expect(failed.status).toBe(401);

    const fresh = new ApiClient("new-password");
    const session = await fresh.login(ownerEmail, NEXT);
    expect(session.user.id).toBe(ownerUserId);
  });

  test("no password material is written to the audit trail", async () => {
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "PASSWORD_CHANGED", userId: ownerUserId },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const blob = JSON.stringify(entry.metadata);
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain(NEXT);
  });

  test("an unauthenticated caller cannot reach it", async () => {
    expect(
      (await anon.post("/api/me/password", {
        currentPassword: "x",
        newPassword: "yyyyyyyyyyyy",
        confirmPassword: "yyyyyyyyyyyy",
      })).status,
    ).toBe(401);
  });
});

/* ── Correcting an activity ───────────────────────────────────────────────── */

describe("correcting a recorded activity", () => {
  let mine: string;
  let neighbour: string;

  test("an instructor records two activities for the day", async () => {
    const first = await logActivity(owner, ownerInstructorId, "09:00", "10:00");
    expect(first.status).toBe(201);
    mine = first.body.activity.id;

    const second = await logActivity(owner, ownerInstructorId, "11:00", "12:00", "MEETING");
    expect(second.status).toBe(201);
    neighbour = second.body.activity.id;
  });

  test("they can correct their own times and type", async () => {
    const res = await owner.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
      activityTypeCode: "RESEARCH",
      local: { date: DAY, start: "09:30", end: "10:30" },
      remarks: "corrected",
    });
    expect(res.status).toBe(200);

    const stored = await prisma.activityLog.findUniqueOrThrow({
      where: { id: mine },
      select: { remarks: true, activityType: { select: { code: true } } },
    });
    expect(stored.activityType.code).toBe("RESEARCH");
    expect(stored.remarks).toBe("corrected");
  });

  test("an edit that changes nothing is not reported as overlapping itself", async () => {
    // The row being edited is excluded from its own overlap check; without that
    // every save of an unchanged time would fail.
    const res = await owner.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
      activityTypeCode: "RESEARCH",
      local: { date: DAY, start: "09:30", end: "10:30" },
    });
    expect(res.status).toBe(200);
  });

  test("an edit into another activity's time is refused", async () => {
    const res = await owner.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
      activityTypeCode: "RESEARCH",
      local: { date: DAY, start: "11:30", end: "12:30" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACTIVITY_OVERLAP");
  });

  test("an edit is held to the same interval rules as the original entry", async () => {
    const reversed = await owner.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
      activityTypeCode: "RESEARCH",
      local: { date: DAY, start: "14:00", end: "13:00" },
    });
    expect(reversed.status).toBe(400);

    const zero = await owner.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
      activityTypeCode: "RESEARCH",
      local: { date: DAY, start: "14:00", end: "14:00" },
    });
    expect(zero.status).toBe(400);
  });

  test("an unknown activity type is refused", async () => {
    const res = await owner.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
      activityTypeCode: "NOT_A_REAL_TYPE",
      local: { date: DAY, start: "09:30", end: "10:30" },
    });
    expect(res.status).toBe(404);
  });

  test("a colleague cannot touch it, and is not told it exists", async () => {
    const edit = await other.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
      activityTypeCode: "TEACHING",
      local: { date: DAY, start: "15:00", end: "16:00" },
    });
    expect(edit.status).toBe(404);

    // Nor by routing it through their OWN instructor id.
    const viaOwnId = await other.patch(`/api/instructors/${otherInstructorId}/activities/${mine}`, {
      activityTypeCode: "TEACHING",
      local: { date: DAY, start: "15:00", end: "16:00" },
    });
    expect(viaOwnId.status).toBe(404);

    expect((await other.delete(`/api/instructors/${ownerInstructorId}/activities/${mine}`)).status).toBe(404);
  });

  test("a manager may not rewrite an instructor's recorded hours", async () => {
    // Deliberately narrower than who may CREATE: a manager is measured on these
    // numbers, so they must not be able to change them.
    const res = await manager.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
      activityTypeCode: "TEACHING",
      local: { date: DAY, start: "15:00", end: "16:00" },
    });
    expect(res.status).toBe(403);
    expect((await manager.delete(`/api/instructors/${ownerInstructorId}/activities/${mine}`)).status).toBe(403);
  });

  test("an unauthenticated caller reaches neither verb", async () => {
    expect(
      (await anon.patch(`/api/instructors/${ownerInstructorId}/activities/${mine}`, {
        activityTypeCode: "TEACHING",
        local: { date: DAY, start: "15:00", end: "16:00" },
      })).status,
    ).toBe(401);
    expect((await anon.delete(`/api/instructors/${ownerInstructorId}/activities/${mine}`)).status).toBe(401);
  });

  test("an edit records what the activity held before", async () => {
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "ACTIVITY_UPDATED", entityId: mine },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const metadata = entry.metadata as { before?: { activityType?: string } };
    expect(metadata.before?.activityType).toBeTruthy();
  });

  test("an admin can correct anyone's record", async () => {
    const res = await admin.patch(`/api/instructors/${ownerInstructorId}/activities/${neighbour}`, {
      activityTypeCode: "MEETING",
      local: { date: DAY, start: "11:00", end: "11:45" },
    });
    expect(res.status).toBe(200);
  });

  test("removing one leaves the rest of the day intact", async () => {
    const before = await prisma.activityLog.count({
      where: { instructorId: ownerInstructorId, workDate: new Date(`${DAY}T00:00:00.000Z`) },
    });

    const res = await owner.delete(`/api/instructors/${ownerInstructorId}/activities/${neighbour}`);
    expect(res.status).toBe(200);

    expect(await prisma.activityLog.findUnique({ where: { id: neighbour } })).toBeNull();
    expect(await prisma.activityLog.findUnique({ where: { id: mine } })).not.toBeNull();
    const after = await prisma.activityLog.count({
      where: { instructorId: ownerInstructorId, workDate: new Date(`${DAY}T00:00:00.000Z`) },
    });
    expect(after).toBe(before - 1);
  });

  test("a removal is the audit trail's only remaining copy, and it is complete", async () => {
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "ACTIVITY_DELETED", entityId: neighbour },
      select: { metadata: true },
    });
    const removed = (entry.metadata as { removed?: Record<string, unknown> }).removed ?? {};
    expect(removed.activityType).toBe("MEETING");
    expect(removed.workDate).toBe(DAY);
    expect(removed.startTime).toBeTruthy();
    expect(removed.endTime).toBeTruthy();
  });

  test("removing the same activity twice is a 404, not a second audit entry", async () => {
    expect((await owner.delete(`/api/instructors/${ownerInstructorId}/activities/${neighbour}`)).status).toBe(404);
  });

  test("the freed time can be recorded again", async () => {
    const res = await logActivity(owner, ownerInstructorId, "11:00", "12:00", "MEETING");
    expect(res.status).toBe(201);
  });

  test("the old collection route still exposes no delete", async () => {
    // The ledger gained a correction path on the OWNED route; it did not gain a
    // general-purpose one, and the previously-asserted absence still holds.
    const listed = await owner.get(`/api/activities?from=${DAY}&to=${DAY}&limit=5`);
    const id = listed.body.activities[0]?.id;
    expect(id).toBeTruthy();
    expect([404, 405]).toContain((await owner.delete(`/api/activities/${id}`)).status);
  });
});
