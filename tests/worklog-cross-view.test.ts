import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { buildPeriodRow, weekOf, weeksOfMonth, type RowActivity } from "@/domain/worklog-rows";
import {
  broadCategoryCell,
  deliverableCell,
  quantityCell,
  workingHours,
} from "@/domain/worklog-report";

/**
 * One instructor, one week, pulled through all six views.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 * `buildPeriodRow` exists so that two screens cannot disagree about the same
 * rows. That claim is only worth what it is checked against, and a unit test
 * feeding it a hand-built array checks the function, not the claim: the six
 * views differ in WHICH ACTIVITIES they hand it, and that is where a
 * disagreement would actually come from.
 *
 * So this builds one instructor's real week in the database and reads it back
 * through every path — the instructor's three, the manager's three — asserting
 * the same deliverable comes out with the same duration and the same quantity
 * every time. Not plausible. Identical.
 *
 * The week is deliberately awkward:
 *   Monday      a Live Class in Technical AND one in Mathematics — the merge
 *   Tuesday     an evaluation whose count nobody stated — the `?`
 *   Wednesday   nothing at all — missing, not future
 *   Thursday    a second Live Class, so the week's merge spans days too
 */

const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "x");

let admin: ApiClient, manager: ApiClient;
let northId = "", instructorId = "", managerId = "";

/* A settled week in the past, so "missing" and "future" are not a question of
 * when the suite happens to run. */
const MONDAY = (() => {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - 21);
  const iso = at.toISOString().slice(0, 10);
  return weekOf(iso)[0]!;
})();
const week = weekOf(MONDAY);
const [MON, TUE, WED, THU] = week as [string, string, string, string];
const MONTH = MONDAY.slice(0, 7);

