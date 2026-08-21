import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { streamFor, STREAM_WINDOW_DAYS } from "@/server/instructors/stream";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * What an instructor teaches is counted, not filed.
 *
 * ── The change ────────────────────────────────────────────────────────────
 * `Instructor.categoryId` was an admin's choice from a dropdown. The client's
 * position is that a person's stream should follow the work they actually did,
 * so it is now read from their entries: the AI decides each line's subject, and
 * this adds those decisions up by hours.
 *
 * Counting rather than asking a model a second time is the point. It can be
 * shown to the client as hours, it cannot invent a subject nobody taught, and
 * it is testable — which is what this file is.
 */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

let admin: ApiClient;
let northId = "";
let subjectId: Record<string, string> = {};

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  const inst = new ApiClient("n1");
  northId = (await inst.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const categories = await prisma.instructorCategory.findMany({ select: { id: true, code: true } });
  subjectId = Object.fromEntries(categories.map((c) => [c.code, c.id]));
  expect(subjectId.TECH, "the seeded taxonomy should carry TECH").toBeTruthy();
});

async function newInstructor(tag: string): Promise<string> {
  const res = await admin.post("/api/instructors", {
    email: `stream.${tag}.${RUN}@example.edu`,
    name: `Stream ${tag} ${RUN}`,
    password: "instructor-stream-pw-1234",
    universityId: northId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.instructor.id;
}

/** An entry with a subject already decided, of a given length, N days ago. */
async function entry(
  instructorId: string,
  subjectCode: string | null,
  hours: number,
  daysAgo = 1,
  status: "COMPLETED" | "MISSED" | "EXCUSED" = "COMPLETED",
) {
  const type = await prisma.activityType.findFirstOrThrow({ where: { code: "TEACHING" } });
  const start = new Date(Date.now() - daysAgo * 86_400_000);
  start.setUTCHours(4, 0, 0, 0);
  await prisma.activityLog.create({
    data: {
      instructorId,
      universityId: northId,
      activityTypeId: type.id,
      broadCategoryId: subjectCode ? subjectId[subjectCode] : null,
      workDate: new Date(start.toISOString().slice(0, 10)),
      startTime: start,
      endTime: new Date(start.getTime() + hours * 3_600_000),
      status,
    },
  });
}

describe("the stream follows the work", () => {
  test("the subject with the most hours wins", async () => {
    const id = await newInstructor("dominant");
    await entry(id, "TECH", 6);
    await entry(id, "MATH", 2);
    expect(await streamFor(id)).toMatchObject({ code: "TECH" });
  });

  test("hours decide it, not the number of entries", async () => {
    const id = await newInstructor("byhours");
    // Three short English sessions against one long Technical one.
    await entry(id, "ENGLISH", 0.5, 1);
    await entry(id, "ENGLISH", 0.5, 2);
    await entry(id, "ENGLISH", 0.5, 3);
    await entry(id, "TECH", 4, 4);
    expect(
      await streamFor(id),
      "four hours of Technical outweighs ninety minutes of English across three rows",
    ).toMatchObject({ code: "TECH" });
  });

  test("an absence is not evidence", async () => {
    const id = await newInstructor("absent");
    await entry(id, "TECH", 2);
    await entry(id, "MATH", 8, 2, "MISSED");
    await entry(id, "MATH", 8, 3, "EXCUSED");
    expect(
      await streamFor(id),
      "sixteen hours of Mathematics that never happened must not outweigh two that did",
    ).toMatchObject({ code: "TECH" });
  });

  test("work older than the window no longer describes them", async () => {
    const id = await newInstructor("moved");
    await entry(id, "APTITUDE", 40, STREAM_WINDOW_DAYS + 10);
    await entry(id, "TECH", 3, 5);
    expect(
      await streamFor(id),
      "someone who moved streams should be described by what they teach now",
    ).toMatchObject({ code: "TECH" });
  });
});

describe("when there is nothing to read", () => {
  test("a new instructor has no stream", async () => {
    expect(await streamFor(await newInstructor("brandnew"))).toBeNull();
  });

  test("entries that name no subject give no stream", async () => {
    const id = await newInstructor("nosubject");
    await entry(id, null, 8);
    await entry(id, null, 8, 2);
    expect(
      await streamFor(id),
      "the parser returns null when a sentence names no subject; that is not a stream",
    ).toBeNull();
  });
});

describe("the report prints what was assigned, not what was taught", () => {
  /**
   * ── This replaces the opposite requirement, on the client's instruction ──
   * These cases used to assert that nobody could file a Broad Category by hand
   * and that the client's sheet followed the work somebody actually did. That
   * was built to the client's position at the time.
   *
   * Their rule now is the reverse, in their own words: the Broad Category is
   * "supplied", it must be "preserved exactly", and nobody may "guess the
   * employee's broad category from their activities".
   *
   * The derived stream is not deleted — it still answers, under its own name,
   * and the cases above still cover it. It simply no longer decides the column.
   */

  test("the derived stream and the assigned category are different answers", async () => {
    const id = await newInstructor("directory");
    await entry(id, "MATH", 5);

    const res = await admin.get(`/api/instructors/${id}`);
    expect(res.status).toBe(200);
    // Nobody has assigned one, and eight hours of Mathematics does not assign
    // one on their behalf.
    expect(res.body.instructor.category ?? null).toBeNull();
    expect(
      res.body.instructor.stream,
      "what they have been teaching is still known, under its own name",
    ).toMatchObject({ code: "MATH" });
  });

  test("an admin can assign it, and it is preserved exactly", async () => {
    const id = await newInstructor("assign");
    await entry(id, "MATH", 5);

    const res = await admin.patch(`/api/instructors/${id}`, { categoryCode: "ENGLISH" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.instructor.category).toMatchObject({ code: "ENGLISH" });

    const after = await admin.get(`/api/instructors/${id}`);
    expect(
      after.body.instructor.category,
      "English, though every hour they logged was Mathematics",
    ).toMatchObject({ code: "ENGLISH" });
    expect(
      after.body.instructor.stream,
      "and the derived stream still says what they actually taught",
    ).toMatchObject({ code: "MATH" });
  });

  test("assigning null clears it rather than reverting to a guess", async () => {
    const id = await newInstructor("clear");
    await entry(id, "MATH", 5);
    await admin.patch(`/api/instructors/${id}`, { categoryCode: "ENGLISH" });

    const res = await admin.patch(`/api/instructors/${id}`, { categoryCode: null });
    expect(res.status).toBe(200);

    const stored = await prisma.instructor.findUniqueOrThrow({
      where: { id },
      select: { categoryId: true },
    });
    expect(stored.categoryId, "'not decided yet' is a real answer").toBeNull();
  });

  test("a category nobody defined is refused, not stored", async () => {
    const id = await newInstructor("bogus");
    const res = await admin.patch(`/api/instructors/${id}`, { categoryCode: "ASTROPHYSICS" });
    expect(res.status).toBe(400);

    const stored = await prisma.instructor.findUniqueOrThrow({
      where: { id },
      select: { categoryId: true },
    });
    expect(stored.categoryId).toBeNull();
  });

  test("the client's monthly sheet prints the assigned category", async () => {
    const id = await newInstructor("tracker");
    await entry(id, "PHYSICS", 6);
    await admin.patch(`/api/instructors/${id}`, { categoryCode: "TECH" });

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const res = await admin.get(`/api/universities/${northId}/tracker?from=${from}&to=${today}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);

    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === id,
    );
    expect(row, "the instructor should appear in the tracker").toBeTruthy();
    expect(
      row.broadCategory,
      "the sheet prints what was supplied, not the Physics they logged",
    ).toMatchObject({ code: "TECH" });
  });

  test("the sheet leaves it unset rather than filling it in from the work", async () => {
    const id = await newInstructor("unassigned");
    await entry(id, "PHYSICS", 6);

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const res = await admin.get(`/api/universities/${northId}/tracker?from=${from}&to=${today}`);
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === id,
    );
    expect(
      row.broadCategory,
      "six hours of Physics must not become an assignment nobody made",
    ).toBeNull();
  });
});
