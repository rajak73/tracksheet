"use client";

import { useState } from "react";

/**
 * The instructor's own sheet: one row per day, in the client's own columns.
 *
 * ── A day is a row, not a list of rows ────────────────────────────────────
 * This is the shape the report is written in — Deliverable, Deliverable
 * Quantity, Working Hours, Remarks, each one thing per day — so it is the
 * shape an instructor should be checking their day against. A row per activity
 * showed the same facts but never the ones the report would carry, which meant
 * nobody could see what their day was about to look like to somebody else.
 *
 * ── And it opens, because correcting is per entry ─────────────────────────
 * The aggregate cannot be corrected: "1 Lecture, 25 Quiz Evaluations" is four
 * entries with four clock ranges. So a day expands into the entries it was made
 * of, and the correction stays where the fact is.
 *
 * ── Newest first ──────────────────────────────────────────────────────────
 * Today is at the top. An instructor opens this to check what they just wrote,
 * and a chronological list puts that at the bottom of a scroll every time.
 *
 * ── Both axes are frozen ──────────────────────────────────────────────────
 * The date column stays put while the criteria scroll sideways, the headings
 * stay put while the dates scroll down. A wide sheet where either gets away
 * from you is one you read by counting columns.
 */

import { Badge, Button, inputClass } from "@/app/_components/ui";
import { compactDuration, countableLines, quantityCell } from "@/domain/worklog-report";
import { categoryColor } from "@/app/_components/charts";
import { formatDuration, type Activity } from "@/app/_components/workload";
import { rollUp, type RollupLine } from "@/domain/rollup";

/**
 * One row of the sheet: a day, or a week.
 *
 * ── Why a period and not a date ───────────────────────────────────────────
 * Day, Week and Month are the same table with different rows — one date, seven
 * dates, or four to six weeks. Making the row a PERIOD rather than a day means
 * the month view is not a second component with its own columns and its own
 * idea of what "Working Hours" means; it is this table, with wider rows.
 */
export type SheetPeriod = {
  /** Every date this row covers, so its activities can be gathered. */
  dates: string[];
  /** "19 Aug" or "17 – 23 Aug" */
  label: string;
  /** "Wednesday" or "Week 4" */
  sublabel: string;
  /** Contains today — the row somebody is most likely looking for. */
  isCurrent: boolean;
  /** Writable only when the period IS today, which is only ever a day row. */
  writableDate: string | null;
};

/* No "Your entry" column.
 *
 * It repeated, row by row, what the writing box at the top of the page already
 * shows in full — and it is the widest thing a row can carry, so it was pushing
 * the columns the report is actually made of off the edge. The sentence a row
 * came from is still one click away: opening a day shows its entries, each with
 * its own clock range, and the full text is in the box above. */
const COLUMNS = [
  { key: "subject", label: "Broad Category", align: "text-left" },
  { key: "deliverable", label: "Deliverable", align: "text-left" },
  { key: "quantity", label: "Deliverable Quantity", align: "text-right" },
  { key: "hours", label: "Working Hours", align: "text-right" },
  { key: "remarks", label: "Remarks", align: "text-left" },
] as const;

/* Sticky needs an OPAQUE background or rows scroll through it, and the corner
 * has to out-rank both the row and the column it belongs to. */
const HEAD = "sticky top-0 z-20 bg-sunken";
const DATE_COL = "sticky left-0 z-10";
const CORNER = "sticky left-0 top-0 z-30 bg-sunken";


