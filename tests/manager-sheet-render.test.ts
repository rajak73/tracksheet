import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ManagerSheet,
  totalHours,
  type ManagerPerson,
  type ManagerPeriod,
} from "@/app/_components/ManagerSheet";
import type { DayEntry } from "@/domain/worklog-day-rows";

/**
 * The manager's grid, asserted on what it RENDERS.
 *
 * ── Why rendered output rather than a green build ─────────────────────────
 * The tracker grid mirrored the server's types locally, compiled perfectly,
 * and rendered fields the server had stopped sending: a screen that
 * type-checks and shows nothing. The compiler cannot see a local type that has
 * drifted from its source.
 *
 * This is not hypothetical here. Before this commit, feeding `ManagerSheet`
 * exactly what `/api/manager/worklog` sends threw
 * `TypeError: Cannot read properties of undefined (reading 'code')` — `rollUp`
 * reaching for `activityType.code` on a payload that has carried no
 * `activityType` since the taxonomy was dropped. The build was clean the whole
 * time. Only rendering it said so.
 */

const TODAY = "2026-09-02";

function day(over: Partial<DayEntry> & { logDate: string }): DayEntry {
  return {
    id: `d-${over.logDate}`,
    deliverable: "Live class on recursion",
    deliverableQuantity: "1",
    workingHours: 6.5,
    remarks: null,
    source: "NATIVE",
    ...over,
  };
}

function person(over: Partial<ManagerPerson> = {}): ManagerPerson {
  return {
    instructorId: "i1",
    name: "Asha Rao",
    employeeCode: "NB-001",
    daysByDate: {},
    subjectByDate: {},
    notes: {},
    ...over,
  };
}

function render(people: ManagerPerson[], periods: ManagerPeriod[]): string {
  return renderToStaticMarkup(
    createElement(ManagerSheet, { people, periods, sort: "name", onSort: () => {}, today: TODAY }),
  );
}

const PAST: ManagerPeriod = { dates: ["2026-09-01"], label: "1 Sep", sublabel: "", isCurrent: false };

describe("the manager sheet renders the record", () => {
  test("a day's own words, quantity, hours and remarks all reach the screen", () => {
    const html = render(
      [
        person({
          daysByDate: {
            "2026-09-01": day({
              logDate: "2026-09-01",
              deliverable: "Investigate intermittent OAuth token expiry",
              deliverableQuantity: "1, 1, 12, 1, 1",
              workingHours: 6.5,
              remarks: "Ran over by twenty minutes",
            }),
          },
        }),
      ],
      [PAST],
    );

    expect(html).toContain("Asha Rao");
    // The instructor's words, not a re-description of them.
    expect(html).toContain("Investigate intermittent OAuth token expiry");
    expect(html).toContain("Ran over by twenty minutes");
    expect(html).toMatch(/6h\s*30m/);
  });

  test("a legacy quantity renders verbatim, not tidied", () => {
    const html = render(
      [
        person({
          daysByDate: {
            "2026-09-01": day({ logDate: "2026-09-01", deliverableQuantity: "1, 1, 12, 1, 1" }),
          },
        }),
      ],
      [PAST],
    );
    expect(html).toContain("1, 1, 12, 1, 1");
  });

  test("the three empty states stay apart", () => {
    const periods: ManagerPeriod[] = [
      { dates: ["2026-09-05"], label: "future", sublabel: "", isCurrent: false },
      { dates: ["2026-09-01"], label: "missing", sublabel: "", isCurrent: false },
      { dates: ["2026-08-31"], label: "zero", sublabel: "", isCurrent: false },
    ];
    const html = render(
      [
        person({
          daysByDate: {
            // Filed, and explicitly zero. Not the same as never filed.
            "2026-08-31": day({
              logDate: "2026-08-31",
              deliverable: "Office day, no teaching",
              workingHours: 0,
              deliverableQuantity: null,
            }),
          },
        }),
      ],
      periods,
    );

    /* Three cells, in period order: not yet reached, reached-and-unfiled,
     * filed-as-zero. Collapsing any two of them would tell a manager something
     * untrue about a person. */
    const cells = html.split("<td").slice(1);
    const future = cells.filter((c) => c.includes("border-l-2"))[0]!;
    const missing = cells.filter((c) => c.includes("border-l-2"))[1]!;

    expect(future, "a period nobody has reached says nothing").not.toContain("—");
    expect(missing, "a period reached and not filed states the absence").toContain("—");
    expect(html, "a day filed as zero shows the zero it recorded").toMatch(/0h/);
    expect(html).toContain("Office day, no teaching");
  });

  test("an instructor with no days at all still holds a row", () => {
    const html = render([person({ daysByDate: {} })], [PAST]);
    expect(html).toContain("Asha Rao");
    expect(totalHours(person({ daysByDate: {} }), [PAST])).toBe(0);
  });

  test("the total is the sum of the days, in minutes", () => {
    const p = person({
      daysByDate: {
        "2026-09-01": day({ logDate: "2026-09-01", workingHours: 6.5 }),
        "2026-09-02": day({ logDate: "2026-09-02", workingHours: 1.25 }),
      },
    });
    const periods: ManagerPeriod[] = [
      { dates: ["2026-09-01", "2026-09-02"], label: "1–2 Sep", sublabel: "", isCurrent: false },
    ];
    expect(totalHours(p, periods)).toBe(7.75);
    expect(render([p], periods)).toMatch(/7h\s*45m/);
  });
});
