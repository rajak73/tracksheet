"use client";

/**
 * The manager's roster: people down, periods across.
 *
 * ── Why this is the opposite of the instructor's sheet ────────────────────
 * An instructor reads one person over many days, so their periods run down the
 * page. A manager reads many people over the same period, so the PEOPLE run
 * down and the periods run across — one row per person, the way the client's
 * own monthly sheet is written. Turning it the other way would repeat every
 * name once per day and make two instructors impossible to compare on a line.
 *
 * ── The same numbers, computed the same way ───────────────────────────────
 * Every cell comes from `rollUp`, the function the instructor's own sheet
 * uses. A manager questioning a figure and the person who recorded it are
 * looking at one number rather than two that happen to agree.
 *
 * ── Read-only, deliberately ───────────────────────────────────────────────
 * No corrections and no remarks box. A manager filling in somebody else's
 * timesheet would make the record of who did what untrue, and the utilisation
 * figure the manager is themselves measured on is derived from that record.
 */

import { categoryColor } from "@/app/_components/charts";
import { formatDuration, type Activity } from "@/app/_components/workload";
import { rollUp } from "@/domain/rollup";

export type ManagerPeriod = {
  /** Every date this column covers. */
  dates: string[];
  /** "19 Aug" or "17 – 23 Aug" */
  label: string;
  /** "Wednesday" or "Week 4" */
  sublabel: string;
  isCurrent: boolean;
};

export type ManagerPerson = {
  instructorId: string;
  name: string;
  employeeCode: string | null;
  activitiesByDate: Record<string, Activity[]>;
  /**
   * What each OFFICE DAY was about, decided on the server.
   *
   * Not derivable here: a day with no class of its own inherits the subject of
   * the last office day that had one, and that day is often before the window
   * this sheet asked for. Absent dates are non-office days; a null value is a
   * day with nothing to inherit.
   */
  subjectByDate: Record<string, { code: string; label: string; carriedFrom: string | null } | null>;
  /** Their own remark per day, keyed by date. */
  notes: Record<string, string>;
};

/** The four things reported about a person in a period. */
const FIELDS = [
  { key: "deliverable", label: "Deliverable", align: "text-left" },
  { key: "quantity", label: "Deliverable Quantity", align: "text-right" },
  { key: "hours", label: "Working Hours", align: "text-right" },
  { key: "remarks", label: "Remarks", align: "text-left" },
] as const;

/* Fixed pixel widths, because `position: sticky` offsets have to be
 * arithmetic: the second column starts where the first ends. */
const IDENTITY = {
  name: "w-[224px] min-w-[224px]",
  code: "w-[128px] min-w-[128px]",
  category: "w-[168px] min-w-[168px]",
};

const HEAD = "bg-sunken text-xs font-semibold leading-snug text-muted";

/* Sticky ranks, per the layer scale in globals.css: the period header row is
 * the floor, the frozen identity columns sit above it, and the corner where the
 * two cross has to out-rank both. They were 20/30/40, which tied the corner
 * with the period picker's popover — the sheet comes later in the document, so
 * the calendar opened underneath it. Shifted down a step; the top of the
 * content range now belongs to popovers. */
const STICKY_ROW = "z-10";
const STICKY_COL = "z-20";
const STICKY_CORNER = "z-30";

export type SheetSort = "name" | "total-desc" | "total-asc";

/** The time this person spent with students across every period on screen. */
export function totalHours(person: ManagerPerson, periods: ManagerPeriod[]): number {
  return periods.reduce(
    (n, p) => n + rollUp(p.dates.flatMap((d) => person.activitiesByDate[d] ?? [])).hours,
    0,
  );
}