async function log(
  date: string,
  deliverableCode: string,
  categoryCode: string,
  subject: string | null,
  startHour: number,
  hours: number,
  quantity: number | null,
  remarks: string | null = null,
) {
  const type = await prisma.activityType.findFirstOrThrow({ where: { code: categoryCode } });
  const deliverable = await prisma.deliverableType.findFirstOrThrow({
    where: { code: deliverableCode },
  });
  const subjectRow = subject
    ? await prisma.instructorCategory.findFirstOrThrow({ where: { code: subject } })
    : null;
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setUTCHours(startHour, 0, 0, 0);
  await prisma.activityLog.create({
    data: {
      instructorId,
      universityId: northId,
      activityTypeId: type.id,
      deliverableTypeId: deliverable.id,
      broadCategoryId: subjectRow?.id ?? null,
      workDate: new Date(`${date}T00:00:00.000Z`),
      startTime: start,
      endTime: new Date(start.getTime() + hours * 3_600_000),
      quantity,
      remarks,
      rawText: `${deliverableCode} ${RUN}`,
    },
  });
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  manager = new ApiClient("manager");
  const managerMe = await manager.login(ACCOUNTS.managerNorth);
  northId = managerMe.user.universityId!;
  managerId = (
    await prisma.manager.findFirstOrThrow({
      where: { userId: managerMe.user.id },
      select: { id: true },
    })
  ).id;

  const created = await admin.post("/api/instructors", {
    email: `crossview.${RUN}@example.edu`,
    name: `Cross View ${RUN}`,
    password: "cross-view-pw-123456",
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  instructorId = created.body.instructor.id;

  await admin.patch(`/api/instructors/${instructorId}`, { categoryCode: "ENGLISH" });
  await prisma.instructor.update({ where: { id: instructorId }, data: { managerId } });

  // Monday: the same deliverable under two different subjects.
  await log(MON, "LECTURE", "TEACHING", "TECH", 4, 2, 1, "binary trees");
  await log(MON, "CLASS_SESSION", "TEACHING", "MATH", 6, 1.5, 1, "binary trees");
  // Tuesday: a count nobody stated.
  await log(TUE, "ASSIGNMENT_EVALUATION", "ASSESSMENT", null, 4, 1, null);
  // Wednesday: deliberately nothing.
  // Thursday: another class, so the week's merge spans days as well as subjects.
  await log(THU, "LECTURE", "TEACHING", "TECH", 4, 1, 1, "section B");
  /* And one of each name that did not exist before Decisions 2-5, so they are
   * proved to render in a real view rather than only in a taxonomy test. */
  await log(THU, "LAB_EVALUATION", "PRACTICAL_LAB", null, 6, 1, null);
  await log(THU, "STUDENT_MEETING", "MEETING", null, 7, 0.5, 1);
  await log(THU, "DEPARTMENT_WORK", "ADMINISTRATIVE", null, 8, 1, null);
  await log(THU, "RESEARCH_ANALYSIS", "RESEARCH", null, 9, 1.5, null);
});

/** The instructor's rows, exactly as the page builds them. */
async function instructorActivities(from: string, to: string): Promise<RowActivity[]> {
  const res = await admin.get(
    `/api/activities?from=${from}&to=${to}&limit=200`,
  );
  expect(res.status).toBe(200);
  return res.body.activities
    .filter((a: { instructorId: string }) => a.instructorId === instructorId)
    .map((a: Record<string, never>) => ({
      workDate: String(a.workDate).slice(0, 10),
      durationHours: a.durationHours,
      remarks: a.remarks,
      status: a.status,
      startTime: a.startTime,
      activityType: a.activityType,
      deliverableType: a.deliverableType,
      broadCategory: a.broadCategory,
      quantity: a.quantity,
    })) as RowActivity[];
}

/** The manager's rows for the same person, from the manager's own endpoint. */
async function managerActivities(from: string, to: string): Promise<RowActivity[]> {
  const res = await manager.get(`/api/manager/worklog?from=${from}&to=${to}`);
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  const person = res.body.instructors.find(
    (i: { instructorId: string }) => i.instructorId === instructorId,
  );
  expect(person, "the instructor must be on the manager's roster").toBeTruthy();
  return (person.activities as Array<Record<string, never>>).map((a) => ({
    workDate: String(a.date).slice(0, 10),
    durationHours: a.durationHours,
    remarks: a.remarks,
    status: a.status,
    startTime: a.startTime,
    activityType: a.activityType,
    deliverableType: a.deliverableType,
    broadCategory: a.broadCategory,
    quantity: a.quantity,
  })) as RowActivity[];
}

const lineFor = (
  activities: RowActivity[],
  dates: string[],
  name: string,
) => {
  const row = buildPeriodRow({ key: "k", label: "l", dates, activities, today: MON });
  return row.lines.find((l) => l.name === name);
};

describe("Part C — the same deliverable, read six ways", () => {
  test("Live Class is identical in all six views", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const theirs = await managerActivities(MONDAY, week.at(-1)!);
    const monthDates = weeksOfMonth(MONTH).flatMap((w) => w.dates);
    const mineMonth = await instructorActivities(monthDates[0]!, monthDates.at(-1)!);

    /* Monday holds a Technical Live Class of 2h and a Mathematics one of 1h30,
     * which MERGE — one line, 3h 30m, 2 Classes. The week adds Thursday's, so
     * the week and month read 4h 30m and 3 Classes. */
    const readings = {
      "instructor day": lineFor(mine, [MON], "Live Class"),
      "manager day": lineFor(theirs, [MON], "Live Class"),
      "instructor week": lineFor(mine, week, "Live Class"),
      "manager week": lineFor(theirs, week, "Live Class"),
      "instructor month": lineFor(mineMonth, monthDates, "Live Class"),
    };

    // Printed, so the consistency claim is demonstrated rather than asserted.
    for (const [view, line] of Object.entries(readings)) {
      console.log(
        `  ${view.padEnd(18)} Live Class  ${String(line?.minutes ?? "-").padStart(4)}m  ` +
          `qty=${line?.quantity ?? "?"}`,
      );
    }

    expect(readings["instructor day"]!.minutes, "2h + 1h30, merged across subjects").toBe(210);
    expect(readings["manager day"]!.minutes, "the manager must see the same day").toBe(210);
    expect(readings["instructor day"]!.quantity).toBe(2);
    expect(readings["manager day"]!.quantity).toBe(2);

    expect(readings["instructor week"]!.minutes, "plus Thursday's hour").toBe(270);
    expect(readings["manager week"]!.minutes).toBe(270);
    expect(readings["instructor week"]!.quantity).toBe(3);
    expect(readings["manager week"]!.quantity).toBe(3);

    expect(readings["instructor month"]!.minutes).toBe(270);
  });

  test("and the manager's month spreadsheet agrees with all of them", async () => {
    const res = await manager.get(
      `/api/universities/${northId}/tracker?from=${MONDAY}&to=${week.at(-1)!}`,
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === instructorId,
    );
    expect(row, "the instructor must appear on the spreadsheet").toBeTruthy();

    const cells = Object.values(
      row.cells as Record<string, { deliverables: Array<{ title: string; minutes: number; quantity: number | null }> }>,
    );
    const liveClass = cells
      .flatMap((c) => c.deliverables)
      .filter((d) => d.title === "Live Class");
    const minutes = liveClass.reduce((n, d) => n + d.minutes, 0);
    const quantity = liveClass.reduce((n, d) => n + (d.quantity ?? 0), 0);

    console.log(`  ${"manager month".padEnd(18)} Live Class  ${String(minutes).padStart(4)}m  qty=${quantity}`);
    expect(minutes, "the same 4h 30m the other five views show").toBe(270);
    expect(quantity).toBe(3);
  });

  test("the formatted cells match too, character for character", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const theirs = await managerActivities(MONDAY, week.at(-1)!);
    const day = (a: RowActivity[]) =>
      buildPeriodRow({ key: "k", label: "l", dates: [MON], activities: a, today: MON });

    expect(deliverableCell(day(mine).lines)).toBe(deliverableCell(day(theirs).lines));
    expect(quantityCell(day(mine).lines)).toBe(quantityCell(day(theirs).lines));
    expect(workingHours(day(mine).totalMinutes)).toBe(workingHours(day(theirs).totalMinutes));
    console.log(`  formatted day cell: ${deliverableCell(day(mine).lines)}`);
    console.log(`  formatted quantity: ${quantityCell(day(mine).lines)}`);
  });
});

