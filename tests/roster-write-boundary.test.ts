import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * A manager may WRITE only to their own roster.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * The rule was enforced by some routes and not others, and the gap was
 * invisible from the code alone: several handlers resolve their instructor
 * through a helper whose name says "visible", then write through it.
 * `assertCanReadInstructor` compares only the UNIVERSITY for a manager, which
 * is right for reading and wrong for writing, so every one of those handlers
 * let a manager act on a colleague's roster member.
 *
 * Two were open when this file was written, both confirmed by probe rather
 * than by reading:
 *
 *   POST /api/instructors/:id/activities   201 — hours and free-text remarks
 *                                                posted onto someone else's
 *                                                instructor, feeding Working
 *                                                Hours and utilization
 *   POST /api/instructors/:id/leave        201 — with status APPROVED, which
 *                                                REMOVES days from capacity and
 *                                                so rewrites that instructor's
 *                                                utilization
 *
 * ── Built to add, never to mutate ─────────────────────────────────────────
 * The whole suite shares one database. An earlier version of this check moved a
 * SEEDED instructor onto another roster, which is exactly the kind of leftover
 * state that made other files fail depending on the order they ran in. This one
 * only ever creates its own people, so nothing it does can be observed by
 * another file.
 *
 * ── Why a second manager, not an unassigned instructor ────────────────────
 * `assertCanManageInstructor` deliberately lets a university's PRIMARY manager
 * act on an instructor who is on nobody's roster. Unassigning therefore proves
 * nothing: the write is allowed, and correctly so. The instructor has to belong
 * to a DIFFERENT manager for the boundary to be the thing under test.
 */

/* Letters only, deliberately. This string ends up inside an instructor's NAME,
 * and a name is read back out of AI briefs by `verifyReply`, which rejects any
 * number the FACTS do not support. A tag like "READBOUNDARY7f3" would put a
 * stray 7 and 3 into a person's name and could fail an unrelated AI test for a
 * reason nobody would look for here. `Math.random().toString(36)` yields digits
 * about a third of the time, so it is mapped to letters. */
const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));
const PASSWORD = "roster-boundary-pw-1234";

/* Today in the university's zone (Asia/Kolkata). A worklog may only be written
 * up for the day it belongs to, so this cannot be a fixed date. */

let admin: ApiClient;
let seedManager: ApiClient;
let theirInstructorId: string;
let theirDeliverableId: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  seedManager = new ApiClient("seed-manager");
  const m = await seedManager.login(ACCOUNTS.managerNorth);
  const northId = m.user.universityId!;

  // A second manager in the same university…
  const otherManager = await admin.post(`/api/universities/${northId}/managers`, {
    email: `boundary.mgr.${RUN}@example.edu`,
    name: "Boundary Second Manager",
    password: PASSWORD,
  });
  expect(otherManager.status, JSON.stringify(otherManager.body)).toBe(201);
  const otherManagerId = otherManager.body.manager?.id ?? otherManager.body.id;

  // …and an instructor of their own, created straight onto their roster.
  const theirs = await admin.post("/api/instructors", {
    email: `boundary.inst.${RUN}@example.edu`,
    name: "Boundary Instructor",
    password: PASSWORD,
    universityId: northId,
    managerId: otherManagerId,
  });
  expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
  theirInstructorId = theirs.body.instructor.id;

  // The premise of every test below. If this is not true they prove nothing.
  expect(theirs.body.instructor.managerId).toBe(otherManagerId);

  /* A deliverable of their own, created by the admin, so the checks below
     are about the BOUNDARY rather than about a missing row. The worklog
     submission that used to sit beside it is gone with the narrative path. */
  // so the two sub-resource writes below have something real to aim at.
  const deliverable = await admin.post(`/api/instructors/${theirInstructorId}/deliverables`, {
    title: "Their own deliverable",
    targetQuantity: 5,
    targetHours: 10,
    dueDate: "2027-02-01",
  });
  expect(deliverable.status, JSON.stringify(deliverable.body)).toBe(201);
  theirDeliverableId = deliverable.body.deliverable.id;

});

describe("a manager cannot write to another manager's instructor", () => {
  test("cannot record their hours", async () => {
    const res = await seedManager.post(`/api/instructors/${theirInstructorId}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2026-09-04T10:00:00Z",
      endTime: "2026-09-04T11:00:00Z",
      remarks: "posted by a manager who does not own this instructor",
    });
    expect([403, 404]).toContain(res.status);
  });

  test("cannot book — or pre-approve — their leave", async () => {
    const res = await seedManager.post(`/api/instructors/${theirInstructorId}/leave`, {
      startDate: "2026-09-07",
      endDate: "2026-09-08",
      status: "APPROVED",
      reason: "approved by a manager who does not own this instructor",
    });
    expect([403, 404]).toContain(res.status);
  });

  test("cannot set them a deliverable", async () => {
    const res = await seedManager.post(`/api/instructors/${theirInstructorId}/deliverables`, {
      title: "assigned by the wrong manager",
      targetQuantity: 1,
      targetHours: 1,
      dueDate: "2027-01-01",
    });
    expect([403, 404]).toContain(res.status);
  });

  test("cannot schedule their day", async () => {
    const res = await seedManager.post(`/api/instructors/${theirInstructorId}/schedule`, {
      date: "2026-09-04",
      activityTypeCode: "TEACHING",
      startTime: "2026-09-04T10:00:00.000Z",
      endTime: "2026-09-04T11:00:00.000Z",
    });
    expect([403, 404]).toContain(res.status);
  });

  test("cannot send them a reminder", async () => {
    const res = await seedManager.post(`/api/instructors/${theirInstructorId}/remind`, {
      workDate: "2026-09-04",
    });
    expect([403, 404]).toContain(res.status);
  });

  test("cannot edit their record", async () => {
    const res = await seedManager.patch(`/api/instructors/${theirInstructorId}`, {
      name: "renamed by the wrong manager",
    });
    expect([403, 404]).toContain(res.status);
  });

  test("cannot log progress against their deliverable", async () => {
    const res = await seedManager.post(
      `/api/instructors/${theirInstructorId}/deliverables/${theirDeliverableId}/logs`,
      { workDate: "2026-09-04", quantityCompleted: 1, hoursSpent: 2 },
    );
    expect([403, 404]).toContain(res.status);
  });

  /* "cannot re-parse their worklog" and "cannot submit a worklog as them"
     were deleted rather than ported. Both routes are gone with the narrative
     path: an instructor no longer writes the day as a paragraph for a model to
     classify, so there is nothing to submit and nothing to re-parse. Asserting
     that a manager cannot reach a route nobody built says nothing about the
     boundary — it is true of every path that does not exist. */

  test("the owning manager records hours normally", async () => {
    const owner = new ApiClient("other-manager");
    await owner.login(`boundary.mgr.${RUN}@example.edu`, PASSWORD);
    const res = await owner.post(`/api/instructors/${theirInstructorId}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2026-09-05T10:00:00Z",
      endTime: "2026-09-05T11:00:00Z",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
