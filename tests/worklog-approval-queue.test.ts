import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * Everything the approval queue offers must be decidable.
 *
 * ── The dead end this closes ──────────────────────────────────────────────
 * A worklog written outside the university's hours is HELD: it needs a
 * manager's decision before the day is recorded. Instructors on nobody's roster
 * are answered for by the university's PRIMARY manager, and `GET
 * /api/manager/worklog` implements that — `answersForUnassigned` puts their
 * held days in the primary manager's queue, and the notification goes to them.
 *
 * `PATCH /api/manager/worklog/:id` had no matching clause. It compared the
 * submission's instructor against the caller's own roster id and nothing else,
 * so `managerId === null` failed and the answer was 404.
 *
 * The item therefore sat in the queue, the bell said it was theirs to action,
 * and pressing approve reported that it did not exist. And because
 * `decideSubmission` is what WRITES the activities, nobody below an admin could
 * record that day at all — the instructor's hours were never counted, and the
 * one person told about it was told it was theirs to fix.
 *
 * ── Cleans up after itself ───────────────────────────────────────────────
 * An unassigned instructor is exactly the kind of shared-state change that made
 * other files fail depending on run order, so this one is removed again in
 * afterAll rather than left for the next file to find.
 */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

let admin: ApiClient, primaryManager: ApiClient;
let northId = "", unassignedId = "", submissionId = "", userId = "";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  primaryManager = new ApiClient("primary-manager");
  const me = await primaryManager.login(ACCOUNTS.managerNorth);
  northId = me.user.universityId!;

  // The premise: this manager really is the university's primary. If the seed
  // or another file changed that, every assertion below would be meaningless.
  const university = await prisma.university.findUniqueOrThrow({
    where: { id: northId },
    select: { primaryManagerId: true },
  });
  const managerId = (await primaryManager.get("/api/auth/me")).body.user.managerId;
  expect(university.primaryManagerId, "the seeded North manager should be primary").toBe(managerId);

  // An instructor on nobody's roster — `managerId` omitted, per the route's own
  // contract ("Omit to create the instructor unassigned").
  const created = await admin.post("/api/instructors", {
    email: `queue.inst.${RUN}@example.edu`,
    name: `Queue Instructor ${RUN}`,
    password: "worklog-queue-pw-1234",
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  unassignedId = created.body.instructor.id;
  expect(created.body.instructor.managerId).toBeNull();
  userId = (
    await prisma.instructor.findUniqueOrThrow({
      where: { id: unassignedId },
      select: { userId: true },
    })
  ).userId;

  // A held day. Written directly because the natural route to PENDING is a
  // submission outside the configured hours, and the state — not the clock that
  // produces it — is what this test is about.
  const submission = await prisma.worklogSubmission.create({
    data: {
      instructorId: unassignedId,
      universityId: northId,
      workDate: new Date("2026-08-11T00:00:00.000Z"),
      rawBullets: ["Taught a session from 10 to 11"],
      approval: "PENDING",
    },
    select: { id: true },
  });
  submissionId = submission.id;
});

afterAll(async () => {
  await prisma.worklogSubmission.deleteMany({ where: { instructorId: unassignedId } });
  await prisma.activityLog.deleteMany({ where: { instructorId: unassignedId } });
  await prisma.instructor.deleteMany({ where: { id: unassignedId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("the primary manager answers for the unassigned", () => {
  test("their held day appears in the queue", async () => {
    const res = await primaryManager.get(
      "/api/manager/worklog?from=2026-08-01&to=2026-08-20",
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(submissionId);
  });

  test("and the same manager can actually decide it", async () => {
    /* The whole point: this answered 404 while the item sat in their queue.
     *
     * Rejecting rather than approving, because approval RE-PARSES the bullets
     * through the AI provider — deliberately absent under test — and would fail
     * with PARSE_UNAVAILABLE for reasons that have nothing to do with the
     * boundary. The authorisation guard being tested runs before either path,
     * so a rejection exercises exactly the check that was broken. */
    const res = await primaryManager.patch(`/api/manager/worklog/${submissionId}`, {
      approve: false,
      note: "decided by the primary manager",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe("but a manager who is not primary still cannot", () => {
  test("another university's manager is refused", async () => {
    const west = new ApiClient("west-manager");
    await west.login(ACCOUNTS.managerWest);
    const res = await west.patch(`/api/manager/worklog/${submissionId}`, { approve: false });
    expect([403, 404]).toContain(res.status);
  });
});
