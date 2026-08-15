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
 */

import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  Meter,
  StatusPill,
  Table,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  utilizationTone,
} from "@/app/_components/ui";
import type { Tracker, TrackerRow } from "@/app/_components/TrackerGrid";
import { formatHours, humanizeCode } from "@/app/_lib/format";

/** Deliverable progress for the period, as quantity plus the hours behind it. */
function progressLabel(row: TrackerRow): string {
  if (row.totals.quantity === 0 && row.totals.deliverableHours === 0) return "—";
  return `${row.totals.quantity} · ${formatHours(row.totals.deliverableHours)}`;
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
                { label: "Week hours", align: "right" },
                { label: "Utilization" },
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
                    {row.category ? (
                      <Badge tone="neutral">{humanizeCode(row.category)}</Badge>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </TD>
                  <TD align="right">{formatHours(row.totals.totalWorkingHours)}</TD>
                  <TD>
                    <Meter
                      value={row.totals.utilizationPct}
                      tone={utilizationTone(row.totals.utilizationPct)}
                    />
                  </TD>
                  <TD align="right">{progressLabel(row)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </div>

      {/* Mobile: a seven-column table is unreadable on a phone, so the same
          rows become cards carrying the two figures that matter most. */}
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
                  {row.category ? ` · ${humanizeCode(row.category)}` : ""}
                </span>
              }
              meta={
                <span className="tabular text-sm text-muted">
                  {formatHours(row.totals.totalWorkingHours)} total ·{" "}
                  {formatHours(row.totals.deliverableHours)} deliverable
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
