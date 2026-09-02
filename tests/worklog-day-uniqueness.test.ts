import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { RUN } from "./helpers/fixtures";
/**
 * A day exists once, and the database is what guarantees it.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 * `worklog-replace-rollback.test.ts` defended a rollback: the old writer emptied
 * a day and then wrote it back, so a rewrite where every line was refused could
 * leave the day gone. The rollback restored it.
 *
 * There is no longer a window to lose a day in. A save is an upsert against a
 * unique `(instructorId, logDate)`, so a second save REPLACES the first because
 * there is nowhere else for it to go — and a save that fails validation never
 * reaches the write at all. The bug that file guarded against is not prevented
 * now; it is unrepresentable.
 *
 * So that file is deleted rather than ported, and what remains worth asserting
 * is the constraint itself. One test does that, which is all a structural
 * guarantee needs.
 *
 * Its other assertion is gone by design too: "20h would run past midnight" was a
 * consequence of laying activities on a clock from the university's opening.
 * There are no clock positions any more, so there is no midnight to run past —
 * only the day's own 24-hour ceiling, which the route checks.
 */

const PASSWORD = "day-uniqueness-password-1234";

let admin: ApiClient;
let instructor: ApiClient;
let myId = "";
let universityId = "";

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const email = `day.unique.${RUN}@fixture.test`;
  const created = await admin.post("/api/instructors", {
    email,
    name: `Day Unique ${RUN}`,
    password: PASSWORD,
    universityId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  myId = created.body.instructor.id;

  instructor = new ApiClient("instructor");
  await instructor.login(email, PASSWORD);
});

describe("one row per instructor per day", () => {
  /* Part 9, item 21. */
  test("a second row for the same day is refused by the database", async () => {
    await prisma.worklogEntry.deleteMany({ where: { instructorId: myId } });

    const day = { instructorId: myId, universityId, logDate: toDateOnly(TODAY) };
    await prisma.worklogEntry.create({
      data: { ...day, deliverable: "The first row", workingHours: 4 },
    });

    /* Not "the writer refuses" — the DATABASE refuses. A guarantee enforced by
       application code is a guarantee only while every path remembers it. */
    await expect(
      prisma.worklogEntry.create({
        data: { ...day, deliverable: "A second row for the same day", workingHours: 4 },
      }),
    ).rejects.toThrow();

    const rows = await prisma.worklogEntry.count({ where: { instructorId: myId } });
    expect(rows).toBe(1);
  });

  test("saving the same day twice replaces it rather than adding to it", async () => {
    await prisma.worklogEntry.deleteMany({ where: { instructorId: myId } });

    const first = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: TODAY,
      deliverable: "Java class - inheritance",
      quantity: "2 classes",
      workingHours: "6h",
      remarks: "the original",
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    /* No `replace` flag. Under the old writer its absence is what silently
       doubled a corrected day; here there is no flag to forget. */
    const second = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: TODAY,
      deliverable: "Java class - collections",
      quantity: "1 class",
      workingHours: "8",
      remarks: "the correction",
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    const rows = await prisma.worklogEntry.findMany({ where: { instructorId: myId } });
    expect(rows.length, "a correction must replace the day, not add to it").toBe(1);
    expect(rows[0]!.deliverable).toBe("Java class - collections");
    expect(Number(rows[0]!.workingHours)).toBe(8);
    expect(rows[0]!.remarks).toBe("the correction");
  });

  test("free text survives the round trip untouched", async () => {
    await prisma.worklogEntry.deleteMany({ where: { instructorId: myId } });

    /* Junk is data. The quantity box takes whatever describes the work, and a
       value nobody can parse is still what somebody wrote. */
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: TODAY,
      deliverable: "Lab supervision",
      quantity: "gfddgh",
      workingHours: "6 hours 30 minutes",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const row = await prisma.worklogEntry.findFirstOrThrow({ where: { instructorId: myId } });
    expect(row.deliverableQuantity, "quantity is stored verbatim, never parsed").toBe("gfddgh");
    expect(Number(row.workingHours), "a sentence is still a length of time").toBe(6.5);
  });
});