export function InstructorSheet({
  periods,
  activitiesByDate,
  subjectByDate,
  notes,
  busy,
  onAdd,
  onNote,
}: {
  /** Newest first. */
  periods: SheetPeriod[];
  activitiesByDate: Record<string, Activity[]>;
  /**
   * What each office day was about, from the server.
   *
   * Not derived here: a day with no class of its own inherits the subject of
   * the last office day that had one, which is usually before this window. The
   * manager's sheet reads the same answer from the same function, so the two
   * cannot disagree about the same day.
   */
  subjectByDate: Record<string, { code: string; label: string; carriedFrom: string | null } | null>;
  /** The instructor's own note per day, keyed by date. */
  notes: Record<string, string>;
  busy: boolean;
  onAdd: (date: string) => void;
  onNote: (date: string, note: string) => Promise<void>;
}) {

  return (
    <div className="max-h-[70vh] overflow-auto rounded-card border border-line bg-surface shadow-card">
      <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-sm">
        <caption className="sr-only-text">
          Your recorded work, newest day first, in the columns the monthly report uses. Open a day
          to correct the entries it was made of.
        </caption>

        <thead>
          <tr>
            <th
              scope="col"
              className={`${CORNER} w-36 border-b border-r border-line px-4 py-3.5 text-left text-xs font-semibold leading-snug text-muted`}
            >
              Date
            </th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`${HEAD} border-b border-line px-4 py-3.5 text-xs font-semibold leading-snug text-muted ${c.align}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {periods.map((period) => {
            const rows = period.dates
              .flatMap((d) => activitiesByDate[d] ?? [])
              .sort((a, b) => a.startTime.localeCompare(b.startTime));
            const { lines, hours, remarks } = rollUp(rows);
            // The period's subjects, from the day answers rather than from the
            // entries — see the note on `subjectByDate`.
            const subjects = [
              ...new Set(
                period.dates
                  .map((d) => subjectByDate?.[d]?.label)
                  .filter((label): label is string => Boolean(label)),
              ),
            ];
            return (
              <PeriodRow
                key={period.label}
                period={period}
                rows={rows}
                lines={lines}
                hours={hours}
                subjects={subjects}
                remarks={remarks}
                notes={notes}
                busy={busy}
                onAdd={onAdd}
                onNote={onNote}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PeriodRow({
  period,
  rows,
  lines,
  hours,
  subjects,
  remarks,
  notes,
  busy,
  onAdd,
  onNote,
}: {
  period: SheetPeriod;
  rows: Activity[];
  lines: RollupLine[];
  hours: number;
  subjects: string[];
  remarks: string[];
  notes: Record<string, string>;
  busy: boolean;
  onAdd: (date: string) => void;
  onNote: (date: string, note: string) => Promise<void>;
}) {
  /* Generous rows and horizontal rules only.
   *
   * The deliverable cell holds a sentence's worth of text and has to WRAP, not
   * truncate — it is the column the report is made of. Vertical rules would
   * box each of those into a cage; a single rule between days is enough to
   * separate them, which is how the client reads this table on paper. */
  const cell = "border-b border-line px-4 py-5 align-top leading-relaxed";
  const tint = period.isCurrent ? "bg-primary-subtle/25" : "";

  return (
    <>
      <tr className={`group transition-colors ${tint} hover:bg-hovered`}>
        <th
          scope="row"
          className={`${DATE_COL} ${cell} border-r text-left font-normal transition-colors ${
            period.isCurrent ? "bg-primary-subtle" : "bg-surface group-hover:bg-hovered"
          }`}
        >
          <span className="tabular block text-sm font-semibold text-content">{period.label}</span>
          <span className="block text-xs text-muted">{period.sublabel}</span>
          {period.isCurrent ? (
            <span className="mt-1.5 inline-block">
              <Badge tone="primary">Today</Badge>
            </span>
          ) : null}
          {rows.length > 0 ? (
            <span className="tabular mt-2 block text-xs text-muted">
              {rows.length} {rows.length === 1 ? "activity" : "activities"}
            </span>
          ) : null}
        </th>

        {rows.length === 0 ? (
          <td colSpan={COLUMNS.length} className={cell}>
            <span className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-subtle">Nothing recorded for this day.</span>
              {/* Only today can be written — a backdated entry is refused, so
                  offering the button would be offering a refusal. */}
              {period.writableDate ? (
                <Button size="sm" onClick={() => onAdd(period.writableDate!)}>
                  Add today&apos;s workload
                </Button>
              ) : null}
            </span>
          </td>
        ) : (
          <>
            <td className={cell}>
              {subjects.length > 0 ? (
                <span className="inline-flex flex-wrap items-center gap-1.5 text-content">
                  {subjects.join(", ")}
                </span>
              ) : (
                <span
                  className="text-subtle"
                  title="Read from the classes you record. A day with no class takes the subject of your last teaching day."
                >
                  Not yet determined
                </span>
              )}
            </td>

            {/* "Lecture – 1h 30m, Department Meeting – 1h" */}
            <td className={`${cell} max-w-[22rem] text-content`}>
              {lines.map((l, i) => (
                <span key={l.key} className={l.countable ? undefined : "text-muted"}>
                  {i > 0 ? ", " : ""}
                  <span
                    aria-hidden
                    className="mr-1 inline-block size-2 rounded-full align-middle"
                    style={{ background: categoryColor(rows[0]!.activityType.code) }}
                  />
                  <span title={l.countable ? undefined : "Not counted in Working Hours"}>
                    {l.label} - {compactDuration(l.minutes)}
                  </span>
                </span>
              ))}
            </td>

            {/* Only what a count means something for. */}
            <td className={`${cell} max-w-[18rem] text-right text-content`}>
              {/* Written by the one function that writes this column
                  everywhere, so this sheet, the manager's, the monthly tracker
                  and both exports say the same thing — including the client's
                  `?` where somebody never said how many. */}
              {quantityCell(
                countableLines(
                  lines.map((l) => ({
                    title: l.label,
                    minutes: l.minutes,
                    quantity: l.quantity,
                    countable: l.countable,
                  })),
                ),
              )}
            </td>

            <td className={`${cell} tabular text-right font-semibold text-content`}>
              {formatDuration(hours)}
            </td>

            {/* ── The instructor's own word on how the day went ─────────────
             * Written here, not read out of the sentences: "all planned
             * sessions completed" is a judgement about the day, and only the
             * person who lived it can make it.
             *
             * Editable on a DAY row only. A week has no single such note, and
             * offering one would ask somebody to summarise five days into a box
             * that can only be attached to one of them.
             *
             * Until something is written, the topics the reader pulled out of
             * the sentences stand in — muted, because they are detail rather
             * than the verdict this column asks for. */}
            <td className={`${cell} max-w-[18rem]`}>
              <DayNote
                date={period.dates.length === 1 ? period.dates[0]! : null}
                note={period.dates.length === 1 ? (notes[period.dates[0]!] ?? "") : ""}
                fallback={remarks}
                busy={busy}
                onSave={onNote}
              />
            </td>
          </>
        )}
      </tr>

    </>
  );
}

/** The Remarks cell: a note somebody writes, with the topics as a stand-in. */
function DayNote({
  date,
  note,
  fallback,
  busy,
  onSave,
}: {
  /** Null for a week row, which has no single day to attach a note to. */
  date: string | null;
  note: string;
  fallback: string[];
  busy: boolean;
  onSave: (date: string, note: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);

  if (!date) {
    return fallback.length > 0 ? (
      <span className="text-muted">{fallback.join(", ")}</span>
    ) : (
      <span className="text-subtle">\u2014</span>
    );
  }

  if (editing) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          maxLength={2000}
          placeholder="All planned sessions completed"
          aria-label="Remark for this day"
          className={`${inputClass} w-52`}
        />
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            await onSave(date, draft);
            setEditing(false);
          }}
        >
          {busy ? "Saving\u2026" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setDraft(note);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(note);
        setEditing(true);
      }}
      className="-mx-1.5 -my-1 block w-full rounded-control px-1.5 py-1 text-left transition-colors hover:bg-hovered"
      title="Write how this day went"
    >
      {note ? (
        <span className="text-content">{note}</span>
      ) : fallback.length > 0 ? (
        <span className="text-muted">{fallback.join(", ")}</span>
      ) : (
        <span className="text-subtle">Add a remark</span>
      )}
    </button>
  );
}