describe("Part C — the unstated count survives every view", () => {
  test("Tuesday's evaluation reads `?` for both roles", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const theirs = await managerActivities(MONDAY, week.at(-1)!);
    for (const [who, activities] of [["instructor", mine], ["manager", theirs]] as const) {
      const line = lineFor(activities, [TUE], "Assignment Evaluation");
      expect(line, `${who} should see Tuesday's evaluation`).toBeTruthy();
      expect(line!.quantity, `${who} must not invent a count`).toBeNull();
      expect(quantityCell([line!])).toBe("? Assignments");
    }
  });
});

describe("Part C — the missing day is missing, not blank and not future", () => {
  test("Wednesday reads as missing for both roles", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const theirs = await managerActivities(MONDAY, week.at(-1)!);
    for (const [who, activities] of [["instructor", mine], ["manager", theirs]] as const) {
      const row = buildPeriodRow({
        key: "k",
        label: "l",
        dates: [WED],
        activities,
        // Read from a vantage point after the week, which is the real case.
        today: new Date().toISOString().slice(0, 10),
      });
      expect(row.state, `${who} should see Wednesday as missing`).toBe("missing");
      expect(row.lines).toHaveLength(0);
    }
  });

  test("the days around it are not", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const today = new Date().toISOString().slice(0, 10);
    for (const date of [MON, TUE, THU]) {
      const row = buildPeriodRow({ key: "k", label: "l", dates: [date], activities: mine, today });
      expect(row.state, date).toBe("recorded");
    }
  });
});

