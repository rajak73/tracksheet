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

import { useEffect, useRef, useState } from "react";
import { compactDuration, suppliedOr } from "@/domain/worklog-report";
import { formatDuration } from "@/app/_components/workload";
import { buildDayRow, type DayEntry } from "@/domain/worklog-day-rows";
import { DayInsightCell } from "@/app/_components/DayInsightCell";

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
  /**
   * One row per date — the day as it is stored, nothing interpreted.
   *
   * This was `activitiesByDate: Record<string, Activity[]>`, a list of clock
   * ranges each carrying a category and a parsed quantity. None of those
   * survive: a day is one row now, so a date maps to one entry or to nothing.
   */
  daysByDate: Record<string, DayEntry>;
  /**
   * What each OFFICE DAY was about, decided on the server.
   *
   * Not derivable here: a day with no class of its own inherits the subject of
   * the last office day that had one, and that day is often before the window
   * this sheet asked for. Absent dates are non-office days; a null value is a
   * day with nothing to inherit.
   */
  /** What each office day was about. Shown in the day view, never in the column. */
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
/* ── Only the NAME is frozen ──────────────────────────────────────────────
 * Employee ID and Total Working Hours used to be pinned too,
 * which spent 656px — a third of a laptop screen — on columns that repeat the
 * same few values down every row. What a reader needs while scrolling a
 * fortnight sideways is WHOSE row this is; the rest is reference they can
 * scroll back to. The widths stay, so the columns keep their shape; only the
 * pinning is gone. */
const IDENTITY = {
  name: "w-[224px] min-w-[224px]",
  code: "w-[128px] min-w-[128px]",
  total: "w-[144px] min-w-[144px]",
};

/* Carries no background: every header cell picks its own, because the current
 * period takes a stronger one and two `bg-*` utilities on one cell is not a
 * layering — `background-color` is a single property, so one silently replaces
 * the other and which one wins is down to stylesheet order. */
const HEAD = "text-[11px] font-semibold uppercase leading-snug tracking-wide text-primary-text";

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
/* `worstInsight` and its severity ranking are gone.
 *
 * It picked the most severe day a row covered, out of readings that graded each
 * day LOW to CRITICAL from its utilisation. There are no grades any more: the
 * scorer that produced them, the titles it chose from and the advice it
 * attached to a named person were deleted together. A day's insight is a
 * sentence about the work, generated for whoever opens that day, and it ranks
 * nobody — so there is nothing for a row to take the worst of.
 */

export function totalHours(person: ManagerPerson, periods: ManagerPeriod[]): number {
  /* Summed in minutes and converted once, for the reason `buildDayRow` gives:
     summing hours already rounded to two places and adding them back up drifts
     against the figure each cell prints. */
  const minutes = periods.reduce(
    (n, p) =>
      n +
      p.dates.reduce((m, d) => {
        const day = person.daysByDate[d];
        return m + (day ? day.workingMinutes : 0);
      }, 0),
    0,
  );
  return minutes / 60;
}

