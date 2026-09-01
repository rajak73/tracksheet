import { beforeAll, describe, expect, test } from "vitest";
import {
  buildInstruction,
  fingerprintOf,
  validateModelGroups,
  workedMinutes,
  type SourceRow,
} from "@/server/worklog/day-summary";
import { DELIVERABLES, deliverableFor, deliverableNamed } from "@/domain/worklog-taxonomy";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";

/**
 * Turning a day's record into a report, without losing any of it.
 *
 * ── What the model is allowed to decide ───────────────────────────────────
 * Names, quantity labels, and the wording of remarks. Nothing else. It is never
 * asked for a duration, a quantity or a total — it is asked which source lines
 * each name covers, and every figure is summed from those lines afterwards.
 *
 * That turns the client's requirements into arithmetic rather than trust:
 *
 *   nothing dropped     every source id must appear exactly once
 *   nothing invented    an id not in the source is a rejection
 *   totals match        the total is summed from the source, never read from the reply
 *
 * ── Why nothing below asserts WHICH reader answered ───────────────────────
 * These cases used to require `source: "fallback"`, on the reasoning that no
 * provider was configured under test. That was true by accident rather than by
 * design — the provider was reachable the whole time, and every call was
 * failing for an unrelated reason since fixed. The assertion was therefore
 * testing an outage, and would flip to failing the moment the outage ended.
 *
 * So the figures are asserted and the source is not. That is the honest test in
 * any case: the whole design of this module is that the numbers do not depend
 * on whether the model answered, and a test that only holds in one of the two
 * states is not testing that design — it is testing which state we happen to be
 * in today.
 */

/**
 * A source line, laid on the day end to end unless a position is given.
 *
 * The clock positions matter now: Working Hours is the measure of the union of
 * these intervals, not their sum, so where a line sits decides what the day
 * totals. Laying them consecutively by default keeps every case that is not
 * about overlap reading exactly as it did.
 */
let nextStart = 9 * 60;
const row = (
  id: string,
  minutes: number,
  quantity: number,
  text: string,
  remarks: string | null = null,
  at?: number,
): SourceRow => {
  const startMinute = at ?? nextStart;
  nextStart = Math.max(nextStart, startMinute + minutes);
  return {
    id,
    minutes,
    quantity,
    text,
    remarks,
    startMinute,
    endMinute: startMinute + minutes,
    deliverable: deliverableFor(null, "OTHER"),
  };
};

/** The day from the client's own example. */
const DAY: SourceRow[] = [
  row("a1", 120, 2, "took two live classes on binary trees"),
  row("a2", 90, 1, "prepared next week's lesson plan", "Next week's preparation completed"),
  row("a3", 45, 3, "doubt session with students"),
  row("a4", 120, 12, "checked assignments", "Binary trees covered"),
];

const valid = {
  groups: [
    { name: "Live Class", sourceIds: ["a1"] },
    { name: "Course Material Development", sourceIds: ["a2"] },
    { name: "Doubt Clearing", sourceIds: ["a3"] },
    { name: "Assignment Evaluation", sourceIds: ["a4"] },
  ],
  remark: "Binary trees covered and next week's preparation completed",
};

describe("nothing is dropped", () => {
  test("a reply that leaves out an activity is refused", () => {
    // The department meeting simply never appears — the failure the client is
    // most worried about, and the one a reader cannot detect by eye.
    const dropped = {
      ...valid,
      groups: valid.groups.slice(0, 3),
    };
    const result = validateModelGroups(DAY, dropped);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing/i);
  });

  test("a reply covering every line is accepted", () => {
    expect(validateModelGroups(DAY, valid).ok).toBe(true);
  });

  test("combining two similar activities is allowed", () => {
    const combined = {
      groups: [
        { name: "Live Class", sourceIds: ["a1", "a3"] },
        { name: "Course Material Development", sourceIds: ["a2"] },
        { name: "Assignment Evaluation", sourceIds: ["a4"] },
      ],
      remark: "",
    };
    expect(validateModelGroups(DAY, combined).ok).toBe(true);
  });
});