describe("Part C — Broad Category holds under real data", () => {
  test("their assigned category is English and the column does not say so", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({ key: "k", label: "l", dates: week, activities: mine, today: MON });

    const detail = await admin.get(`/api/instructors/${instructorId}`);
    /* The assigned value still exists on the person's record; it is simply not
     * what any sheet prints. Broad Category is the work. */
    expect(detail.body.instructor.category.code, "assigned, and unprinted").toBe("ENGLISH");
    expect(row.subjects, "what they actually did").toEqual(["Technical", "Mathematics"]);
    expect(row.subjects, "never the assigned one").not.toContain("English");
    console.log(`  Assigned (not a column): English`);
    console.log(`  Broad Category         : ${broadCategoryCell(row.subjects)}`);
  });
});

describe("Part D — the four names added by Decisions 2-5 render in a real view", () => {
  test("each appears, under its own name, with the right quantity treatment", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({ key: "k", label: "l", dates: [THU], activities: mine, today: MON });
    const byName = new Map(row.lines.map((l) => [l.name, l]));

    const printed = deliverableCell(row.lines);
    const counts = quantityCell(row.lines);
    console.log(`  Deliverable: ${printed}`);
    console.log(`  Quantity   : ${counts}`);

    // Lab Evaluation: items, and nobody stated a count.
    expect(byName.get("Lab Evaluation")?.minutes).toBe(60);
    expect(byName.get("Lab Evaluation")?.quantity, "never invented").toBeNull();
    expect(counts).toContain("? Lab Evaluations");

    // Meeting (Other): an occurrence, and NOT a Department Meeting.
    expect(byName.get("Meeting (Other)")?.minutes).toBe(30);
    expect(counts).toContain("1 Meeting");
    expect(byName.has("Department Meeting"), "a student meeting is not governance").toBe(false);

    // Department Duties and Data Analysis: hours only, absent from the count.
    expect(byName.get("Department Duties")?.minutes).toBe(60);
    expect(byName.get("Data Analysis")?.minutes).toBe(90);
    expect(counts).not.toContain("Department Duties");
    expect(counts).not.toContain("Data Analysis");
    expect(printed).toContain("Department Duties - 1h");
    expect(printed).toContain("Data Analysis - 1h 30m");
  });

  test("the manager sees the same four", async () => {
    const theirs = await managerActivities(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({ key: "k", label: "l", dates: [THU], activities: theirs, today: MON });
    const names = new Set(row.lines.map((l) => l.name));
    for (const name of ["Lab Evaluation", "Meeting (Other)", "Department Duties", "Data Analysis"]) {
      expect(names.has(name), `the manager should see ${name}`).toBe(true);
    }
  });
});

describe("Part D — Remarks over a real multi-day period", () => {
  test("the week joins each day's, in date order, skipping the empty", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({ key: "k", label: "l", dates: week, activities: mine, today: MON });
    console.log(`  Week remarks: ${JSON.stringify(row.remarks)}`);

    /* Monday's two entries both said "binary trees" — de-duplicated to one.
     * Tuesday said nothing and is skipped rather than leaving an empty gap.
     * Thursday said "section B". Semicolons between days, commas within one. */
    expect(row.remarks).toBe("binary trees; section B");
  });

  test("a day note outranks the entries' own remarks on that day", async () => {
    const mine = await instructorActivities(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({
      key: "k",
      label: "l",
      dates: week,
      activities: mine,
      dayNotes: { [MON]: "wrote this about the whole day" },
      today: MON,
    });
    console.log(`  With a day note: ${JSON.stringify(row.remarks)}`);
    expect(row.remarks).toBe("wrote this about the whole day; section B");
  });
});
