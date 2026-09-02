import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { buildPeriodRow, type RowActivity } from "@/domain/worklog-rows";
import { weekOf } from "@/domain/periods";
import { workingHours } from "@/domain/worklog-report";
import { seedDays } from "./helpers/worklog";

/**
 * One instructor's real week, pulled back through the path the page uses.
 *
 * ── What this file was, and what it is now ────────────────────────────────
 * It pulled one week through all SIX views — the instructor's three and the
 * manager's three — and asserted the same deliverable came out with the same
 * duration and the same quantity every time. Not plausible. Identical.
 *
 * That claim cannot be made in this commit, and saying so is the point of this
 * paragraph. The instructor's views read `WorklogEntry`; the manager's still
 * read `ActivityLog`. Comparing them today would either fail for a reason that
 * is already known and scheduled, or — much worse — pass because both fixtures
 * were written and neither side noticed it was reading a different table. A
 * consistency test that cannot tell agreement from coincidence is worse than
 * no consistency test, because it is believed.
 *
 * So the six-view comparison is SUSPENDED, not quietly dropped: the `test.todo`
 * at the foot of this file names it, and it comes back when the manager's views
 * move onto the same table.
 *
 * ── What is still asserted, and is still worth asserting ──────────────────
 * `buildPeriodRow` is what both roles' tables are built from, and a unit test
 * feeding it a hand-built array checks the function rather than the claim. So
 * this still builds a real week in the database, reads it back through the
 * instructor's real endpoint, and holds it to what the screen shows: a missing
 * Wednesday reads as missing rather than blank or future, and a week's remarks
 * join in date order with a day note outranking the day's own.
 *
 * The week is deliberately awkward:
 *   Monday      a class, with a remark
 *   Tuesday     a day whose quantity nobody stated
 *   Wednesday   nothing at all — missing, not future
 *   Thursday    another class, so the week's roll-up spans days
 *
 * ── Four blocks were deleted rather than ported ───────────────────────────
 * "the same deliverable, read six ways", "the unstated count survives every
 * view", "Broad Category holds under real data", and "the four names added by
 * Decisions 2-5". Every one of them turned on a named deliverable type, a
 * broad category, or a numeric quantity that could be absent and print `?`.
 * None of those exist: a day carries free text, and a quantity is whatever
 * somebody typed. They could only have been ported by asserting something
 * else.
 */

const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "x");

let admin: ApiClient, instructor: ApiClient;
let northId = "", instructorId = "";

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

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  northId = (await probe.login(ACCOUNTS.managerNorth)).user.universityId!;

  const created = await admin.post("/api/instructors", {
    email: `crossview.${RUN}@example.edu`,
    name: `Cross View ${RUN}`,
    password: "cross-view-pw-123456",
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  instructorId = created.body.instructor.id;
  await admin.patch(`/api/instructors/${instructorId}`, { categoryCode: "ENGLISH" });

  instructor = new ApiClient("crossview-instructor");
  await instructor.login(`crossview.${RUN}@example.edu`, "cross-view-pw-123456");

  /* Written through the instructor's own route, so the fixture cannot be a
     shape the product could not produce. */
  await seedDays(instructor, instructorId, [
    { date: MON, deliverable: "Live Class - binary trees", quantity: "2 classes", workingHours: "3h 30m" },
    // A quantity nobody stated: the box was left empty, and stays empty.
    { date: TUE, deliverable: "Assignment evaluation", workingHours: "1h" },
    // Wednesday: deliberately nothing.
    { date: THU, deliverable: "Live Class - section B", quantity: "1 class", workingHours: "1h" },
  ]);

  /* Monday and Thursday carry remarks; Tuesday deliberately does not, so the
     week's join has an empty day to skip. Written as a correction rather than
     in the seed above, because that is also a save this route must survive. */
  await seedDays(instructor, instructorId, [
    {
      date: MON,
      deliverable: "Live Class - binary trees",
      quantity: "2 classes",
      workingHours: "3h 30m",
      remarks: "binary trees",
    },
    {
      date: THU,
      deliverable: "Live Class - section B",
      quantity: "1 class",
      workingHours: "1h",
      remarks: "section B",
    },
  ]);
});

/**
 * The instructor's rows, mapped exactly as the page maps them.
 *
 * One row per day, so there is no list of activities to reassemble — the day IS
 * the row, and the fields the report reads come straight off it.
 */
