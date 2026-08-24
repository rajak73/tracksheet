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
 * ── Why sticky columns and not a wrapping table ────────────────────────────
 * Losing the employee's name after scrolling two weeks right makes the grid
 * unusable, and wrapping 20 columns into the viewport makes it unreadable. The
 * identity block is `position: sticky` against the horizontal scroll, so the
 * row always says whose row it is.
 */

import { Fragment, useState } from "react";
import { Badge, Button, Card, EmptyState, StatusPill } from "@/app/_components/ui";
import { Dialog } from "@/app/_components/interactive";
import { formatDateShort, formatHours, humanizeCode } from "@/app/_lib/format";
import {
  broadCategoryCell,
  compactDuration,
  UNSTATED,
  countableLines,
  deliverableCell,
  quantityCell,
  remarksCell,
  reportLines,
  workedMinutesIn,
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
  deliverables: TrackerDeliverable[];
  /** `null` once anything inside it is unknown. Mirrors the server. */
  quantity: number | null;
  /** Carried by the API and never rendered — see the header note. */
  deliverableHours: number;
  totalWorkingHours: number;
  hoursByCategory: Record<string, number>;
  /** Distinct subjects this week touched. Mirrors the server. */
  subjects: string[];
  remarks: string[];
};

export type TrackerRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  isActive: boolean;
  /** The dominant ACTIVITY category for the period. Derived, never a column. */
  category: string | null;
  categories: string[];
  cells: Record<number, TrackerCell>;
  /* `deliverableHours`, `capacityHours` and `utilizationPct` are carried by
     the API and never rendered. Deliverable hours answers a different question
     from Working Hours, and utilisation divides recorded minutes by a
     configured working day — a week of back-to-back internal meetings scores
     the same as a week of lectures, which is not a fact about a teacher. */
  totals: {
    /** `null` once anything inside it is unknown. Mirrors the server. */
    quantity: number | null;
    deliverableHours: number;
    totalWorkingHours: number;
    capacityHours: number;
    utilizationPct: number | null;
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
  rows: TrackerRow[];
  /* Same as the row totals: the API's deliverable, capacity and utilisation
     figures ride along and stay off the screen. */
  totals: {
    instructors: number;
    formerInstructors: number;
    /** `null` once anything inside it is unknown. Mirrors the server. */
    quantity: number | null;
    deliverableHours: number;
    totalWorkingHours: number;
    capacityHours: number;
    utilizationPct: number | null;
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
  return (cell?.deliverables ?? []).reduce((n, d) => n + (d.countable ? d.hours : 0), 0);
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
 * The per-category hours the engine already computed for this week.
 *
 * Shown only on the single-instructor report: on a team grid it would repeat
 * for every row and bury the deliverables. It is the engine's own
 * `hoursByActivityType`, not a recount — the Broad Category split behind the
 * one dominant label in the identity column.
 */
function CategoryBreakdown({ hours }: { hours: Record<string, number> }) {
  const entries = Object.entries(hours)
    .filter(([, h]) => h > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <dl className="mb-2 space-y-0.5 border-t border-line-subtle pt-2 text-xs">
      <dt className="mb-1 font-medium text-subtle">Activity breakdown</dt>
      {entries.map(([code, h]) => (
        <dd key={code} className="flex justify-between gap-2">
          <span className="truncate text-muted">{humanizeCode(code)}</span>
          <span className="tabular shrink-0 text-content">{formatHours(h)}</span>
        </dd>
      ))}
    </dl>
  );
}

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
  /* Broad Category lives INSIDE the week group, not among the sticky columns.
   * It varies week to week for the same person — someone can spend one week on
   * Technical and the next on Maths — so it belongs with the period's own data
   * rather than beside their name. The assigned-category column that used to
   * sit there is gone at the client's request; this is the only category on the
   * sheet now, and it is read from the work. */
  { key: "subjects", label: "Broad Category", align: "text-left" },
  { key: "deliverable", label: "Deliverable", align: "text-left" },
  { key: "quantity", label: "Deliverable Quantity", align: "text-left" },
  { key: "hours", label: "# Working Hours", align: "text-right" },
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
  current,
  striped,
  showBreakdown,
}: {
  cell: TrackerCell | undefined;
  who: string;
  week: string;
  current: boolean;
  /** Alternates the ground between adjacent week groups. See `bg`. */
  striped: boolean;
  /** Single-instructor report only: there is room for the category split. */
  showBreakdown: boolean;
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

  /* Heaviest first. The cell is read left to right and the biggest commitment
   * is the one that should not need a second glance. */
  /* Heaviest first, and ties broken by name — the same order `deliverableCell`
   * uses, so the rendered cell and the exported one list them identically. */
  const deliverables = [...(cell?.deliverables ?? [])].sort(
    (a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title),
  );

  /* Working Hours is the time spent WITH STUDENTS — classes, labs, mentoring,
   * doubt sessions, evaluations, workshops. Preparation, meetings, reporting
   * and admin keep their hours in the column to the left, because they
   * happened, but they are not what this figure measures.
   *
   * In minutes, because that is what the client's "05h 15m" is written from
   * and what the CSV export uses. */
  const studentMinutes = workedMinutesIn(cell?.deliverables ?? []);

  return (
    <>
      {/* ── "Live Class - 2h, Lesson Preparation - 45m, …" ────────────────
       * Every deliverable with its own duration, in one cell, in the client's
       * own format: their name for the work, a hyphen, a compact duration, and
       * commas between. It used to show the first title and "+3", which meant
       * the column named one thing and hid the rest — and the hidden ones are
       * often the point ("where did the other twelve hours go?"). It wraps
       * rather than truncating, because this cell IS the report.
       *
       * Rendered span by span rather than as one string so a line that is not
       * counted in Working Hours can be muted and say why. The strings are
       * still built by the same functions the CSV uses, so the two agree
       * character for character — `deliverableCell` below is what the export
       * writes for this same cell.
       */}
      {/* ── A week with nothing in it says so ──────────────────────────
        * It used to be an em dash in each of the five columns, which reads as
        * "no value" rather than "nobody filed" — and a manager scanning for
        * who is missing needs the second. Held per WEEK: somebody absent in
        * week two and present in the other three shows exactly that. */}
      {!cell || (cell.deliverables.length === 0 && cell.totalWorkingHours === 0) ? (
        <td
          colSpan={WEEK_FIELDS.length}
          className={`border-b border-l-2 border-line px-3 py-3 align-top text-sm font-medium text-warning-text ${bg}`}
        >
          No worklog
        </td>
      ) : (
        <>
      <td className={`border-b border-l-2 border-line px-3 py-3 align-top ${bg}`}>
        <span className="block text-sm text-content">
          {broadCategoryCell(cell?.subjects ?? [])}
        </span>
      </td>
      <td className={`border-b border-l border-line px-3 py-3 align-top ${bg}`}>
        {deliverables.length === 0 ? (
          <span className="text-xs text-subtle">—</span>
        ) : (
          <span className="block text-sm text-content" title={deliverableCell(reportLines(deliverables))}>
            {deliverables.map((d, i) => (
              <span key={`${d.title}:${d.countable}`} className={d.countable ? undefined : "text-muted"}>
                {i > 0 ? ", " : ""}
                <span title={d.countable ? undefined : "Not counted in Working Hours"}>
                  {d.title} - {compactDuration(d.minutes)}
                </span>
              </span>
            ))}
          </span>
        )}
        {showBreakdown && cell ? <CategoryBreakdown hours={cell.hoursByCategory} /> : null}
      </td>
      {/* ── "12 Lectures, 6 Assignment Evaluations" ───────────────────────
       * A bare "18" cannot be checked against anything. Naming what was counted
       * is what makes the figure auditable, and it is what the client's own
       * sheet does.
       */}
      <td className={`border-b border-l border-line px-3 py-3 align-top ${bg}`}>
        <span className="block text-sm text-content">
          {/* Only what a count means something for. Preparation, meetings,
              reporting and admin keep their HOURS in the column to the left —
              they are real work — but "6 lesson preps" is not a number, and
              the client's own sheet leaves them out of this column.
              The unit comes from the activity rather than from pluralising its
              name, which is what produced "1 Doubt Clearings". */}
          {quantityCell(countableLines(cell?.deliverables ?? []))}
        </span>
      </td>
      <td className={`tabular border-b border-l border-line px-3 py-3 text-right align-top ${bg}`}>
        {studentMinutes > 0 ? (
          // "05h 15m" — the client specified the format to the character, and
          // the CSV writes it with this same function.
          <span className="font-medium text-content">{workingHoursCell(studentMinutes)}</span>
        ) : (
          <span className="text-xs text-subtle">—</span>
        )}
      </td>
      <td className={`border-b border-l border-line px-3 py-3 align-top ${bg}`}>
        {remarks.length === 0 ? (
          <span className="text-xs text-subtle">—</span>
        ) : (
          <>
            {/* Joined with commas and shown in full. The dialog stays for the
                case where one cell has collected a paragraph's worth. */}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="block text-left text-sm text-content underline-offset-2 hover:underline"
              title="View all remarks"
            >
              {remarksCell(remarks)}
            </button>
            <Dialog open={open} onClose={() => setOpen(false)} title={`Remarks — ${who}`}>
              <p className="mb-3 text-xs text-muted">{week}</p>
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
  /** Per-category hours per week. On by default only for a one-person report. */
  showBreakdown = false,
}: {
  tracker: Tracker;
  showBreakdown?: boolean;
}) {
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
                {row.category ? ` · ${humanizeCode(row.category)}` : ""}
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
                    {!cell || (cell.deliverables.length === 0 && cell.totalWorkingHours === 0) ? (
                      <p className="text-sm text-subtle">No records</p>
                    ) : (
                      <>
                        {/* Heaviest first, and counted only where a count
                            means something — the same two rules the desktop
                            cell follows. Preparation and meetings carry no
                            quantity, so the card used to print a bare "0"
                            beside their hours: a figure that reads as "none
                            done" when what it means is "not a thing you
                            count". They stay muted here exactly as they are
                            greyed there. */}
                        {[...cell.deliverables]
                          .sort((a, b) => b.hours - a.hours)
                          .map((d) => (
                            <p
                              key={`${d.title}:${d.countable}`}
                              className="flex justify-between gap-2 text-sm"
                              title={d.countable ? undefined : "Not counted in Working Hours"}
                            >
                              <span
                                className={`truncate ${d.countable ? "text-content" : "text-muted"}`}
                              >
                                {d.title}
                              </span>
                              <span className="tabular shrink-0 text-muted">
                                {d.countable && d.quantity !== 0
                                  ? `${d.quantity ?? UNSTATED} · `
                                  : ""}
                                {formatHours(d.hours)}
                              </span>
                            </p>
                          ))}
                        {/* The same two fields the desktop grid prints for a
                            week. A deliverable-hours figure used to sit between
                            them, and a phone-sized card is the worst place in
                            the product to explain that the number in the middle
                            counts something other than the one beside it. */}
                        <p className="tabular mt-1.5 text-xs text-muted">
                          Qty {cell.quantity} ·{" "}
                          <strong className="text-content">
                            Working Hours {formatHours(workingHours(cell))}
                          </strong>
                        </p>
                        <div className="mt-1 text-xs">
                          <Remarks
                            remarks={cell.remarks}
                            who={row.instructorName}
                            week={`Week ${week.index} · ${weekLabel(week)}`}
                          />
                        </div>
                      </>
                    )}
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
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only-text">
            Weekly workload by instructor for {tracker.universityName}. The first
            three columns identify the employee and stay in place while the
            weekly columns scroll horizontally.
          </caption>
          <thead>
            {/* Row 1 — identity headers span both rows; each week spans four. */}
            <tr>
              <th
                scope="col"
                rowSpan={2}
                className={`${IDENTITY.name} sticky left-0 z-30 border-b border-line bg-primary-subtle px-4 py-3 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-primary-text`}
              >
                Employee Name
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${IDENTITY.code} sticky left-[224px] z-30 border-b border-r border-line bg-primary-subtle px-3 py-3 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-primary-text`}
              >
                Employee ID
              </th>
              {tracker.weeks.map((week) => (
                <th
                  key={week.index}
                  scope="colgroup"
                  colSpan={WEEK_FIELDS.length}
                  /* A translucent wash for "current", not a second opaque
                     background — see the identical note in `ManagerSheet.tsx`. */
                  className={`border-b border-l-2 border-line bg-primary-subtle px-4 py-2 text-center ${
                    week.isCurrent ? "bg-primary/15" : ""
                  }`}
                >
                  <span className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-text">
                    Week {week.index}
                    {week.isCurrent ? (
                      <Badge tone="info">
                        <span className="text-[10px]">Current</span>
                      </Badge>
                    ) : null}
                  </span>
                  <span className="tabular mt-0.5 block text-xs font-normal text-primary-text/70">
                    {weekLabel(week)}
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
                    className={`whitespace-nowrap border-b border-line bg-primary-subtle px-3 py-2 text-xs font-medium text-primary-text ${
                      i === 0 ? "border-l-2" : "border-l border-line-subtle"
                    } ${field.align} ${week.isCurrent ? "bg-primary/15" : ""}`}
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
                  className={`${IDENTITY.code} tabular sticky left-[224px] z-20 border-b border-r border-line bg-surface px-3 py-3 align-top text-content group-hover:bg-hovered`}
                >
                  {row.employeeCode ?? "—"}
                </td>
                {tracker.weeks.map((week) => (
                  <WeekColumns
                    key={week.index}
                    cell={row.cells[week.index]}
                    who={row.instructorName}
                    week={`Week ${week.index} · ${weekLabel(week)}`}
                    current={week.isCurrent}
                    striped={week.index % 2 === 0}
                    showBreakdown={showBreakdown}
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
                /* Unknown anywhere makes the footer unknown. `?? 0` here read
                   "nobody said" as "none" and quietly published a total the
                   column above it does not support. */
                const quantity = tracker.rows.reduce<number | null>(
                  (sum, r) =>
                    sum === null || r.cells[week.index]?.quantity === undefined
                      ? sum
                      : r.cells[week.index]!.quantity === null
                        ? null
                        : sum + r.cells[week.index]!.quantity!,
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
                    <td className="border-l-2 border-t border-line bg-sunken px-3 py-3 text-xs text-subtle">
                      —
                    </td>
                    <td className="tabular border-l border-t border-line bg-sunken px-3 py-3 text-right text-xs font-semibold text-content">
                      {quantity}
                    </td>
                    <td className="tabular border-l border-t border-line bg-sunken px-3 py-3 text-right text-xs font-semibold text-content">
                      {formatHours(hours)}
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
