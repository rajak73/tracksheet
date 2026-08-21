import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { daySubjectsFor, CARRY_FORWARD_OFFICE_DAYS } from "@/server/instructors/day-subject";
import { loadUniversityConfig } from "@/server/universities/config";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * A quiet day still knows what the instructor teaches.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * The subject of a day comes from the class taken that day. When no class was
 * taken — meetings, reporting, preparation — the parser correctly records no
 * subject, because the sentence names none. That day inherits from the last
 * office day that did name one, up to ten office days back.
 *
 * Northfield runs Monday to Friday, so a Monday inherits from the Friday
 * before it and the weekend costs nothing.
 */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

let admin: ApiClient;
let northId = "";
let subjectId: Record<string, string> = {};
let config: Awaited<ReturnType<typeof loadUniversityConfig>>;

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  const inst = new ApiClient("n1");
  northId = (await inst.login(ACCOUNTS.instructorNorth1)).user.universityId!;
  config = await loadUniversityConfig(northId);

  const rows = await prisma.instructorCategory.findMany({ select: { id: true, code: true } });
  subjectId = Object.fromEntries(rows.map((c) => [c.code, c.id]));
  // The three the client asked for, alongside their own four.
  for (const code of ["TECH", "MATH", "ENGLISH", "APTITUDE", "PHYSICS", "CHEMISTRY", "OTHERS"]) {
    expect(subjectId[code], `${code} should be provisioned`).toBeTruthy();
  }
});

async function newInstructor(tag: string): Promise<string> {
  const res = await admin.post("/api/instructors", {
    email: `carry.${tag}.${RUN}@example.edu`,
    name: `Carry ${tag} ${RUN}`,
    password: "carry-forward-pw-1234",
    universityId: northId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.instructor.id;
}

/** A class on `date` about `subjectCode` — or, with null, a day of work that names no subject. */
async function taught(instructorId: string, date: string, subjectCode: string | null, hours = 2) {
  const type = await prisma.activityType.findFirstOrThrow({ where: { code: "TEACHING" } });
  const start = new Date(`${date}T04:30:00.000Z`);
  await prisma.activityLog.create({
    data: {
      instructorId,
      universityId: northId,
      activityTypeId: type.id,
      broadCategoryId: subjectCode ? subjectId[subjectCode] : null,
      workDate: new Date(`${date}T00:00:00.000Z`),
      startTime: start,
      endTime: new Date(start.getTime() + hours * 3_600_000),
      status: "COMPLETED",
    },
  });
}

describe("a day with no class inherits the last one that had", () => {
  test("Monday inherits Friday's subject across the weekend", async () => {
    const id = await newInstructor("weekend");
    await taught(id, "2026-06-05", "PHYSICS"); // Friday
    await taught(id, "2026-06-08", null); // Monday: a day of admin work

    const days = (await daySubjectsFor([id], "2026-06-05", "2026-06-08", config)).get(id)!;
    expect(days.get("2026-06-05")).toMatchObject({ code: "PHYSICS", carriedFrom: null });
    expect(days.get("2026-06-08")).toMatchObject({ code: "PHYSICS", carriedFrom: "2026-06-05" });
  });

  test("a day that names its own subject does not inherit", async () => {
    const id = await newInstructor("own");
    await taught(id, "2026-06-05", "PHYSICS");
    await taught(id, "2026-06-08", "CHEMISTRY");

    const days = (await daySubjectsFor([id], "2026-06-08", "2026-06-08", config)).get(id)!;
    expect(days.get("2026-06-08")).toMatchObject({ code: "CHEMISTRY", carriedFrom: null });
  });

  test("the weekend itself carries nothing — it is not an office day", async () => {
    const id = await newInstructor("saturday");
    await taught(id, "2026-06-05", "TECH");

    const days = (await daySubjectsFor([id], "2026-06-05", "2026-06-08", config)).get(id)!;
    expect(days.has("2026-06-06"), "Saturday should not appear at all").toBe(false);
    expect(days.has("2026-06-07"), "Sunday should not appear at all").toBe(false);
  });

  test("inheritance stops after ten office days", async () => {
    const id = await newInstructor("stale");
    await taught(id, "2026-06-01", "APTITUDE"); // Monday

    const days = (await daySubjectsFor([id], "2026-06-01", "2026-07-03", config)).get(id)!;

    // The tenth office day after it still carries…
    const officeDays = [...days.keys()].sort();
    const taughtIndex = officeDays.indexOf("2026-06-01");
    const lastCarried = officeDays[taughtIndex + CARRY_FORWARD_OFFICE_DAYS];
    const firstStale = officeDays[taughtIndex + CARRY_FORWARD_OFFICE_DAYS + 1];

    expect(days.get(lastCarried), `${lastCarried} is ten office days on`).toMatchObject({
      code: "APTITUDE",
      carriedFrom: "2026-06-01",
    });
    // …and the eleventh is too far from the work to still describe them.
    expect(days.get(firstStale), `${firstStale} is eleven office days on`).toBeNull();
  });

  test("teaching again restarts the clock", async () => {
    const id = await newInstructor("restart");
    await taught(id, "2026-06-01", "APTITUDE");
    await taught(id, "2026-06-19", "MATH"); // well past the limit

    const days = (await daySubjectsFor([id], "2026-06-01", "2026-06-26", config)).get(id)!;
    expect(days.get("2026-06-19")).toMatchObject({ code: "MATH", carriedFrom: null });
    expect(days.get("2026-06-22"), "the Monday after").toMatchObject({
      code: "MATH",
      carriedFrom: "2026-06-19",
    });
  });
});

describe("when there is nothing to inherit", () => {
  test("an instructor who has never named a subject has no day subject", async () => {
    const id = await newInstructor("never");
    await taught(id, "2026-06-01", null);
    await taught(id, "2026-06-05", null);

    const days = (await daySubjectsFor([id], "2026-06-01", "2026-06-05", config)).get(id)!;
    expect([...days.values()].every((v) => v === null)).toBe(true);
  });

  test("days BEFORE their first class inherit nothing backwards", async () => {
    const id = await newInstructor("before");
    await taught(id, "2026-06-12", "ENGLISH"); // Friday

    const days = (await daySubjectsFor([id], "2026-06-08", "2026-06-12", config)).get(id)!;
    expect(days.get("2026-06-08"), "Monday, four days before they first taught").toBeNull();
    expect(days.get("2026-06-12")).toMatchObject({ code: "ENGLISH", carriedFrom: null });
  });
});

describe("the day's subject is the one they taught most", () => {
  test("hours decide, not the number of classes", async () => {
    const id = await newInstructor("dominant");
    await taught(id, "2026-06-05", "CHEMISTRY", 1);
    await taught(id, "2026-06-05", "PHYSICS", 4);

    const days = (await daySubjectsFor([id], "2026-06-05", "2026-06-05", config)).get(id)!;
    expect(days.get("2026-06-05")).toMatchObject({ code: "PHYSICS" });
  });
});
