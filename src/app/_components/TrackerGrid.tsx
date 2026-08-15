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
 * ── Two hour figures ───────────────────────────────────────────────────────
 * `Deliverable Hours` and `Total Working Hours` are shown as separate, labelled
 * lines and are never summed. The distinction is load-bearing: total hours is
 * the number every dashboard and the utilisation metric already use, while
 * deliverable hours is reporting detail about what was booked against a named
 * piece of work. Presenting them as one number would quietly invent a third
 * figure that no part of the system agrees with.
 *
 * ── Why sticky columns and not a wrapping table ────────────────────────────
 * Losing the employee's name after scrolling two weeks right makes the grid
 * unusable, and wrapping 20 columns into the viewport makes it unreadable. The
 * identity block is `position: sticky` against the horizontal scroll, so the
 * row always says whose row it is.
 */

import { useState } from "react";
import { Badge, Button, Card, EmptyState, StatusPill } from "@/app/_components/ui";
import { Dialog } from "@/app/_components/interactive";
import { formatDateShort, formatHours, humanizeCode } from "@/app/_lib/format";

export type TrackerDeliverable = { title: string; quantity: number; hours: number };

export type TrackerCell = {
  deliverables: TrackerDeliverable[];
  quantity: number;
  deliverableHours: number;
  totalWorkingHours: number;
  hoursByCategory: Record<string, number>;
  remarks: string[];
};

