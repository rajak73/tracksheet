"use client";

import {
  Card, EmptyState, Meter, Table, TableWrap, TBody, TD, THead, TR,
  utilizationTone,
} from "@/app/_components/ui";

export type ReportRow = {
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
};

/**
 * One report table, used by both the admin and manager report pages, so the
 * two cannot drift into showing the same numbers in different shapes.
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
          <Table>
            <THead
              columns={[
                { label: "Instructor" },
                { label: "ID" },
                { label: "Capacity", align: "right" },
                { label: "Productive", align: "right" },
                { label: "Unutilized", align: "right" },
                { label: "Missing", align: "right" },
                { label: "Utilization" },
              ]}
            />
            <TBody>
              {rows.map((r) => (
                <TR key={r.instructorName + (r.employeeCode ?? "")}>
                  <TD strong>{r.instructorName}</TD>
                  <TD>{r.employeeCode ?? "—"}</TD>
                  <TD align="right">{r.capacityHours}</TD>
                  <TD align="right">{r.productiveHours}</TD>
                  <TD align="right">{r.unutilizedHours}</TD>
                  <TD align="right">
                    {r.missingDataHours > 0 ? (
                      <span className="text-warning">{r.missingDataHours}</span>
                    ) : (
                      0
                    )}
                  </TD>
                  <TD>
                    <Meter value={r.utilizationPct} tone={utilizationTone(r.utilizationPct)} />
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
