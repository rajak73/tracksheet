import { beforeAll, describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { daysAgo, seedDayRow } from "./helpers/worklog";
import { ActivityRows, emptyRow, rollMinutes, toSubmitted, totalRowMinutes } from "@/app/_components/ActivityRows";
import { parseActivities } from "@/domain/worklog-activities";
import { checkExtraction } from "@/server/insights/extraction-checks";

/**
 * Activity rows: the pairing is authored, so nothing downstream guesses it.
 *
 * The two-box form produced "1, 1, 12, 1, 4, 1, 1, 1, 6" beside nine
 * descriptions, and one real day with five descriptions against four numbers.
 * A quantity now lives on its own row, which is what permanently closes that.
 */

const admin = new ApiClient("rows-admin");
const instructor = new ApiClient("rows-instructor");
let instructorId = "";
let universityId = "";
let today = "";

beforeAll(async () => {
  await admin.login(ACCOUNTS.admin);
  const me = await instructor.login(ACCOUNTS.instructorNorth1);
  instructorId = me.user.instructorId!;
  universityId = me.user.universityId!;
  today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
});

const save = (body: unknown) =>
  instructor.post(`/api/instructors/${instructorId}/worklog/entry`, body);

const stored = () =>
  prisma.worklogEntry.findUniqueOrThrow({
    where: { instructorId_logDate: { instructorId, logDate: toDateOnly(today) } },
  });

describe("the form's own arithmetic", () => {
  test("1. it opens with exactly one empty row", () => {
    const html = renderToStaticMarkup(
      createElement(ActivityRows, { rows: [emptyRow()], onChange: () => {} }),
    );
    // One body row. The header row carries a class, so it is matched separately.
    expect(html.match(/<tr[ >]/g) ?? []).toHaveLength(2);
    expect(html.match(/data-row-id/g) ?? [], "four fields on the one row").toHaveLength(4);
    expect(html).toContain("Working Hours");
  });

  test("10. ninety minutes rolls into an hour and thirty", () => {
    const rolled = rollMinutes({ ...emptyRow(), hr: "", min: "90" });
    expect(rolled.hr).toBe("1");
    expect(rolled.min).toBe("30");
  });

  test("7. blank Hr and Min read as zero", () => {
    expect(rollMinutes({ ...emptyRow(), hr: "", min: "" })).toMatchObject({ hr: "0", min: "0" });
    expect(totalRowMinutes([{ ...emptyRow(), description: "x", hr: "", min: "" }])).toBe(0);
  });

  test("11. Working Hours is the sum of the rows", () => {
    expect(
      totalRowMinutes([
        { ...emptyRow(), description: "a", hr: "3", min: "30" },
        { ...emptyRow(), description: "b", hr: "1", min: "0" },
      ]),
    ).toBe(270);
  });

  test("8. blank Quantity is null on the wire, never zero", () => {
    const [row] = toSubmitted([{ ...emptyRow(), description: "Department meeting", hr: "1" }]);
    /* Blank and zero are different facts: a meeting has no count, while 0 would
       claim zero of something happened. */
    expect(row!.quantity).toBeNull();
    const [counted] = toSubmitted([{ ...emptyRow(), description: "Live class", quantity: "0" }]);
    expect(counted!.quantity, "an explicit zero survives as zero").toBe(0);
  });
});

describe("what the server stores", () => {
  test("15 & 16. three rows store three entries, and the sheet's columns derive from them", async () => {
    const res = await save({
      date: today,
      activities: [
        { description: "Live class on binary search", quantity: 2, hr: 3, min: 30 },
        { description: "Doubt clearing session", quantity: 1, hr: 1, min: 0 },
        { description: "Department meeting", quantity: null, hr: 0, min: 30 },
      ],
      remarks: "NA",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const row = await stored();
    const rows = parseActivities(row.activities)!;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.description)).toEqual([
      "Live class on binary search",
      "Doubt clearing session",
      "Department meeting",
    ]);
    expect(rows.map((r) => r.minutes)).toEqual([210, 60, 30]);
    expect(rows[2]!.quantity, "not counted stays not counted").toBeNull();

    // Derived, not stored twice — the client's sheet still has both columns.
    expect(row.deliverable).toBe(
      "Live class on binary search\nDoubt clearing session\nDepartment meeting",
    );
    expect(row.deliverableQuantity, "blanks are skipped, not printed").toBe("2, 1");
    expect(row.workingMinutes).toBe(300);
  });

  test("12. a client-submitted Working Hours is ignored", async () => {
    /* THE one that would be skipped. A calculated field the client can override
       is not calculated, and a total the rows do not support is exactly the
       kind of number that gets believed. */
    const res = await save({
      date: today,
      activities: [{ description: "Live class", quantity: 1, hr: 2, min: 0 }],
      workingHours: "23h 59m",
      remarks: "NA",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await stored();
    expect(row.workingMinutes, "the rows say two hours, and the rows decide").toBe(120);
  });

  test("13. numbers with no description are refused", async () => {
    const res = await save({
      date: today,
      activities: [
        { description: "Live class", quantity: 1, hr: 1, min: 0 },
        { description: "  ", quantity: 4, hr: 0, min: 0 },
      ],
      remarks: "NA",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("no description");
  });

  test("14. a description with nothing else saves", async () => {
    const res = await save({
      date: today,
      activities: [{ description: "Read the OAuth spec", quantity: null, hr: 0, min: 0 }],
      remarks: "NA",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await stored();
    expect(row.workingMinutes).toBe(0);
    expect(row.deliverableQuantity).toBeNull();
  });

  test("ninety minutes is rolled server-side too, whatever the client sent", async () => {
    const res = await save({
      date: today,
      activities: [{ description: "Lab session", quantity: null, hr: 0, min: 90 }],
      remarks: "NA",
    });
    expect(res.status).toBe(201);
    expect((await stored()).workingMinutes).toBe(90);
  });
});

describe("legacy days are left alone", () => {
  test("17. a row with no activities keeps its own text columns", async () => {
    const date = daysAgo(9);
    await seedDayRow({
      instructorId,
      universityId,
      date,
      deliverable: "live class on binary tree, doubt class, office meeting",
      workingMinutes: 375,
    });
    const row = await prisma.worklogEntry.findUniqueOrThrow({
      where: { instructorId_logDate: { instructorId, logDate: toDateOnly(date) } },
    });
    expect(parseActivities(row.activities), "nothing backfilled it").toBeNull();
    expect(row.deliverable).toBe("live class on binary tree, doubt class, office meeting");
  });

  test("20. a legacy day still runs all six checks", () => {
    /* The numbers there were never paired with anything, so provenance still
       has a question to answer and still answers it. */
    /* TWO activities, which is what makes the quantity box unattributable: with
       one there is nothing to disambiguate and the box plainly refers to it. */
    const legacy = checkExtraction(
      [
        { label: "live class on binary tree", subtopic: null, topic: null, sessions: 1, duration_value: null, duration_unit: null },
        { label: "doubt class", subtopic: null, topic: null, sessions: 1, duration_value: null, duration_unit: null },
      ],
      {
        deliverable: "live class on binary tree, doubt class",
        deliverableQuantity: "1, 1",
        workingMinutes: 375,
        activities: null,
      },
    );
    expect(legacy.ok).toBe(true);
    expect(legacy.ok && legacy.nulled, "neither count could be attributed").toHaveLength(2);
    expect(legacy.ok && legacy.nulled.every((n) => n.reason === "elsewhere")).toBe(true);
  });

  test("18 & 19. an authored day takes its numbers from the rows and reconciles to nothing", () => {
    const authored = checkExtraction(
      [{ label: "Live class", subtopic: "binary search", topic: "DSA", sessions: 2, duration_value: 210, duration_unit: "minutes" }],
      {
        deliverable: "Live class on binary search",
        deliverableQuantity: "2",
        workingMinutes: 210,
        activities: [{ description: "Live class on binary search", quantity: 2, minutes: 210 }],
      },
    );
    expect(authored.ok, JSON.stringify(authored)).toBe(true);
    if (!authored.ok) return;
    // Nothing was attributed, so nothing was nulled and nothing is unallocated.
    expect(authored.nulled).toEqual([]);
    expect(authored.unallocatedMinutes).toBe(0);
    expect(authored.activities[0]!.sessions).toBe(2);
  });

  test("a fabricated activity is still refused on an authored day", () => {
    const bad = checkExtraction(
      [{ label: "Capstone review", subtopic: null, topic: null, sessions: 1, duration_value: 60, duration_unit: "minutes" }],
      {
        deliverable: "Live class on binary search",
        deliverableQuantity: null,
        workingMinutes: 60,
        activities: [{ description: "Live class on binary search", quantity: 1, minutes: 60 }],
      },
    );
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.failures.some((f) => f.check === 5)).toBe(true);
  });
});