export type TrackerRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  isActive: boolean;
  category: string | null;
  categories: string[];
  cells: Record<number, TrackerCell>;
  totals: {
    quantity: number;
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
  totals: {
    instructors: number;
    formerInstructors: number;
    quantity: number;
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

function WeekCell({
  cell,
  who,
  week,
  showBreakdown = false,
}: {
  cell?: TrackerCell;
  who: string;
  week: string;
  showBreakdown?: boolean;
}) {
  if (!cell || (cell.deliverables.length === 0 && cell.totalWorkingHours === 0)) {
    return (
      <td className="w-72 min-w-72 border-l border-line px-4 py-3 align-top">
        <span className="text-sm text-subtle">No records</span>
      </td>
    );
  }

  return (
    <td className="w-72 min-w-72 border-l border-line px-4 py-3 align-top">
      {cell.deliverables.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {cell.deliverables.map((d) => (
            <li key={d.title} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-content" title={d.title}>
                {d.title}
              </span>
              <span className="tabular shrink-0 text-muted">
                {d.quantity} · {formatHours(d.hours)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-sm text-subtle">No deliverable logged</p>
      )}

      {showBreakdown ? <CategoryBreakdown hours={cell.hoursByCategory} /> : null}

      {/* The two hour figures, labelled and never merged. */}
      <dl className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-line-subtle pt-2 text-xs">
        <dt className="text-subtle">Qty</dt>
        <dd className="tabular text-right font-medium text-content">{cell.quantity}</dd>
        <dt className="text-subtle">Deliverable hrs</dt>
        <dd className="tabular text-right font-medium text-content">
          {formatHours(cell.deliverableHours)}
        </dd>
        <dt className="text-subtle">Total working hrs</dt>
        <dd className="tabular text-right font-semibold text-content">
          {formatHours(cell.totalWorkingHours)}
        </dd>
      </dl>

      <div className="text-xs">
        <Remarks remarks={cell.remarks} who={who} week={week} />
      </div>
    </td>
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
          it. Same data, same two hour figures — a layout change, not a
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
                        {cell.deliverables.map((d) => (
                          <p key={d.title} className="flex justify-between gap-2 text-sm">
                            <span className="truncate text-content">{d.title}</span>
                            <span className="tabular shrink-0 text-muted">
                              {d.quantity} · {formatHours(d.hours)}
                            </span>
                          </p>
                        ))}
                        <p className="tabular mt-1.5 text-xs text-muted">
                          Qty {cell.quantity} · Deliverable {formatHours(cell.deliverableHours)} ·{" "}
                          <strong className="text-content">
                            Total {formatHours(cell.totalWorkingHours)}
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
          scrolls sideways — the identity column stays pinned within it. */}
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only-text">
            Weekly workload by instructor for {tracker.universityName}
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 w-64 min-w-64 border-b border-line bg-surface px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Instructor
              </th>
              {tracker.weeks.map((week) => (
                <th
                  key={week.index}
                  scope="col"
                  className={`w-72 min-w-72 border-b border-l border-line px-4 py-3 text-left ${
                    week.isCurrent ? "bg-primary-subtle" : "bg-surface"
                  }`}
                >
                  <span className="block text-xs font-semibold uppercase tracking-wide text-content">
                    Week {week.index}
                    {week.isCurrent ? (
                      <Badge tone="info">
                        <span className="text-[10px]">Current</span>
                      </Badge>
                    ) : null}
                  </span>
                  <span className="tabular mt-0.5 block text-xs font-normal text-muted">
                    {weekLabel(week)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {tracker.rows.map((row) => (
              <tr key={row.instructorId} className="group">
                {/* Identity — pinned. Employee name, ID and broad category, as
                    the sheet has them, plus the row's own totals so a reader
                    never has to scroll right to learn the headline. */}
                <th
                  scope="row"
                  className="sticky left-0 z-10 w-64 min-w-64 border-b border-line bg-surface px-4 py-3 text-left align-top font-normal group-hover:bg-hovered"
                >
                  <span className="block truncate font-medium text-content">
                    {row.instructorName}
                  </span>
                  <span className="tabular mt-0.5 block text-xs text-muted">
                    {row.employeeCode ?? "—"}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1">
                    {row.category ? (
                      <Badge tone="neutral">{humanizeCode(row.category)}</Badge>
                    ) : null}
                    {row.categories.length > 1 ? (
                      <span
                        className="text-xs text-subtle"
                        title={row.categories.map(humanizeCode).join(", ")}
                      >
                        +{row.categories.length - 1}
                      </span>
                    ) : null}
                    {!row.isActive ? <StatusPill status="FORMER" /> : null}
                  </span>
                  <span className="tabular mt-2 block border-t border-line-subtle pt-1.5 text-xs text-muted">
                    {formatHours(row.totals.totalWorkingHours)} total ·{" "}
                    {formatHours(row.totals.deliverableHours)} deliverable
                  </span>
                </th>

                {tracker.weeks.map((week) => (
                  <WeekCell
                    key={week.index}
                    cell={row.cells[week.index]}
                    who={row.instructorName}
                    week={`Week ${week.index} · ${weekLabel(week)}`}
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
                className="sticky left-0 z-10 border-t border-line bg-sunken px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Total · {tracker.totals.instructors} instructor
                {tracker.totals.instructors === 1 ? "" : "s"}
              </th>
              {tracker.weeks.map((week) => {
                const quantity = tracker.rows.reduce(
                  (sum, r) => sum + (r.cells[week.index]?.quantity ?? 0),
                  0,
                );
                const delivHours = tracker.rows.reduce(
                  (sum, r) => sum + (r.cells[week.index]?.deliverableHours ?? 0),
                  0,
                );
                const totalHours = tracker.rows.reduce(
                  (sum, r) => sum + (r.cells[week.index]?.totalWorkingHours ?? 0),
                  0,
                );
                return (
                  <td
                    key={week.index}
                    className="tabular border-l border-t border-line bg-sunken px-4 py-3 align-top text-xs"
                  >
                    <div className="flex justify-between">
                      <span className="text-subtle">Qty</span>
                      <span className="font-medium text-content">{quantity}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-subtle">Deliverable</span>
                      <span className="font-medium text-content">
                        {formatHours(Number(delivHours.toFixed(2)))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-subtle">Total</span>
                      <span className="font-semibold text-content">
                        {formatHours(Number(totalHours.toFixed(2)))}
                      </span>
                    </div>
                  </td>
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
