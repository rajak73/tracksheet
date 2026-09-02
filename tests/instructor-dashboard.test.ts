import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { prisma } from "@/server/db";
import { RUN } from "./helpers/fixtures";
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
 * Two properties, both invisible in the UI if they broke: that self-service
 * cannot reach fields it has no business reaching, and that a password change
 * needs the current password and ends other sessions.
 *
 * A third used to be here — that correcting an activity obeyed the same
 * interval and overlap rules as recording one. There is no per-activity
 * correction any more; see the note above the last block.
 */

let admin: ApiClient;
let owner: ApiClient;
let manager: ApiClient;
let anon: ApiClient;

let ownerEmail: string;
let ownerInstructorId: string;
let ownerUserId: string;
let northId: string;

const PASSWORD = "DashboardPassword1";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  manager = new ApiClient("manager");
  northId = (await manager.login(ACCOUNTS.managerNorth)).user.universityId!;

  anon = new ApiClient("anonymous");

  ownerEmail = `dash.owner.${RUN}@fixture.test`;

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
      email: `hijack.${RUN}@fixture.test`,
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

/* ── Correcting a day ─────────────────────────────────────────────────────── */

/**
 * The "correcting a recorded activity" block was deleted rather than ported.
 *
 * It exercised `PATCH`/`DELETE` on `/instructors/:id/activities/:activityId` —
 * moving one activity's clock, catching an overlap with the activity beside it,
 * refusing a reversed or zero-length span, and the four roles' permissions on
 * all of that. That route is gone, and with it the model it belonged to: there
 * is no per-activity clock to move, no neighbouring activity to overlap, and no
 * activity id to address. A day is corrected by saving it again.
 *
 * What the block was really holding lives on, in the place that now owns it:
 * `worklog-quick-entry` has the permissions and the validation, and
 * `worklog-day-delete` has the removal and the routes' absence.
 */
describe("the explorer is read-only", () => {
  test("it exposes no way to write through it", async () => {
    /* The ledger gained a correction path on the OWNED route; it did not gain a
       general-purpose one, and the previously-asserted absence still holds.

       Asserted against the route rather than against a row id. A 404 on a child
       path cannot tell "no such route" from "no such row", so the id was never
       what made the check work — and reading one made the test depend on the
       explorer having rows at all. */
    expect([404, 405]).toContain((await owner.delete("/api/activities/any-id-at-all")).status);
    expect([404, 405]).toContain((await owner.delete("/api/activities")).status);
    expect([404, 405]).toContain(
      (await owner.post("/api/activities", { deliverable: "nope" })).status,
    );
  });
});
