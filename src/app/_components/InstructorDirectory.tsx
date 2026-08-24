"use client";

/**
 * The instructor directory — the middle step of the drill-down.
 *
 * Universities → University → **Instructor Directory** → Instructor Report.
 *
 * It is fed by the SAME tracker response the grid uses, for the current week,
 * rather than a second endpoint: every column below already exists in that
 * payload, so a separate query would only create a way for the directory and
 * the grid to disagree about the same week.
 *
 * ── Why the hours column says "Recorded hours" ─────────────────────────────
 * Because that is the question this payload answers: the tracker sums every
 * recorded minute, student-facing or not. Working Hours means time spent WITH
 * STUDENTS (see `domain/working-hours.ts`), this response does not carry that
 * figure, and putting the label on this number would publish a total that
 * disagrees with every screen that measures it properly. The honest name and
 * the same number is the trade this column makes.
 *
 * ── Why there is no utilisation column ─────────────────────────────────────
 * It was recorded minutes over the configured working day, which has nothing
 * to do with students: a week of back-to-back internal meetings scored exactly
 * like a week of teaching, and the meter routinely ran past 100%. Ranking
 * people down a list by that is worse than not ranking them at all. Nothing
 * takes its place — the tracker has no student-facing capacity to divide by,
 * and a substitute invented here would be one more figure to reconcile.
 *
 * ── What "Broad category" prints ──────────────────────────────────────────
 * The subjects the period's own entries named, joined by the same function the
 * grid, the CSV and both worklog reports call, so this directory cannot
 * disagree with the screen one click away.
 *
 * It used to print the stream an admin had filed the instructor under. That
 * column is gone at the client's request, along with the per-render query that
 * fetched it. Note this is NOT `category`, also on this row — that is the
 * dominant ACTIVITY of the period, derived from hours, which once turned a
 * quiet week of meetings into "Meeting".
 *
 * ── Why "Deliverables" is a count with no hours beside it ──────────────────
 * "Deliverable hours" meant two different quantities. On this screen it was
 * hours on entries carrying any named deliverable, countable or not; on the
 * roster and manager screens it was hours whose category happened to be
 * "Deliverable Work" — the same person, the same week, 32h 55m against 1h 30m.
 * The quantity is reporting detail about what was booked, which is all this
 * column was ever asked for; the hours behind it live in the grid, per week,
 * where a reader can see which entries they came from.
 */

import Link from "next/link";
import { broadCategoryCell, NOTHING, UNSTATED } from "@/domain/worklog-report";
import {
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  StatusPill,
  Table,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import type { Tracker, TrackerRow } from "@/app/_components/TrackerGrid";
import { formatHours } from "@/app/_lib/format";

/**
 * Broad Category for a whole row: every subject its weeks touched, deduped and
 * joined by the shared formatter. An em dash when the period named none — a day
 * of meetings and admin genuinely has no subject.
 */
function subjectsOf(row: TrackerRow): string {
  return broadCategoryCell(Object.values(row.cells).flatMap((cell) => cell.subjects));
}

/**
 * Deliverable progress for the period, as the quantity that was booked.
 *
 * `?` where the count is unknown — `> 0` is false for null, so this used to
 * print an em dash, which reads as "none booked" for somebody who booked an
 * unstated number of them.
 */
function progressLabel(row: TrackerRow): string {
  if (row.totals.quantity === null) return UNSTATED;
  return row.totals.quantity > 0 ? String(row.totals.quantity) : "—";
}

export function InstructorDirectory({
  tracker,
  /** Where a row links. The caller owns the route so admin and manager differ. */
  hrefFor,
}: {
  tracker: Tracker;
  hrefFor: (row: TrackerRow) => string;
}) {
  if (tracker.rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No instructors to show"
          description="Nobody in this university has recorded work or been assigned deliverables in this period."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={`${tracker.rows.length} instructor${tracker.rows.length === 1 ? "" : "s"}`}
        description="Current week. Select an instructor for their full weekly report."
      />

      {/* Desktop: the full comparison table. */}
      <div className="hidden md:block">
        <TableWrap>
          <Table caption="Instructor directory">
            <THead
              columns={[
                { label: "Instructor" },
                { label: "Employee ID" },
                { label: "Status" },
                { label: "Broad category" },
                { label: "Recorded hours", align: "right" },
                { label: "Deliverables", align: "right" },
              ]}
            />
            <TBody>
              {tracker.rows.map((row) => (
                <TR key={row.instructorId}>
                  <TD strong>
                    <Link href={hrefFor(row)} className="text-primary hover:underline">
                      {row.instructorName}
                    </Link>
                  </TD>
                  <TD>{row.employeeCode ?? "—"}</TD>
                  <TD>
                    <StatusPill status={row.isActive ? "ACTIVE" : "FORMER"} />
                  </TD>
                  <TD>
                    {subjectsOf(row) === NOTHING ? (
                      <span className="text-subtle">{NOTHING}</span>
                    ) : (
                      <Badge tone="neutral">{subjectsOf(row)}</Badge>
                    )}
                  </TD>
                  <TD align="right">{formatHours(row.totals.totalWorkingHours)}</TD>
                  <TD align="right">{progressLabel(row)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </div>

      {/* Mobile: a six-column table is unreadable on a phone, so the same rows
          become cards carrying what the week amounted to — the time recorded
          and the quantity booked against named work. */}
      <div className="md:hidden">
        <CardList>
          {tracker.rows.map((row) => (
            <CardListItem
              key={row.instructorId}
              href={hrefFor(row)}
              title={row.instructorName}
              subtitle={
                <span className="tabular">
                  {row.employeeCode ?? "—"}
                  {subjectsOf(row) === NOTHING ? "" : ` · ${subjectsOf(row)}`}
                </span>
              }
              meta={
                <span className="tabular text-sm text-muted">
                  {formatHours(row.totals.totalWorkingHours)} recorded
                  {row.totals.quantity === null
                    ? ` · ${UNSTATED} deliverables`
                    : row.totals.quantity > 0
                      ? ` · ${row.totals.quantity} deliverable${row.totals.quantity === 1 ? "" : "s"}`
                      : ""}
                </span>
              }
              trailing={<StatusPill status={row.isActive ? "ACTIVE" : "FORMER"} />}
            />
          ))}
        </CardList>
      </div>
    </Card>
  );
}
