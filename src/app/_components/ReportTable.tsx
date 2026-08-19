"use client";

import { Card, EmptyState, Table, TableWrap, TBody, TD, THead, TR } from "@/app/_components/ui";
import { formatHours } from "@/app/_lib/format";

/**
 * The row as this table reads it. The reports endpoint sends more than this —
 * `utilizationPct` among it — and is welcome to keep doing so; what a screen
 * declares here is what a screen is allowed to show.
 */
export type ReportRow = {
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
};

/**
 * One report table, used by both the admin and manager report pages, so the
 * two cannot drift into showing the same numbers in different shapes.
 *
 * ── Why there is no utilisation column ─────────────────────────────────────
 * The last column used to be a meter: recorded minutes over the configured
 * working day, with a band label under it. It answered how FULL a day looked,
 * never what the day was for — an afternoon of internal meetings scored exactly
 * like an afternoon of lectures — and it ran past 100% often enough that "Over
 * capacity" read as the ordinary state rather than the exceptional one.
 *
 * Nothing takes its place. The one hours figure the product stands behind is
 * Working Hours, time spent WITH STUDENTS, and these rows come from the
 * engine's capacity and recorded totals, which do not carry it. Re-labelling
 * recorded minutes as Working Hours would put students in rooms they were never
 * in, so the column is simply gone and each remaining one still counts exactly
 * what its header says.
 *
 * Every hour here goes through `formatHours`, so a cell reads `07h 30m` and not
 * a bare `7.5` — the unit travels with the number, and it is the same shape
 * hours take on every other screen.
 */
export function ReportTable({ rows }: { rows: ReportRow[] }) {
  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing to report for this period"
          description="No instructors had recorded capacity in the selected window."
        />
      ) : (
        <TableWrap>
          <Table caption="Workload report">
            <THead
              columns={[
                { label: "Instructor" },
                { label: "Employee code" },
                { label: "Capacity", align: "right" },
                { label: "Recorded", align: "right" },
                { label: "Unutilized", align: "right" },
                { label: "No records", align: "right" },
              ]}
            />
            <TBody>
              {rows.map((r) => (
                <TR key={r.instructorName + (r.employeeCode ?? "")}>
                  <TD strong>{r.instructorName}</TD>
                  <TD>{r.employeeCode ?? "—"}</TD>
                  <TD align="right">{formatHours(r.capacityHours)}</TD>
                  <TD align="right">{formatHours(r.productiveHours)}</TD>
                  <TD align="right">{formatHours(r.unutilizedHours)}</TD>
                  <TD align="right">
                    {r.missingDataHours > 0 ? (
                      <span className="text-warning">{formatHours(r.missingDataHours)}</span>
                    ) : (
                      formatHours(0)
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