export function ManagerSheet({
  people,
  periods,
  sort,
  onSort,
  today,
}: {
  people: ManagerPerson[];
  /** Oldest first, so the columns read left to right like a calendar. */
  periods: ManagerPeriod[];
  sort: SheetSort;
  onSort: (next: SheetSort) => void;
  /**
   * YYYY-MM-DD in the university's zone.
   *
   * Needed to tell a period nobody has reached yet from one nobody filed. The
   * grid cannot derive it: the browser's own date is the READER's zone, and a
   * manager in another country would otherwise see a column blank out a day
   * early or late.
   */
  today: string;
}) {
  /* ── Where the second header row pins ──────────────────────────────────
   * Directly under the first, and the only reliable answer to "how tall is the
   * first" is the first. The offset was hard-coded at 3.75rem, a guess the row
   * does not actually render at — it comes out near 54px, six short of the 60
   * it was pinned below, and those six pixels were a band of the sheet visible
   * BETWEEN the two stuck rows as it scrolled past.
   *
   * Measured rather than corrected to 54px, because the number is not a
   * constant: it moves with the type scale, and with any period label long
   * enough to wrap. */
  const periodRow = useRef<HTMLTableRowElement>(null);
  const [periodRowHeight, setPeriodRowHeight] = useState(0);

  useEffect(() => {
    const row = periodRow.current;
    if (!row) return;
    const measure = () => setPeriodRowHeight(row.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="max-h-[70vh] overflow-auto rounded-card border border-line bg-surface shadow-card">
      <table className="border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only-text">
          Every instructor on your roster, with what they recorded in each period.
        </caption>

        <thead>
          {/* Two header rows: the period spans its four fields, and the fields
              are named underneath. That is the sheet the client already reads. */}
          <tr ref={periodRow}>
            <th
              scope="col"
              rowSpan={2}
              className={`${HEAD} bg-primary-subtle ${IDENTITY.name} sticky left-0 top-0 ${STICKY_CORNER} border-b border-r border-line px-3 py-2 text-left`}
            >
              Employee Name
            </th>
            <th
              scope="col"
              rowSpan={2}
              className={`${HEAD} bg-primary-subtle ${IDENTITY.code} sticky top-0 ${STICKY_ROW} border-b border-r border-line px-3 py-2 text-left`}
            >
              Employee ID
            </th>

            {/* ── The total, PINNED with the identity block ─────────────────
             * It is the figure a manager compares people on, and it used to sit
             * at the far right — past four columns for every period on screen,
             * so on a week it was three screens of horizontal scrolling away
             * from the name it belonged to. Scrolling to read it lost sight of
             * everything else; scrolling back lost the figure.
             *
             * It is now the fourth frozen column, so name, id, category and
             * total all stay put while the periods move under them.
             * `left-[512px]` is 224 + 128 + 160 — the three widths before it,
             * which is why those are fixed pixels rather than content-sized.
             *
             * Clicking still sorts, because "who is buried this week" is the
             * question the column exists to answer. */}
            <th
              scope="col"
              rowSpan={2}
              /* `aria-sort` belongs on the column header, not on the button
                 inside it — the header is what is sorted. */
              aria-sort={
                sort === "total-desc" ? "descending" : sort === "total-asc" ? "ascending" : "none"
              }
              className={`${HEAD} ${IDENTITY.total} bg-primary-subtle sticky top-0 ${STICKY_ROW} border-b border-r-2 border-line p-0 text-right align-bottom`}
            >
              <button
                type="button"
                onClick={() =>
                  onSort(sort === "total-desc" ? "total-asc" : sort === "total-asc" ? "name" : "total-desc")
                }
                className="flex h-full w-full items-end justify-end gap-1 px-3 py-2 text-right text-primary-text transition-colors hover:bg-primary/10"
                title="Sort by total working hours"
              >
                Total Working Hours
                <span aria-hidden className="text-sm leading-none">
                  {sort === "total-desc" ? "\u25be" : sort === "total-asc" ? "\u25b4" : "\u21c5"}
                </span>
              </button>
            </th>

            {periods.map((p) => (
              <th
                key={p.label}
                scope="colgroup"
                colSpan={FIELDS.length}
                className={`${HEAD} sticky top-0 ${STICKY_ROW} border-b border-l-2 border-line px-3 py-2.5 text-left ${
                  // A stronger step of the same blue, so "current" reads as
                  // more saturated rather than as a second, competing colour.
                  // Opaque, not an alpha — see the token's own note.
                  p.isCurrent ? "bg-primary-subtle-strong" : "bg-primary-subtle"
                }`}
              >
                {/* The label travels with its own group.
                  *
                  * This cell spans four columns, so scrolling into the middle
                  * of a day pushed "Tuesday 25 Aug" off the left edge and left
                  * a blank blue band above columns nobody could name any more.
                  *
                  * Sticky at the right edge of the frozen block, which is
                  * now the name column alone (224px) — so the label parks there
                  * while any part of its day is in view, then leaves with the
                  * last of its columns.
                  * Sticky is bounded by its containing block, which is this
                  * cell, so it cannot wander over the next day's header. */}
                <span className="sticky left-[224px] inline-block align-top">
                  {p.sublabel}
                  <span className="tabular block font-normal text-primary-text">{p.label}</span>
                </span>
              </th>
            ))}

            {/* ── The reading, last ────────────────────────────────────────
              * Past every period column, at the far end of the row: the reader
              * arrives having already passed all the hours it describes.
              *
              * `rowSpan={2}` because the period headers above split into field
              * columns below and this one does not — it is a single column, not
              * a group, so it occupies both header rows itself. */}
            <th
              scope="col"
              rowSpan={2}
              className={`${HEAD} bg-primary-subtle sticky top-0 ${STICKY_ROW} min-w-[16rem] border-b border-l-2 border-line px-3 py-2 text-left align-bottom`}
            >
              AI Insight
            </th>
          </tr>
          <tr>
            {periods.flatMap((p) =>
              FIELDS.map((f, i) => (
                <th
                  key={`${p.label}:${f.key}`}
                  scope="col"
                  /* Undefined until the row above has been measured, which
                     leaves the cell sticky with no offset — so it scrolls
                     for one frame rather than sticking at zero and landing
                     on top of the row it belongs under. */
                  style={{ top: periodRowHeight || undefined }}
                  className={`${HEAD} bg-primary-subtle sticky ${STICKY_ROW} border-b border-line px-3 py-2.5 font-normal ${
                    i === 0 ? "border-l-2" : "border-l border-line-subtle"
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
            return (
              <tr key={person.instructorId} className="group transition-colors hover:bg-hovered">
                <th
                  scope="row"
                  className={`${IDENTITY.name} sticky left-0 ${STICKY_COL} border-b border-r border-line bg-surface px-3 py-2 text-left align-top font-normal transition-colors group-hover:bg-hovered`}
                >
                  <span className="block truncate font-medium text-content">{person.name}</span>
                </th>
                <td
                  className={`${IDENTITY.code} tabular border-b border-r border-line bg-surface px-3 py-2 align-top text-content transition-colors group-hover:bg-hovered`}
                >
                  {suppliedOr(person.employeeCode)}
                </td>

                {/* Frozen with the three identity cells above it, so the
                    figure and the name it belongs to are never on different
                    screens. `bg-surface` is not optional here: a sticky cell
                    paints over what it passes, and a transparent one would let
                    the period columns scroll through it. */}
                <td
                  className={`${IDENTITY.total} tabular border-b border-r-2 border-line bg-surface px-3 py-2 text-right align-top text-[13px] font-semibold text-content transition-colors group-hover:bg-hovered`}
                >
                  {formatDuration(totalHours(person, periods))}
                </td>

                {periods.map((period) => (
                  <PeriodCells key={period.label} period={period} person={person} today={today} />
                ))}

                <td className="border-b border-l-2 border-line px-3 py-2 align-top">
                  {/* Read-only, and empty until somebody opens the day itself.
                      A manager's day insight is READ_ONLY in the generation
                      matrix — a sheet rendering a column must not be able to
                      start paying for it, and a fortnight of rows scrolled past
                      would otherwise buy a fortnight of insights. */}
                  <DayInsightCell
                    instructorId={person.instructorId}
                    scope="WEEK"
                    from={periods[0]?.dates[0] ?? ""}
                    to={periods.at(-1)?.dates.at(-1) ?? ""}
                    initial={null}
                    canGenerate={false}
                  />
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
function PeriodCells({
  period,
  person,
  today,
}: {
  period: ManagerPeriod;
  person: ManagerPerson;
  today: string;
}) {
  /* The same builder the instructor's own sheet uses. This file's header
     promises that a manager questioning a figure and the person who recorded it
     are looking at one number rather than two that happen to agree; that
     promise used to be kept by `rollUp` and is kept by `buildDayRow` now. */
  const row = buildDayRow({
    key: period.label,
    label: period.label,
    dates: period.dates,
    days: period.dates.flatMap((d) => person.daysByDate[d] ?? []),
    dayNotes: person.notes,
    today,
  });

  const bg = period.isCurrent ? "bg-primary-subtle/25" : "";
  const cell = `border-b border-line px-3 py-2 align-top leading-snug ${bg}`;
  const widths = [
    "min-w-[14rem] max-w-[18rem] border-l-2 border-line text-content",
    "min-w-[10rem] max-w-[13rem] border-l border-line-subtle text-right text-content",
    "tabular min-w-[8rem] border-l border-line-subtle text-right font-semibold text-content",
    "min-w-[12rem] max-w-[16rem] border-l border-line-subtle",
  ];

  /* ── The three empty states, kept apart ────────────────────────────────
   * A grid of instructors against periods is exactly where these collapse if
   * nobody is watching, and the three mean different things:
   *
   *   future    the period has not been reached — blank, because there is
   *             nothing to say yet and an em dash would claim there is
   *   missing   reached, and nothing was filed — an em dash, a stated absence
   *   0h        filed, and the day recorded no hours — a fact the instructor
   *             entered, and not the same as never having filed
   *
   * `0h` therefore renders through the normal path below, not here: a day with
   * zero hours still has words, a quantity and possibly a remark. */
  if (row.state !== "recorded") {
    const mark =
      row.state === "future" ? null : <span className="text-xs text-subtle">&mdash;</span>;
    return (
      <>
        {widths.map((w, i) => (
          <td key={i} className={`${cell} ${w}`}>
            {mark}
          </td>
        ))}
      </>
    );
  }

  const note = period.dates.length === 1 ? (person.notes[period.dates[0]!] ?? "") : "";

  return (
    <>
      {/* One day per line, in the instructor's own words.
          
          This cell used to print `rollUp`'s merged, classified reading, so an
          entry recorded as "Investigate intermittent OAuth token expiry"
          reached the manager as "Other / Unclassified Work" — two people
          looking at one day and seeing different text. There is no
          classification left to print, and the words are the record. */}
      <td className={`${cell} ${widths[0]}`}>
        <ul className="space-y-1">
          {row.days.map((d) => (
            <li key={d.id} className="flex items-start gap-1.5">
              <span
                aria-hidden
                className="mt-[0.45em] inline-block size-1.5 shrink-0 rounded-full bg-primary"
              />
              <span>{d.deliverable}</span>
            </li>
          ))}
        </ul>
        {row.hasMigrated ? (
          <span className="mt-1 block text-xs text-subtle">Reconstructed from an earlier system</span>
        ) : null}
      </td>

      {/* Verbatim, always. "1, 1, 12, 1, 1" stays exactly that — it is what was
          recorded, and tidying it into something well-formed would be
          inventing. An unstated count keeps the client's own `?` rather than
          vanishing, so the row still lines up with the deliverable beside it. */}
      <td className={`${cell} ${widths[1]}`}>
        <ul className="space-y-1">
          {row.days.map((d) => (
            <li key={d.id}>
              {d.deliverableQuantity ?? <span className="text-subtle">?</span>}
            </li>
          ))}
        </ul>
      </td>

      <td className={`${cell} ${widths[2]}`}>
        {/* As recorded, one line per day, with the measured total beneath when
            the column spans more than one — so it still answers "how long
            altogether" without that being all it can say. */}
        <ul className="space-y-1">
          {row.days.map((d) => (
            <li key={d.id}>{compactDuration(d.workingMinutes)}</li>
          ))}
        </ul>
        {row.days.length > 1 ? (
          <span className="mt-1 block border-t border-line-subtle pt-1 text-xs font-normal text-muted">
            {formatDuration(row.totalMinutes / 60)} total
          </span>
        ) : null}
      </td>

      <td className={`${cell} ${widths[3]}`}>
        {note ? (
          <span className="text-content">{note}</span>
        ) : row.remarks ? (
          <span className="text-muted">{row.remarks}</span>
        ) : (
          <span className="text-xs text-subtle">&mdash;</span>
        )}
      </td>
    </>
  );
}