describe("nothing is invented", () => {
  test("an activity the day did not contain is refused", () => {
    const invented = {
      groups: [...valid.groups, { name: "Documentation", sourceIds: ["a9"] }],
      remark: "",
    };
    const result = validateModelGroups(DAY, invented);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown line id/i);
  });

  test("counting one line under two names is refused", () => {
    // It would double that line's hours, which is the same harm as dropping it.
    const doubled = {
      groups: [...valid.groups, { name: "Academic Guidance", sourceIds: ["a1"] }],
      remark: "",
    };
    const result = validateModelGroups(DAY, doubled);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/two groups/i);
  });

  test("a remark carrying a number the day never mentioned is refused", () => {
    const result = validateModelGroups(DAY, {
      ...valid,
      remark: "Covered 47 assignments",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported number/i);
  });

  test("a remark reusing a number from the day is fine", () => {
    expect(
      validateModelGroups([row("a1", 60, 2, "took 2 classes", "2 classes went well")], {
        groups: [{ name: "Live Class", sourceIds: ["a1"] }],
        remark: "2 classes went well",
      }).ok,
    ).toBe(true);
  });

  test("a name outside the client's list is refused", () => {
    /* The whole point of the closed list. "Live Classes" is a perfectly
       sensible thing to call it and it is not what the client's sheet says —
       and the sheet GROUPS by this column, so a plural today and a singular
       tomorrow is two rows where there should be one. */
    for (const name of ["Live Classes", "Doubt Session", "Research Work", "Teaching", "Student Mentoring"]) {
      const result = validateModelGroups(DAY, {
        groups: [{ name, sourceIds: DAY.map((r) => r.id) }],
        remark: "",
      });
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/not one of the report's deliverable names/i);
    }
  });

  test("every name the client listed is accepted", () => {
    for (const deliverable of DELIVERABLES) {
      const result = validateModelGroups(DAY, {
        groups: [{ name: deliverable.name, sourceIds: DAY.map((r) => r.id) }],
        remark: "",
      });
      expect(result.ok, deliverable.name).toBe(true);
    }
  });

  test("markup cannot reach the remark", () => {
    const result = validateModelGroups(DAY, { ...valid, remark: "see http://example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/markup/i);
  });
});

describe("a malformed reply is refused, never repaired", () => {
  test("the shapes a model gets wrong", () => {
    for (const bad of [
      null,
      "a sentence about the day",
      {},
      { groups: [] },
      { groups: [{ name: "", sourceIds: ["a1"] }], remark: "" },
      { groups: [{ name: "Live Class", sourceIds: [] }], remark: "" },
      { groups: [{ name: "Live Class", sourceIds: [7] }], remark: "" },
      // A remark that is not a sentence at all.
      { groups: valid.groups, remark: { text: "hello" } },
    ]) {
      expect(validateModelGroups(DAY, bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("a day with nothing worth remarking on is not malformed", () => {
    // An empty Remarks cell is honest. Refusing the reply would throw away a
    // correct grouping to punish an absent sentence.
    expect(validateModelGroups(DAY, { groups: valid.groups }).ok).toBe(true);
    expect(validateModelGroups(DAY, { groups: valid.groups, remark: "" }).ok).toBe(true);
  });
});

describe("what is sent to the provider", () => {
  test("the day's lines go, and nothing that says whose they are", () => {
    const instruction = buildInstruction(DAY);
    expect(instruction).toContain("took two live classes on binary trees");
    // Opaque ids, so the reply can be matched back without the request ever
    // carrying a name, an employee number or a university.
    expect(instruction).toContain("id=a1");
    for (const field of ["instructorName", "employeeCode", "universityId", "@"]) {
      expect(instruction, `${field} must not be sent`).not.toContain(field);
    }
  });

  test("every name the prompt offers is a name the validator accepts", () => {
    /* ── The prompt and the validator are one list, or they are a silent bug ──
     * The prompt told the model to fall back to "Administrative Work" — a name
     * left over from an earlier vocabulary and not on the client's list. The
     * validator would have refused every reply that took that instruction, and
     * refusal is indistinguishable from a provider outage: the report falls back
     * to deterministic text, nothing errors, nothing is logged, and the feature
     * is quietly off. Both sides read `DELIVERABLES` now, and this fails if they
     * ever stop. */
    const instruction = buildInstruction(DAY);
    const offered = [...instruction.matchAll(/^\s+- (.+)$/gm)].map((m) => m[1]!.trim());

    expect(offered.length, "the whole closed list is offered").toBe(DELIVERABLES.length);
    for (const name of offered) {
      const result = validateModelGroups(DAY, {
        groups: [{ name, sourceIds: DAY.map((r) => r.id) }],
        remark: "",
      });
      expect(result.ok, `the prompt offers "${name}" but the validator refuses it`).toBe(true);
    }
  });

  test("the fallback the prompt names is one the validator accepts", () => {
    const named = buildInstruction(DAY).match(/well, use "([^"]+)"/)?.[1];
    expect(named, "the prompt must name a fallback").toBeTruthy();
    expect(deliverableNamed(named!), `"${named}" is not on the client's list`).not.toBeNull();
  });

  test("the model is told what it must never do, in order", () => {
    const instruction = buildInstruction(DAY);
    expect(instruction).toMatch(/EVERY id must appear EXACTLY ONCE/);
    expect(instruction).toMatch(/NEVER write an id that was not given to you/);
  });
});

describe("a summary goes stale when the day changes", () => {
  test("correcting a duration changes the fingerprint", () => {
    const before = fingerprintOf(DAY);
    const after = fingerprintOf([
      row("a1", 150, 2, "took two live classes on binary trees", null, 9 * 60),
      ...DAY.slice(1),
    ]);
    expect(after).not.toBe(before);
  });

  test("the order the rows arrive in does not", () => {
    expect(fingerprintOf([...DAY].reverse())).toBe(fingerprintOf(DAY));
  });
});

describe("Working Hours is measured, never summed", () => {
  const at = (id: string, startMinute: number, minutes: number): SourceRow =>
    row(id, minutes, 1, `work ${id}`, null, startMinute);

  test("a day laid end to end totals its parts", () => {
    // 09:00-11:00, 11:00-11:45, 13:00-14:00 — a gap in the middle, and the gap
    // is not work.
    const rows = [at("a", 540, 120), at("b", 660, 45), at("c", 780, 60)];
    expect(workedMinutes(rows)).toEqual({ total: 225, overlapped: 0 });
  });

  test("an idle gap is never counted", () => {
    // Class ends 11:00, doubts start 11:15. The client's own example: those
    // fifteen minutes are not Working Hours.
    const rows = [at("a", 540, 120), at("b", 675, 45)];
    expect(workedMinutes(rows).total, "2h + 45m, and not the quarter hour between").toBe(165);
  });

  test("overlapping time is counted once, not twice", () => {
    // 09:00-11:00 and 10:30-11:30. Two and a half hours of day, not three.
    const rows = [at("a", 540, 120), at("b", 630, 60)];
    expect(workedMinutes(rows)).toEqual({ total: 150, overlapped: 30 });
  });

  test("an activity wholly inside another adds nothing", () => {
    const rows = [at("a", 540, 180), at("b", 600, 30)];
    expect(workedMinutes(rows)).toEqual({ total: 180, overlapped: 30 });
  });

  test("three overlapping activities do not treble anything", () => {
    const rows = [at("a", 540, 120), at("b", 600, 120), at("c", 660, 120)];
    // 09:00 through 13:00 is four hours; the three sum to six.
    expect(workedMinutes(rows)).toEqual({ total: 240, overlapped: 120 });
  });

  test("touching activities join without inventing a minute", () => {
    const rows = [at("a", 540, 60), at("b", 600, 60)];
    expect(workedMinutes(rows)).toEqual({ total: 120, overlapped: 0 });
  });

  test("a day is never padded towards eight hours", () => {
    const rows = [at("a", 540, 45)];
    expect(workedMinutes(rows).total, "45 minutes is a 45-minute day").toBe(45);
  });

  test("the order the rows arrive in does not change the measure", () => {
    const rows = [at("a", 540, 120), at("b", 630, 60), at("c", 780, 30)];
    expect(workedMinutes([...rows].reverse())).toEqual(workedMinutes(rows));
  });
});

/* ── The endpoint ──────────────────────────────────────────────────────── */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

let admin: ApiClient, instructor: ApiClient, colleague: ApiClient;
let myId = "", theirId = "";
/** Captured in `beforeAll` — the seed helper writes the tenant column itself. */
let universityId = "";
const DATE = "2026-03-10";

type Summary = {
  date: string;
  deliverables: Array<{ name: string; durationMinutes: number; quantity: number; quantityLabel: string }>;
  remark: string;
  totalMinutes: number;
  overlapMinutes: number;
  source: "ai" | "fallback";
};

/**
 * Seeds `ActivityLog` directly, because that is what `summariseDays` reads.
 *
 * These used to post to the entry route. That route now writes `WorklogEntry`,
 * so seeding through it left this module with nothing to summarise — thirty-seven
 * tests failing for a reason unrelated to anything they assert.
 *
 * Writing the table under test directly is the honest fixture while the two
 * models coexist. `day-summary` is replaced by the extraction pipeline and this
 * file goes with it; until then it covers a module six API routes still reach.
 *
 * Laid end to end from 09:00 so a day of several activities has the clock shape
 * the overlap arithmetic here is written about.
 */
async function seedDay(
  instructorId: string,
  universityId: string,
  date: string,
  lines: Array<{ deliverable: string; hours: number; quantity?: unknown; remarks?: string | null }>,
) {
  const activityType = await prisma.activityType.findFirstOrThrow({ select: { id: true } });
  await prisma.activityLog.deleteMany({
    where: { instructorId, workDate: toDateOnly(date) },
  });

  let minute = 9 * 60;
  for (const line of lines) {
    const start = new Date(`${date}T00:00:00.000Z`);
    start.setUTCMinutes(minute);
    const end = new Date(start.getTime() + line.hours * 3_600_000);
    minute += Math.round(line.hours * 60);

    await prisma.activityLog.create({
      data: {
        instructorId,
        universityId,
        activityTypeId: activityType.id,
        workDate: toDateOnly(date),
        startTime: start,
        endTime: end,
        rawText: line.deliverable,
        rawQuantity:
          line.quantity === undefined || line.quantity === null ? null : String(line.quantity),
        /* The INTEGER as well as the text. `summariseDays` sums this column, so
           a fixture that wrote only the verbatim string left every activity on
           the schema default of 1 — and the test that counts quantities failed
           against a fixture, not against the code it exists to check. */
        quantity:
          line.quantity === undefined || line.quantity === null
            ? null
            : Number.isFinite(Number(line.quantity))
              ? Number(line.quantity)
              : null,
        remarks: line.remarks ?? null,
      },
    });
  }
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  instructor = new ApiClient("me");
  const me = await instructor.login(ACCOUNTS.instructorNorth1);
  myId = me.user.instructorId!;
  universityId = me.user.universityId!;
  colleague = new ApiClient("colleague");
  theirId = (await colleague.login(ACCOUNTS.instructorNorth2)).user.instructorId!;

  // The client's example day: 2h + 1h30 + 45m + 2h = 06h 15m.
  const day: Array<[string, number, number]> = [
    [`Live classes on binary trees ${RUN}`, 2, 2],
    [`Lesson preparation for next week ${RUN}`, 1.5, 1],
    [`Doubt session ${RUN}`, 0.75, 3],
    [`Assignment evaluation ${RUN}`, 2, 12],
  ];
  /* Written as ADMIN, not as the instructor.
   *
   * An instructor may only record TODAY — the rule the narrative box always
   * enforced, now applied to the quick-entry routes it had never covered. The
   * fixed past date matters to this file (every assertion below is about a
   * summary over a known span), and an admin recording on somebody's behalf is
   * the escape hatch that rule explicitly points at, so the WRITER moves rather
   * than the date. Who may write is `worklog-quick-entry.test.ts`'s subject;
   * this file's is what the summary makes of a day once it exists. */
  await seedDay(
    myId,
    universityId,
    DATE,
    day.map(([deliverable, workingHours, quantity]) => ({
      deliverable,
      hours: Number(workingHours),
      quantity,
      remarks: "Binary trees covered",
    })),
  );
});

async function summaryFor(client: ApiClient, instructorId: string, date = DATE) {
  const res = await client.get(
    `/api/instructors/${instructorId}/worklog/summary?from=${date}&to=${date}`,
  );
  return res;
}

describe("the report is built without the model", () => {
  test("a day of four activities comes back as one summarised day", async () => {
    const res = await summaryFor(instructor, myId);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);

    const day: Summary = res.body.days[DATE];
    expect(day, "the day should have a summary").toBeTruthy();
    /* Either reader is a pass. The deterministic one must work on its own — the
     * client requires the report to survive an outage — and the model one must
     * produce the same figures. Which of them answered is a fact about the
     * provider this minute, not about this code. */
    expect(["ai", "fallback"]).toContain(day.source);
    expect(day.deliverables.length, "one line per kind of work").toBeGreaterThan(0);
  });

  test("every activity's time is accounted for", async () => {
    const day: Summary = (await summaryFor(instructor, myId)).body.days[DATE];
    // 120 + 90 + 45 + 120
    expect(day.totalMinutes, "06h 15m, to the minute").toBe(375);
    expect(day.overlapMinutes, "entries are laid end to end, so none is claimed twice").toBe(0);
    expect(
      day.deliverables.reduce((n, d) => n + d.durationMinutes, 0),
      "with no overlap the lines must add up to the total, or time went missing",
    ).toBe(day.totalMinutes);
  });

  test("every line is named in the words the client's sheet uses", async () => {
    const day: Summary = (await summaryFor(instructor, myId)).body.days[DATE];
    const allowed = new Set(DELIVERABLES.map((d) => d.name));
    for (const line of day.deliverables) {
      expect(allowed.has(line.name), `"${line.name}" is not one of the client's names`).toBe(true);
    }
  });

  test("the quantity unit belongs to the activity, not to the number", async () => {
    const day: Summary = (await summaryFor(instructor, myId)).body.days[DATE];
    for (const line of day.deliverables) {
      const deliverable = DELIVERABLES.find((d) => d.name === line.name)!;
      expect([deliverable.unit, deliverable.units]).toContain(line.quantityLabel);
    }
  });

  test("quantities come from the record, not from anywhere else", async () => {
    const day: Summary = (await summaryFor(instructor, myId)).body.days[DATE];
    // 2 + 1 + 3 + 12
    expect(day.deliverables.reduce((n, d) => n + d.quantity, 0)).toBe(18);
  });

  test("nothing about the employee travels with the summary", async () => {
    const day: Summary = (await summaryFor(instructor, myId)).body.days[DATE];
    const text = JSON.stringify(day);
    // Name, employee id and category are taken from the record by the table, so
    // a summary can never disagree with the database about who it describes.
    for (const field of ["instructorName", "employeeCode", "instructorId", "broadCategory"]) {
      expect(text, `${field} must not be in the summary`).not.toContain(field);
    }
  });

  test("a day with nothing recorded has no row at all", async () => {
    const res = await summaryFor(instructor, myId, "2026-03-11");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.days)).toHaveLength(0);
  });
});

describe("adding up a week", () => {
  test("the days sum to the week, activity by activity", async () => {
    const second = "2026-03-11";
    // Admin, for the same reason as the fixture above.
    await seedDay(myId, universityId, second, [
      { deliverable: `Live classes on binary trees ${RUN}`, hours: 3, quantity: 3 },
    ]);

    const week = await instructor.get(
      `/api/instructors/${myId}/worklog/summary?from=2026-03-09&to=2026-03-15`,
    );
    expect(week.status).toBe(200);

    const days: Summary[] = Object.values(week.body.days);
    expect(days.length, "two days recorded in that week").toBe(2);
    expect(
      days.reduce((n, d) => n + d.totalMinutes, 0),
      "375 on the first day plus 180 on the second",
    ).toBe(555);
  });
});

describe("it is their own report", () => {
  test("an instructor cannot summarise a colleague's days", async () => {
    const res = await summaryFor(instructor, theirId);
    expect([403, 404]).toContain(res.status);
  });

  test("a malformed date is refused rather than answered", async () => {
    const res = await instructor.get(
      `/api/instructors/${myId}/worklog/summary?from=2026-02-31&to=2026-02-31`,
    );
    expect(res.status).toBe(400);
  });

  test("an admin may read it", async () => {
    expect((await summaryFor(admin, myId)).status).toBe(200);
  });
});