async function instructorDays(from: string, to: string): Promise<RowActivity[]> {
  const res = await instructor.get(`/api/activities?from=${from}&to=${to}&limit=200`);
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  type DayRow = {
    logDate: string;
    deliverable: string;
    deliverableQuantity: string | null;
    workingHours: number;
    remarks: string | null;
    status: string;
    instructorId: string;
  };
  return (res.body.days as DayRow[])
    .filter((d) => d.instructorId === instructorId)
    .map((d) => ({
      workDate: d.logDate,
      durationHours: d.workingHours,
      remarks: d.remarks,
      status: d.status,
      startTime: `${d.logDate}T00:00:00.000Z`,
      activityType: { code: "WORK", label: "Work" },
      deliverableType: null,
      broadCategory: null,
      quantity: null,
      rawText: d.deliverable,
      rawQuantity: d.deliverableQuantity,
      rawWorkingHours: workingHours(d.workingHours * 60),
    })) as unknown as RowActivity[];
}

describe("the week reads back as it was written", () => {
  test("each day carries its own text, verbatim", async () => {
    const days = await instructorDays(MONDAY, week.at(-1)!);
    const byDate = new Map(days.map((d) => [d.workDate, d]));

    expect(byDate.get(MON)?.rawText).toBe("Live Class - binary trees");
    expect(byDate.get(TUE)?.rawText).toBe("Assignment evaluation");
    expect(byDate.get(THU)?.rawText).toBe("Live Class - section B");
    // Wednesday was never written and must not have appeared from anywhere.
    expect(byDate.has(WED)).toBe(false);
  });

  test("a quantity nobody stated is empty, not a question mark", async () => {
    /* The old model printed "? Assignments" — it knew the deliverable had a
       countable unit and that the count was missing. There is no unit to name
       now: the box was left empty and that is the whole of what is known. */
    const days = await instructorDays(MONDAY, week.at(-1)!);
    const tuesday = days.find((d) => d.workDate === TUE);
    expect(tuesday).toBeTruthy();
    expect(tuesday!.rawQuantity ?? "").toBe("");
  });

  test("the hours are the hours that were typed", async () => {
    const days = await instructorDays(MONDAY, week.at(-1)!);
    const byDate = new Map(days.map((d) => [d.workDate, d]));
    expect(byDate.get(MON)?.durationHours).toBe(3.5);
    expect(byDate.get(TUE)?.durationHours).toBe(1);
    expect(byDate.get(THU)?.durationHours).toBe(1);
  });
});

describe("the missing day is missing, not blank and not future", () => {
  test("Wednesday reads as missing", async () => {
    const days = await instructorDays(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({
      key: "k",
      label: "l",
      dates: [WED],
      activities: days,
      // Read from a vantage point after the week, which is the real case.
      today: new Date().toISOString().slice(0, 10),
    });
    expect(row.state).toBe("missing");
    expect(row.lines).toHaveLength(0);
  });

  test("the days around it are not", async () => {
    const days = await instructorDays(MONDAY, week.at(-1)!);
    const today = new Date().toISOString().slice(0, 10);
    for (const date of [MON, TUE, THU]) {
      const row = buildPeriodRow({ key: "k", label: "l", dates: [date], activities: days, today });
      expect(row.state, date).toBe("recorded");
    }
  });
});

describe("Remarks over a real multi-day period", () => {
  test("the week joins each day's, in date order, skipping the empty", async () => {
    const days = await instructorDays(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({ key: "k", label: "l", dates: week, activities: days, today: MON });

    /* Monday said "binary trees". Tuesday said nothing and is skipped rather
       than leaving an empty gap. Thursday said "section B". */
    expect(row.remarks).toBe("binary trees; section B");
  });

  test("a day note outranks the day's own remark", async () => {
    const days = await instructorDays(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({
      key: "k",
      label: "l",
      dates: week,
      activities: days,
      dayNotes: { [MON]: "wrote this about the whole day" },
      today: MON,
    });
    expect(row.remarks).toBe("wrote this about the whole day; section B");
  });
});

describe("the week's total is the sum of its days", () => {
  test("and it is the same figure the table's footer prints", async () => {
    const days = await instructorDays(MONDAY, week.at(-1)!);
    const row = buildPeriodRow({ key: "k", label: "l", dates: week, activities: days, today: MON });
    // 3.5 + 1 + 1, in minutes, formatted the one way the report formats hours.
    expect(row.totalMinutes).toBe(330);
    expect(workingHours(row.totalMinutes)).toBe(workingHours(330));
  });
});

/* Suspended until the manager's views read `WorklogEntry` — see the note at the
   top of this file. It is a `todo` rather than a deleted block so that the day
   the analytics commit lands, the suite says out loud what is owed. */
test.todo(
  "the same week, read through the manager's three views, is identical to the instructor's",
);
