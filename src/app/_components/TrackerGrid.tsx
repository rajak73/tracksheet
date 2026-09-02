"use client";

/**
 * The weekly workload tracker grid.
 *
 * This is the screen that replaces the client's spreadsheet, so it deliberately
 * keeps that sheet's shape: employee identity pinned on the left, week blocks
 * running right across the page. What it does NOT keep is the spreadsheet's
 * density — a raw Excel dump is unreadable on a screen, so each week block is a
 * small labelled stack rather than four bare columns.
 *
 * ── One hours figure ──────────────────────────────────────────────────────
 * Every hours number on this screen is Working Hours: time spent WITH
 * STUDENTS — lectures, labs, mentoring, doubt sessions, conducting exams. The
 * week column, the row caption and the footer total all read it through the
 * same helper, so a total can never disagree with the cells it totals.
 *
 * The grid used to print a second "Deliverable Hours" line beside it, meaning
 * hours booked against a named piece of work. That is a different question,
 * and close enough in shape to the first to be mistaken for it — a report
 * review that opens by asking which of the two numbers is the real one is a
 * review that has already failed. Preparation, meetings, reporting and admin
 * still appear with their hours in the Deliverable column, because they
 * happened; they are simply not what the hours figure counts.
 *
 * ── Why one sticky column and not a wrapping table ─────────────────────────
 * Losing the employee's name after scrolling two weeks right makes the grid
 * unusable, and wrapping 20 columns into the viewport makes it unreadable. The
 * NAME is `position: sticky` against the horizontal scroll, so the row always
 * says whose row it is.
 *
 * Only the name. Employee ID was pinned beside it, which spent another 128px of
 * a laptop screen restating something the name already answers — the pinned
 * block should cost the reader as little width as it can while still telling
 * them whose row they are reading.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, StatusPill } from "@/app/_components/ui";
import { Dialog } from "@/app/_components/interactive";
import { cellState } from "@/domain/tracker-cell";
import { formatDateShort, formatHours } from "@/app/_lib/format";
import {
  remarksCell,
  workingHours as workingHoursCell,
} from "@/domain/worklog-report";

export type TrackerDeliverable = {
  /** One of the client's deliverable names — see `worklog-taxonomy`. */
  title: string;
  /**
   * `null` is the client's `?` — nobody said how many.
   *
   * These types MIRROR the server's, and the data crosses through an unchecked
   * `apiGet<T>` cast, so nothing checks that they still agree. Leaving this as
   * `number` after the server started emitting null would compile perfectly and
   * print an invented figure — the one failure mode this whole change exists to
   * remove.
   */
  quantity: number | null;
  hours: number;
  /** Exact minutes, which is what "1h 45m" is written from. */
  minutes: number;
  /** Whether a count of this means anything — prep and meetings have no unit. */
  countable: boolean;
};

export type TrackerCell = {
  /**
   * Days in this week carrying a worklog.
   *
   * What tells "filed nothing" from "filed zero hours" — two opposite facts
   * about whether somebody did their paperwork. See `cellState`.
   */
  daysLogged: number;
  totalWorkingHours: number;
  remarks: string[];
};

export type TrackerRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  isActive: boolean;
  cells: Record<number, TrackerCell>;
  /* `deliverableHours`, `capacityHours` and `recordedHoursPct` are carried by
     the API and never rendered. Deliverable hours answers a different question
     from Working Hours, and utilisation divides recorded minutes by a
     configured working day — a week of back-to-back internal meetings scores
     the same as a week of lectures, which is not a fact about a teacher. */
  totals: {
    daysLogged: number;
    deliverableHours: number;
    totalWorkingHours: number;
    capacityHours: number;
    recordedHoursPct: number | null;
  };
};

export type TrackerWeek = {
  index: number;
  from: string;
  to: string;
  labelFrom: string | null;
  labelTo: string | null;
  isCurrent: boolean;
};

export type Tracker = {
  universityId: string;
  universityName: string;
  timezone: string;
  from: string;
  to: string;
  weeks: TrackerWeek[];
  /** Today in the UNIVERSITY's zone. Mirrors the server; see `cellState`. */
  today: string;
  rows: TrackerRow[];
  /* Same as the row totals: the API's deliverable, capacity and utilisation
     figures ride along and stay off the screen. */
  totals: {
    instructors: number;
    formerInstructors: number;
    daysLogged: number;
    deliverableHours: number;
    totalWorkingHours: number;
    capacityHours: number;
    recordedHoursPct: number | null;
  };
};

function weekLabel(week: TrackerWeek): string {
  const from = week.labelFrom ?? week.from;
  const to = week.labelTo ?? week.to;
  return `${formatDateShort(from)} – ${formatDateShort(to)}`;
}

