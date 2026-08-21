import { beforeAll, describe, expect, test } from "vitest";
import {
  buildInstruction,
  fingerprintOf,
  validateModelGroups,
  type SourceRow,
} from "@/server/worklog/day-summary";
import { ApiClient, ACCOUNTS } from "./helpers/client";

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

const row = (id: string, minutes: number, quantity: number, text: string, remarks: string | null = null): SourceRow => ({
  id,
  minutes,
  quantity,
  text,
  remarks,
});

/** The day from the client's own example. */
const DAY: SourceRow[] = [
  row("a1", 120, 2, "took two live classes on binary trees"),
  row("a2", 90, 1, "prepared next week's lesson plan", "Next week's preparation completed"),
  row("a3", 45, 3, "doubt session with students"),
  row("a4", 120, 12, "checked assignments", "Binary trees covered"),
];

const valid = {
  groups: [
    { name: "Live Classes", quantityLabel: "Classes", sourceIds: ["a1"] },
    { name: "Lesson Preparation", quantityLabel: "Lesson Plan", sourceIds: ["a2"] },
    { name: "Doubt Sessions", quantityLabel: "Doubt Sessions", sourceIds: ["a3"] },
    { name: "Assignment Evaluation", quantityLabel: "Assignments", sourceIds: ["a4"] },
  ],
  remarks: ["Next week's preparation completed", "Binary trees covered"],
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
        { name: "Live Classes", quantityLabel: "Classes", sourceIds: ["a1", "a3"] },
        { name: "Lesson Preparation", quantityLabel: "Lesson Plans", sourceIds: ["a2"] },
        { name: "Assignment Evaluation", quantityLabel: "Assignments", sourceIds: ["a4"] },
      ],
      remarks: [],
    };
    expect(validateModelGroups(DAY, combined).ok).toBe(true);
  });
});

describe("nothing is invented", () => {
  test("an activity the day did not contain is refused", () => {
    const invented = {
      groups: [...valid.groups, { name: "Research Work", quantityLabel: "Papers", sourceIds: ["a9"] }],
      remarks: [],
    };
    const result = validateModelGroups(DAY, invented);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown line id/i);
  });

  test("counting one line under two names is refused", () => {
    // It would double that line's hours, which is the same harm as dropping it.
    const doubled = {
      groups: [
        ...valid.groups,
        { name: "Mentoring", quantityLabel: "Sessions", sourceIds: ["a1"] },
      ],
      remarks: [],
    };
    const result = validateModelGroups(DAY, doubled);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/two groups/i);
  });

  test("a remark carrying a number the day never mentioned is refused", () => {
    const result = validateModelGroups(DAY, {
      ...valid,
      remarks: ["Covered 47 assignments"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported number/i);
  });

  test("a remark reusing a number from the day is fine", () => {
    expect(
      validateModelGroups([row("a1", 60, 2, "took 2 classes", "2 classes went well")], {
        groups: [{ name: "Live Classes", quantityLabel: "Classes", sourceIds: ["a1"] }],
        remarks: ["2 classes went well"],
      }).ok,
    ).toBe(true);
  });

  test("markup is refused wherever it appears", () => {
    for (const bad of [
      { groups: [{ name: "<b>Classes</b>", quantityLabel: "Classes", sourceIds: DAY.map((r) => r.id) }], remarks: [] },
      { groups: [{ name: "Classes", quantityLabel: "<i>x</i>", sourceIds: DAY.map((r) => r.id) }], remarks: [] },
      { groups: [{ name: "Classes", quantityLabel: "Classes", sourceIds: DAY.map((r) => r.id) }], remarks: ["see http://example.com"] },
    ]) {
      expect(validateModelGroups(DAY, bad).ok, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
});

describe("a malformed reply is refused, never repaired", () => {
  test("the shapes a model gets wrong", () => {
    for (const bad of [
      null,
      "a sentence about the day",
      {},
      { groups: [] },
      { groups: valid.groups },
      { groups: [{ name: "", quantityLabel: "x", sourceIds: ["a1"] }], remarks: [] },
      { groups: [{ name: "Classes", quantityLabel: "x", sourceIds: [] }], remarks: [] },
      { groups: [{ name: "Classes", quantityLabel: "x", sourceIds: [7] }], remarks: [] },
    ]) {
      expect(validateModelGroups(DAY, bad).ok, JSON.stringify(bad)).toBe(false);
    }
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

  test("the model is told what it must never do, in order", () => {
    const instruction = buildInstruction(DAY);
    expect(instruction).toMatch(/EVERY id must appear EXACTLY ONCE/);
    expect(instruction).toMatch(/NEVER write an id that was not given to you/);
  });
});

describe("a summary goes stale when the day changes", () => {
  test("correcting a duration changes the fingerprint", () => {
    const before = fingerprintOf(DAY);
    const after = fingerprintOf([row("a1", 150, 2, "took two live classes on binary trees"), ...DAY.slice(1)]);
    expect(after).not.toBe(before);
  });

  test("the order the rows arrive in does not", () => {
    expect(fingerprintOf([...DAY].reverse())).toBe(fingerprintOf(DAY));
  });
});

/* ── The endpoint, with no model configured ────────────────────────────── */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

let admin: ApiClient, instructor: ApiClient, colleague: ApiClient;
let myId = "", theirId = "";
const DATE = "2026-03-10";

type Summary = {
  date: string;
  deliverables: Array<{ name: string; durationMinutes: number; quantity: number; quantityLabel: string }>;
  remarks: string[];
  totalMinutes: number;
  source: "ai" | "fallback";
};

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  instructor = new ApiClient("me");
  myId = (await instructor.login(ACCOUNTS.instructorNorth1)).user.instructorId!;
  colleague = new ApiClient("colleague");
  theirId = (await colleague.login(ACCOUNTS.instructorNorth2)).user.instructorId!;

  // The client's example day: 2h + 1h30 + 45m + 2h = 06h 15m.
  const day: Array<[string, number, number]> = [
    [`Live classes on binary trees ${RUN}`, 2, 2],
    [`Lesson preparation for next week ${RUN}`, 1.5, 1],
    [`Doubt session ${RUN}`, 0.75, 3],
    [`Assignment evaluation ${RUN}`, 2, 12],
  ];
  for (const [deliverable, workingHours, quantity] of day) {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: DATE,
      deliverable,
      quantity,
      workingHours,
      remarks: "Binary trees covered",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
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
    expect(
      day.deliverables.reduce((n, d) => n + d.durationMinutes, 0),
      "the lines must add up to the total, or time went missing",
    ).toBe(day.totalMinutes);
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
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: second,
      deliverable: `Live classes on binary trees ${RUN}`,
      quantity: 3,
      workingHours: 3,
      remarks: null,
    });
    expect(res.status).toBe(201);

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
