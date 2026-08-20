import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * What a manager may READ about somebody else's instructor.
 *
 * ── Two different reading questions ───────────────────────────────────────
 * "Who else works here?" and "What did that person do?" are separate, and a
 * manager gets separate answers. The staff directory and the university's
 * manager list stay tenant-wide, deliberately — a manager can see that a
 * colleague exists. Everything that reports an individual's WORK is bounded by
 * the roster.
 *
 * ── What was open ────────────────────────────────────────────────────────
 * `/api/activities` and `/api/instructors` narrowed a manager to their roster,
 * and the per-instructor routes did not. The boundary therefore held on the
 * list and disappeared the moment a caller knew an id, which made the list
 * narrowing decorative rather than real. A probe read a peer manager's
 * instructor four ways — profile, activities, worklog, metrics — and the
 * worklog and remarks are the instructor's own writing about their day.
 *
 * `/universities/:id/exceptions` was the fifth, and the worst of them: it
 * returned every instructor in the university with names and ids attached, so
 * it also supplied the ids every other boundary assumes a caller does not have.
 *
 * ── 404, not 403 ─────────────────────────────────────────────────────────
 * An off-roster id answers exactly as an unknown id does. 403 would confirm the
 * id names somebody real, which is the fact being withheld.
 *
 * ── Built to add, never to mutate ────────────────────────────────────────
 * The suite shares one database, so this file only creates its own people.
 * See the same note in `roster-write-boundary.test.ts`.
 */

const RUN = Math.random().toString(36).slice(2, 10);
const PW = "read-boundary-pw-1234";
/** Appears in this instructor's name, so a leak anywhere is greppable. */
const MARK = `READBOUNDARY${RUN}`;

let admin: ApiClient, seedManager: ApiClient;
let northId = "", theirInstructorId = "";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  seedManager = new ApiClient("seed-manager");
  northId = (await seedManager.login(ACCOUNTS.managerNorth)).user.universityId!;

  const otherManager = await admin.post(`/api/universities/${northId}/managers`, {
    email: `readb.mgr.${RUN}@example.edu`,
    name: `Read Boundary Manager ${RUN}`,
    password: PW,
  });
  expect(otherManager.status, JSON.stringify(otherManager.body)).toBe(201);

  const theirs = await admin.post("/api/instructors", {
    email: `readb.inst.${RUN}@example.edu`,
    name: `Victim ${MARK}`,
    password: PW,
    universityId: northId,
    managerId: otherManager.body.manager?.id ?? otherManager.body.id,
  });
  expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
  theirInstructorId = theirs.body.instructor.id;

  // Real work of their own, so "clean" below means withheld rather than absent.
  const planted = await admin.post(`/api/instructors/${theirInstructorId}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: "2026-08-11T04:30:00Z",
    endTime: "2026-08-11T06:30:00Z",
    remarks: `${MARK}-REMARK`,
  });
  expect(planted.status, JSON.stringify(planted.body)).toBe(201);
});

describe("a manager cannot read another manager's instructor's work", () => {
  test("not their profile", async () => {
    const res = await seedManager.get(`/api/instructors/${theirInstructorId}`);
    expect(res.status).toBe(404);
  });

  test("not their activities", async () => {
    const res = await seedManager.get(`/api/instructors/${theirInstructorId}/activities`);
    expect(res.status).toBe(404);
  });

  test("not their worklog", async () => {
    const res = await seedManager.get(
      `/api/instructors/${theirInstructorId}/worklog?date=2026-08-11`,
    );
    expect(res.status).toBe(404);
  });

  test("not their metrics", async () => {
    const res = await seedManager.get(`/api/instructors/${theirInstructorId}/metrics`);
    expect(res.status).toBe(404);
  });

  test("the exception list does not name them", async () => {
    // This one is not a 404 — it is a legitimate university-wide report that
    // must simply stop covering people the caller has no claim on. It was also
    // how a caller could LEARN an off-roster instructor's id.
    const res = await seedManager.get(
      `/api/universities/${northId}/exceptions?from=2026-08-01&to=2026-08-20`,
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(MARK);
  });

  test("nor does the university activity list", async () => {
    const res = await seedManager.get(`/api/universities/${northId}/activities`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(MARK);
  });
});

describe("but a manager still sees who works in their university", () => {
  test("the staff directory lists them", async () => {
    // Deliberate. "Who else works here" is a different question from "what did
    // they do", and only the second one is bounded by the roster.
    const res = await seedManager.get("/api/staff?limit=200");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(MARK);
  });

  test("the university's manager list includes their manager", async () => {
    const res = await seedManager.get(`/api/universities/${northId}/managers`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(`Read Boundary Manager ${RUN}`);
  });
});

describe("the instructor's own manager is unaffected", () => {
  test("the owning manager reads everything", async () => {
    const owner = new ApiClient("owning-manager");
    await owner.login(`readb.mgr.${RUN}@example.edu`, PW);
    expect((await owner.get(`/api/instructors/${theirInstructorId}`)).status).toBe(200);
    const acts = await owner.get(`/api/instructors/${theirInstructorId}/activities`);
    expect(acts.status).toBe(200);
    expect(JSON.stringify(acts.body)).toContain(`${MARK}-REMARK`);
  });
});