/* ── The one hours figure ───────────────────────────────────────────────── */

/**
 * Working Hours for one week: the time spent WITH STUDENTS.
 *
 * The cell also carries the engine's recorded minutes, which count preparation,
 * meetings, reporting and admin alongside teaching. Those hours are real work
 * and they stay legible in the Deliverable column, but they are not what this
 * report is asked about, so nothing here adds them up.
 *
 * Every hours figure on the screen — the week column, the row caption, the
 * footer — comes through this one function, because the version of this grid
 * where a footer totalled one measure under a column showing another is
 * exactly how a signed-off sheet stops being trusted.
 */
function workingHours(cell: TrackerCell | undefined): number {
  /* Straight off the cell. It used to sum only the deliverables the taxonomy
     marked countable — "time with students" — which needed every line to carry
     a named deliverable with an `isCountable` flag. What the instructor
     recorded for the day is the figure now, and there is one of them. */
  return cell?.totalWorkingHours ?? 0;
}

/** The same figure for one instructor, over exactly the weeks on screen. */
function rowWorkingHours(row: TrackerRow, weeks: TrackerWeek[]): number {
  return weeks.reduce((n, w) => n + workingHours(row.cells[w.index]), 0);
}

/* ── Remarks ────────────────────────────────────────────────────────────── */

/**
 * Remarks are free text and can be long. Showing them inline would blow the
 * column width apart, so one is previewed and the rest open in a dialog —
 * the sheet's Remarks column survives without destroying the grid.
 */