export function ManagerSheet({
  people,
  periods,
  sort,
  onSort,
}: {
  people: ManagerPerson[];
  /** Oldest first, so the columns read left to right like a calendar. */
  periods: ManagerPeriod[];
  sort: SheetSort;
  onSort: (next: SheetSort) => void;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-card border border-line bg-surface shadow-card">
      <table className="border-separate border-spacing-0 text-sm">
        <caption className="sr-only-text">
          Every instructor on your roster, with what they recorded in each period.
        </caption>

        <thead>
          {/* Two header rows: the period spans its four fields, and the fields
              are named underneath. That is the sheet the client already reads. */}
          <tr>
            <th
              scope="col"
              rowSpan={2}
              className={`${HEAD} ${IDENTITY.name} sticky left-0 top-0 ${STICKY_CORNER} border-b border-r border-line px-4 py-3 text-left`}
            >
              Employee Name
            </th>
            <th
              scope="col"
              rowSpan={2}
              className={`${HEAD} ${IDENTITY.code} sticky left-[224px] top-0 ${STICKY_CORNER} border-b border-r border-line px-3 py-3 text-left`}
            >
              Employee ID
            </th>
            <th
              scope="col"
              rowSpan={2}
              className={`${HEAD} ${IDENTITY.category} sticky left-[352px] top-0 ${STICKY_CORNER} border-b border-r border-line px-3 py-3 text-left`}
            >
              Broad Category
            </th>

            {periods.map((p) => (
              <th
                key={p.label}
                scope="colgroup"
                colSpan={FIELDS.length}
                className={`${HEAD} sticky top-0 ${STICKY_ROW} border-b border-l-2 border-line px-3 py-2.5 text-left ${
                  p.isCurrent ? "bg-primary-subtle" : ""
                }`}
              >
                {p.sublabel}
                <span className="tabular block font-normal text-subtle">{p.label}</span>
              </th>
            ))}

            {/* ── The total, last, and the one thing you can order by ────────
             * It is the figure a manager compares people on, so it sits at the
             * end of every row regardless of how many periods are on screen —
             * and clicking it sorts, because "who is buried this week" is the
             * question the column exists to answer. */}
            <th
              scope="col"
              rowSpan={2}
              /* `aria-sort` belongs on the column header, not on the button
                 inside it — the header is what is sorted. */
              aria-sort={
                sort === "total-desc" ? "descending" : sort === "total-asc" ? "ascending" : "none"
              }
              className={`${HEAD} sticky top-0 ${STICKY_ROW} min-w-[9rem] border-b border-l-2 border-line p-0 text-right align-bottom`}
            >
              <button
                type="button"
                onClick={() =>
                  onSort(sort === "total-desc" ? "total-asc" : sort === "total-asc" ? "name" : "total-desc")
                }
                className="flex h-full w-full items-end justify-end gap-1 px-3 py-3 text-right transition-colors hover:bg-hovered hover:text-content"
                title="Sort by total working hours"
              >
                Total Working Hours
                <span aria-hidden className="text-sm leading-none">
                  {sort === "total-desc" ? "\u25be" : sort === "total-asc" ? "\u25b4" : "\u21c5"}
                </span>
              </button>
            </th>
          </tr>
          <tr>
            {periods.flatMap((p) =>
              FIELDS.map((f, i) => (
                <th
                  key={`${p.label}:${f.key}`}
                  scope="col"
                  className={`${HEAD} sticky top-[3.75rem] ${STICKY_ROW} border-b px-3 py-2.5 font-normal ${
                    i === 0 ? "border-l-2 border-line" : "border-l border-line-subtle"
                  } ${f.align}`}
                >
                  {f.label}
                </th>
              )),
            )}
          </tr>
        </thead>

        <tbody>
          {people.map((person) => {
            /* Their subjects across the whole range: the column describes the
             * person here, where each cell already describes its own period.
             *
             * Read from `subjectByDate`, not from the entries. A day of
             * meetings names no subject — the parser correctly records none —
             * and the day inherits from the last office day that taught one. A
             * sheet built only from the entries in view cannot know that,
             * because the day it inherits from is often outside the window. */
            const subjects = [
              ...new Set(
                periods
                  .flatMap((p) => p.dates)
                  .map((d) => person.subjectByDate?.[d]?.label)
                  .filter((label): label is string => Boolean(label)),
              ),
            ];

            return (
              <tr key={person.instructorId} className="group transition-colors hover:bg-hovered">
                <th
                  scope="row"
                  className={`${IDENTITY.name} sticky left-0 ${STICKY_COL} border-b border-r border-line bg-surface px-4 py-4 text-left align-top font-normal transition-colors group-hover:bg-hovered`}
                >
                  <span className="block truncate font-medium text-content">{person.name}</span>
                </th>
                <td
                  className={`${IDENTITY.code} tabular sticky left-[224px] ${STICKY_COL} border-b border-r border-line bg-surface px-3 py-4 align-top text-content transition-colors group-hover:bg-hovered`}
                >
                  {person.employeeCode ?? "—"}
                </td>
                <td
                  className={`${IDENTITY.category} sticky left-[352px] ${STICKY_COL} border-b border-r border-line bg-surface px-3 py-4 align-top transition-colors group-hover:bg-hovered`}
                >
                  {subjects.length > 0 ? (
                    <span className="text-content">{subjects.join(", ")}</span>
                  ) : (
                    /* Not an em dash: this is a value the system will supply
                       once they have taught something, not one that does not
                       apply. */
                    <span className="text-subtle">Not yet determined</span>
                  )}
                </td>

                {periods.map((period) => (
                  <PeriodCells key={period.label} period={period} person={person} />
                ))}

                <td className="tabular border-b border-l-2 border-line px-3 py-4 text-right align-top text-base font-semibold text-content">
                  {formatDuration(totalHours(person, periods))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One person's four cells for one period. */
function PeriodCells({ period, person }: { period: ManagerPeriod; person: ManagerPerson }) {
  const activities = period.dates.flatMap((d) => person.activitiesByDate[d] ?? []);
  const { lines, hours, remarks } = rollUp(activities);

  // Their own note, when the column is a single day. A week has no one such
  // note, so it falls back to the topics the reader found in the sentences.
  const note = period.dates.length === 1 ? (person.notes[period.dates[0]!] ?? "") : "";

  const bg = period.isCurrent ? "bg-primary-subtle/25" : "";
  const cell = `border-b border-line px-3 py-4 align-top leading-relaxed ${bg}`;
  const empty = <span className="text-xs text-subtle">—</span>;

  if (activities.length === 0) {
    return (
      <>
        <td className={`${cell} min-w-[15rem] border-l-2 border-line`}>{empty}</td>
        <td className={`${cell} min-w-[11rem] border-l border-line-subtle text-right`}>{empty}</td>
        <td className={`${cell} min-w-[8rem] border-l border-line-subtle text-right`}>{empty}</td>
        <td className={`${cell} min-w-[12rem] border-l border-line-subtle`}>{empty}</td>
      </>
    );
  }

  const counted = lines.filter((l) => l.countable && l.quantity > 0);

  return (
    <>
      {/* "Lecture – 02h 00m; Meeting – 00h 45m" — everything with its hours.
          The muted ones do not count toward Working Hours. */}
      <td className={`${cell} min-w-[15rem] max-w-[20rem] border-l-2 border-line text-content`}>
        {lines.map((l, i) => (
          <span key={l.key} className={l.countable ? undefined : "text-muted"}>
            {i > 0 ? "; " : ""}
            <span
              aria-hidden
              className="mr-1 inline-block size-2 rounded-full align-middle"
              style={{
                background: categoryColor(activities[0]!.activityType.code),
                opacity: l.countable ? 1 : 0.45,
              }}
            />
            <span title={l.countable ? undefined : "Not counted in Working Hours"}>
              {l.label} – {formatDuration(l.hours)}
            </span>
          </span>
        ))}
      </td>

      <td className={`${cell} min-w-[11rem] max-w-[14rem] border-l border-line-subtle text-right text-content`}>
        {counted.length > 0
          ? counted.map((l) => `${l.quantity} ${l.label}`).join(", ")
          : empty}
      </td>

      <td
        className={`${cell} tabular min-w-[8rem] border-l border-line-subtle text-right font-semibold text-content`}
      >
        {formatDuration(hours)}
      </td>

      <td className={`${cell} min-w-[12rem] max-w-[16rem] border-l border-line-subtle`}>
        {note ? (
          <span className="text-content">{note}</span>
        ) : remarks.length > 0 ? (
          <span className="text-muted">{remarks.join(", ")}</span>
        ) : (
          empty
        )}
      </td>
    </>
  );
}