function Remarks({ remarks, who, week }: { remarks: string[]; who: string; week: string }) {
  const [open, setOpen] = useState(false);
  if (remarks.length === 0) return <span className="text-subtle">—</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full truncate text-left text-primary hover:underline"
        title={remarks[0]}
      >
        {remarks[0]}
      </button>
      {remarks.length > 1 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-0.5 text-xs text-muted hover:text-content hover:underline"
        >
          View {remarks.length} remarks
        </button>
      ) : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Remarks"
        description={`${who} · ${week}`}
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <ul className="space-y-3">
          {remarks.map((remark, i) => (
            <li key={i} className="rounded-control border border-line bg-sunken px-3 py-2 text-sm">
              {remark}
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}

/* ── One week block ─────────────────────────────────────────────────────── */


/**
 * Fixed pixel widths, because `position: sticky` offsets must be arithmetic:
 * the second column starts where the first ends. Tailwind's width scale and
 * these offsets have to agree, so both live here rather than being written out
 * at each of the six call sites.
 */
const IDENTITY = {
  name: "w-[224px] min-w-[224px]",
  code: "w-[128px] min-w-[128px]",
} as const;

/** The five fields the client's sheet repeats under every week. */
/* Named exactly as the client's own sheet names them — this grid IS that sheet,
 * and a column called "Qty" here against "Deliverable Quantity" there is how a
 * report review turns into an argument about whether they are the same number.
 *
 * Quantity is left-aligned now that it reads "12 Lectures, 6 Assignment
 * Evaluations" rather than a bare figure; right-aligning prose puts its ragged
 * edge against the numbers beside it. */
const WEEK_FIELDS = [
  /* Three fields, and the first two are the sheet.
   *
   * Broad Category, Deliverable and Deliverable Quantity are gone: the first
   * classified the week's work into a fixed list, and the other two printed
   * merged named deliverables with their counted units. What a week actually
   * holds is how many days somebody filed and how long they worked. */
  { key: "hours", label: "# Working Hours", align: "text-right" },
  { key: "days", label: "Days Logged", align: "text-right" },
  { key: "remarks", label: "Remarks", align: "text-left" },
] as const;


/**
 * One week for one instructor, as FIVE real table cells.
 *
 * Five `<td>`s rather than one stacked block: the grouped header above names
 * each field once, so the body can stay quiet and the eye can run down a single
 * column comparing quantities. There is ONE hours cell and it holds Working
 * Hours. It used to have a "Deliverable Hours" companion — hours booked
 * against a named piece of work — and two hours numbers a column apart are
 * read as a pair whether or not they answer the same question. What was
 * booked against what is still spelled out in the Deliverable cell to the
 * left, and the long form lives in the remarks dialog.
 */
function WeekColumns({
  cell,
  who,
  week,
  today,
  current,
  striped,
}: {
  cell: TrackerCell | undefined;
  who: string;
  /* The week itself, not just its label: deciding "not yet reached" needs its
     start date, and reading that off a formatted label would be parsing our own
     output. */
  week: TrackerWeek;
  /** Today in the UNIVERSITY's zone, from the tracker payload. */
  today: string;
  current: boolean;
  /** Alternates the ground between adjacent week groups. See `bg`. */
  striped: boolean;
}) {
  const [open, setOpen] = useState(false);
  /* ── Which week am I looking at ───────────────────────────────────────
   * Adjacent groups alternate, so after scrolling four weeks sideways the
   * boundary is visible without scrolling back to the header. The week in
   * progress keeps its own tint on top of that, because "which week is this"
   * and "which week is now" are two questions and one shading answered only
   * the second — every other week looked identical to every other. */
  const bg = current ? "bg-primary-subtle/40" : striped ? "bg-sunken/40" : "";
  const remarks = cell?.remarks ?? [];

  /* Which of the three empty states this is, decided by the shared function so
     the grid and the CSV cannot disagree about a blank cell. */
  const state = cellState({
    weekStart: week.from,
    today,
    daysLogged: cell?.daysLogged ?? 0,
    totalMinutes: Math.round((cell?.totalWorkingHours ?? 0) * 60),
  });

  return (
    <>
      {/* ── Not yet reached ───────────────────────────────────────────────
        * Blank, with no border treatment and no dash. Nobody has failed at
        * anything, and a dash here reads as "filed nothing" — which is the
        * state below, and the one somebody chases. */}
      {state === "future" ? (
        <td colSpan={WEEK_FIELDS.length} className={`border-b border-l-2 border-line ${bg}`} />
      ) : state === "missing" ? (
        /* ── Reached, and nobody filed ────────────────────────────────────
         * The one a manager acts on. Said in words rather than as an em dash
         * across the columns, which reads as "no value" rather than "nobody
         * filed". Held per WEEK: somebody absent in week two and present in the
         * other three shows exactly that. */
        <td
          colSpan={WEEK_FIELDS.length}
          className={`border-b border-l-2 border-line px-3 py-3 align-top text-sm font-medium text-warning-text ${bg}`}
        >
          No worklog
        </td>
      ) : (
        <>
          {/* ── Filed. Possibly filed zero, which is a figure ──────────────
            * "00h 00m", explicitly, when they recorded no hours. They
            * answered; the answer was none, and chasing somebody for paperwork
            * they already did is what this distinction prevents. */}
          <td
            className={`tabular border-b border-l-2 border-line px-3 py-3 text-right align-top ${bg}`}
          >
            <span className="block text-sm font-medium text-content">
              {workingHoursCell(Math.round((cell?.totalWorkingHours ?? 0) * 60))}
            </span>
          </td>
          <td className={`tabular border-b border-l border-line px-3 py-3 text-right align-top ${bg}`}>
            <span className="block text-sm text-content">{cell?.daysLogged ?? 0}</span>
          </td>
          <td className={`border-b border-l border-line px-3 py-3 align-top ${bg}`}>
            {remarks.length === 0 ? (
              <span className="text-xs text-subtle">—</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="block text-left text-sm text-content underline decoration-line underline-offset-2"
                  title="View all remarks"
                >
                  {remarksCell(remarks)}
                </button>
                <Dialog open={open} onClose={() => setOpen(false)} title={`Remarks — ${who}`}>
                  <p className="mb-3 text-xs text-muted">{week.labelFrom ?? week.from}</p>
                  <ul className="space-y-2">
                    {remarks.map((r, i) => (
                      <li key={i} className="rounded-md bg-sunken px-3 py-2 text-sm text-content">
                        {r}
                      </li>
                    ))}
                  </ul>
                </Dialog>
              </>
            )}
          </td>
        </>
      )}
    </>
  );
}

/* ── The grid ───────────────────────────────────────────────────────────── */

export function TrackerGrid({
  tracker,
}: {
  tracker: Tracker;
}) {
  /* Where the field row pins: directly under the week row, measured off it.
   * The same problem the manager sheet had — a hard-coded offset is a guess
   * about a height that moves with the type scale and with any week label long
   * enough to wrap, and being six pixels wrong leaves a band of the grid
   * visible between the two stuck rows.
   *
   * Declared above the empty-state return below, because a hook placed after a
   * conditional return is a hook that sometimes does not run. */
  const weekRow = useRef<HTMLTableRowElement>(null);
  const [weekRowHeight, setWeekRowHeight] = useState(0);

  useEffect(() => {
    const row = weekRow.current;
    if (!row) return;
    const measure = () => setWeekRowHeight(row.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [tracker]);

  if (tracker.rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing to report for this period"
          description="No instructor in this university has recorded activity or deliverable progress in the selected window."
        />
      </Card>
    );
  }

  return (
    <>
      {/* Mobile: a sticky-column grid needs horizontal room the phone does not
          have, so each instructor becomes a card and their weeks stack inside
          it. Same data, same one hours figure — a layout change, not a
          different report. */}
      <div className="space-y-4 md:hidden">
        {tracker.rows.map((row) => (
          <Card key={row.instructorId}>
            <div className="border-b border-line px-4 py-3">
              <p className="font-medium text-content">{row.instructorName}</p>
              <p className="tabular mt-0.5 text-xs text-muted">
                {row.employeeCode ?? "—"}
                {row.employeeCode ?? "—"}
              </p>
              {!row.isActive ? (
                <span className="mt-1.5 inline-block">
                  <StatusPill status="FORMER" />
                </span>
              ) : null}
            </div>
            <ul className="divide-y divide-line">
              {tracker.weeks.map((week) => {
                const cell = row.cells[week.index];
                return (
                  <li key={week.index} className="px-4 py-3">
                    <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      Week {week.index}
                      <span className="tabular font-normal normal-case tracking-normal">
                        {weekLabel(week)}
                      </span>
                      {week.isCurrent ? <Badge tone="info">Current</Badge> : null}
                    </p>
                    {(() => {
                      /* The same three states as the desktop cell, from the
                         same function — a card and a grid disagreeing about
                         whether somebody filed is exactly what one shared
                         decision prevents. */
                      const state = cellState({
                        weekStart: week.from,
                        today: tracker.today,
                        daysLogged: cell?.daysLogged ?? 0,
                        totalMinutes: Math.round((cell?.totalWorkingHours ?? 0) * 60),
                      });
                      if (state === "future") return null;
                      if (state === "missing")
                        return <p className="text-sm font-medium text-warning-text">No worklog</p>;
                      return (
                        <>
                          <p className="tabular mt-1.5 text-xs text-muted">
                            {cell?.daysLogged ?? 0} day{(cell?.daysLogged ?? 0) === 1 ? "" : "s"} ·{" "}
                            <strong className="text-content">
                              Working Hours {formatHours(workingHours(cell))}
                            </strong>
                          </p>
                          <div className="mt-1 text-xs">
                            <Remarks
                              remarks={cell?.remarks ?? []}
                              who={row.instructorName}
                              week={`Week ${week.index} · ${weekLabel(week)}`}
                            />
                          </div>
                        </>
                      );
                    })()}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
      {/* The grid scrolls inside its own container so the page body never
          scrolls sideways — the three identity columns stay pinned within it.

          The header is TWO rows: each week spans its five fields with
          colSpan, and the fields are named underneath. That is the sheet the
          client actually works from, and a single stacked cell per week — the
          shape this replaced — cannot express "which column am I reading". */}
      <div className="max-h-[70vh] overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only-text">
            Weekly workload by instructor for {tracker.universityName}. The
            employee name stays in place while every other column scrolls
            horizontally.
          </caption>
          <thead>
            {/* Row 1 — identity headers span both rows; each week spans four. */}
            <tr ref={weekRow}>
              <th
                scope="col"
                rowSpan={2}
                className={`${IDENTITY.name} sticky left-0 top-0 z-30 border-b border-line bg-primary-subtle px-4 py-3 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-primary-text`}
              >
                Employee Name
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${IDENTITY.code} sticky top-0 z-10 border-b border-r border-line bg-primary-subtle px-3 py-3 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-primary-text`}
              >
                Employee ID
              </th>
              {tracker.weeks.map((week) => (
                <th
                  key={week.index}
                  scope="colgroup"
                  colSpan={WEEK_FIELDS.length}
                  /* One background, never two — `background-color` is a
                     single property, so a second `bg-*` replaces the first
                     rather than washing over it. See the note in
                     `ManagerSheet.tsx` and the token in `globals.css`. */
                  className={`sticky top-0 z-10 border-b border-l-2 border-line px-4 py-2 text-center ${
                    week.isCurrent ? "bg-primary-subtle-strong" : "bg-primary-subtle"
                  }`}
                >
                  {/* The label travels with its own week — the same reason as
                      the day header in `ManagerSheet`. This cell spans five
                      columns, so scrolling into the middle of a week left a
                      heading band above columns nobody could name.

                      Sticky at 352px, the width of the two frozen identity
                      columns (224 + 128), and bounded by this cell, so it parks
                      beside them while its week is in view and leaves with it.
                      `text-left` because a centred label that is also sticky
                      slides against its own centring as you scroll. */}
                  <span className="sticky left-[224px] inline-block text-left align-top">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-text">
                      Week {week.index}
                      {week.isCurrent ? (
                        <Badge tone="info">
                          <span className="text-[10px]">Current</span>
                        </Badge>
                      ) : null}
                    </span>
                    <span className="tabular mt-0.5 block text-xs font-normal text-primary-text">
                      {weekLabel(week)}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
            {/* Row 2 — the five fields, repeated under every week. */}
            <tr>
              {tracker.weeks.map((week) =>
                WEEK_FIELDS.map((field, i) => (
                  <th
                    key={`${week.index}-${field.key}`}
                    scope="col"
                    // Undefined until row 1 is measured — sticky with no offset
                    // scrolls for a frame, which is invisible; sticking at zero
                    // would land it on top of the row it belongs under.
                    style={{ top: weekRowHeight || undefined }}
                    className={`sticky z-10 whitespace-nowrap border-b border-line px-3 py-2 text-xs font-medium text-primary-text ${
                      i === 0 ? "border-l-2" : "border-l border-line-subtle"
                    } ${field.align} ${
                      week.isCurrent ? "bg-primary-subtle-strong" : "bg-primary-subtle"
                    }`}
                  >
                    {field.label}
                  </th>
                )),
              )}
            </tr>
          </thead>

          <tbody>
            {tracker.rows.map((row) => (
              <tr key={row.instructorId} className="group">
                <th
                  scope="row"
                  className={`${IDENTITY.name} sticky left-0 z-20 border-b border-line bg-surface px-4 py-3 text-left align-top font-normal group-hover:bg-hovered`}
                >
                  <span className="block truncate font-medium text-content">
                    {row.instructorName}
                  </span>
                  {/* The row's own total of the Working Hours column beside
                      it, so the name and the weeks answer the same question.
                      It used to read "N total · M deliverable": every recorded
                      minute, then the slice booked against a named piece of
                      work — two numbers, neither of them the one the report is
                      about. */}
                  <span className="tabular mt-0.5 block text-xs text-muted">
                    {formatHours(rowWorkingHours(row, tracker.weeks))} Working Hours
                  </span>
                  {/* This pill used to ride in the Instructor Category cell.
                      That column is gone, and "Former" is a fact about the
                      person rather than about a category, so it belongs under
                      their name — and the CSV still carries its Status column
                      either way. */}
                  {!row.isActive ? (
                    <span className="mt-1 block">
                      <StatusPill status="FORMER" />
                    </span>
                  ) : null}
                </th>
                <td
                  className={`${IDENTITY.code} tabular border-b border-r border-line bg-surface px-3 py-3 align-top text-content group-hover:bg-hovered`}
                >
                  {row.employeeCode ?? "—"}
                </td>
                {tracker.weeks.map((week) => (
                  <WeekColumns
                    key={week.index}
                    cell={row.cells[week.index]}
                    who={row.instructorName}
                    week={week}
                    today={tracker.today}
                    current={week.isCurrent}
                    striped={week.index % 2 === 0}
                  />
                ))}
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr>
              <th
                scope="row"
                colSpan={2}
                className="sticky left-0 z-20 border-r border-t border-line bg-sunken px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Total · {tracker.totals.instructors} instructor
                {tracker.totals.instructors === 1 ? "" : "s"}
              </th>
              {tracker.weeks.map((week) => {
                /* Days logged across the roster for this week. It was a
                   quantity total, summed from counted deliverables, with an
                   unknown anywhere making the whole column unknown. There are
                   no counted deliverables; there are days somebody filed. */
                const daysLogged = tracker.rows.reduce(
                  (sum, r) => sum + (r.cells[week.index]?.daysLogged ?? 0),
                  0,
                );
                /* The column above sums to this and to nothing else: the
                   week's student-facing hours across every instructor. It used
                   to add up the engine's recorded minutes instead, so the
                   footer quietly contradicted the column it sits under. */
                const hours = tracker.rows.reduce(
                  (sum, r) => sum + workingHours(r.cells[week.index]),
                  0,
                );
                return (
                  <Fragment key={week.index}>
                      {/* Three cells, matching WEEK_FIELDS: hours, days, and a
                          remarks column with nothing to total. */}
                      <td className="tabular border-l-2 border-t border-line bg-sunken px-3 py-3 text-right text-xs font-semibold text-content">
                        {formatHours(hours)}
                      </td>
                      <td className="tabular border-l border-t border-line bg-sunken px-3 py-3 text-right text-xs font-semibold text-content">
                        {daysLogged}
                      </td>
                    <td className="border-l border-t border-line bg-sunken px-3 py-3 text-xs text-subtle">
                      —
                    </td>
                  </Fragment>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      </Card>
    </>
  );
}
