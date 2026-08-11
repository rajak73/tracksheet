/**
 * Report shaping only. All arithmetic comes from the analytics engine, so a
 * report and a dashboard covering the same period are guaranteed to agree —
 * they are literally reading the same numbers.
 */

import { computeAnalytics, type AnalyticsResult } from "@/server/analytics/engine";

export type ReportRow = {
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

export type WorkloadReport = {
  universityId: string;
  from: string;
  to: string;
  rows: ReportRow[];
  totals: AnalyticsResult["totals"];
};

export async function generateWorkloadReport(
  universityId: string,
  from: string,
  to: string,
): Promise<WorkloadReport> {
  // `from`/`to` are required rather than optional. They used to be optional and
  // silently ignored, which made every "weekly" report an all-time report.
  const analytics = await computeAnalytics({ universityId, from, to });

  return {
    universityId,
    from,
    to,
    rows: analytics.instructors.map((i) => ({
      instructorName: i.instructorName,
      employeeCode: i.employeeCode,
      capacityHours: i.capacityHours,
      productiveHours: i.productiveHours,
      unutilizedHours: i.unutilizedHours,
      missingDataHours: i.missingDataHours,
      utilizationPct: i.utilizationPct,
      openingCompliancePct: i.openingCompliancePct,
      closingCompliancePct: i.closingCompliancePct,
    })),
    totals: analytics.totals,
  };
}

const HEADERS = [
  "Instructor Name",
  "Employee ID",
  "Capacity Hours",
  "Productive Hours",
  "Unutilized Hours",
  "Missing Data Hours",
  "Utilization %",
  "Opening Compliance %",
  "Closing Compliance %",
] as const;

/** RFC-4180 quoting: a name containing a comma must not shift every column. */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatReportAsCsv(report: WorkloadReport): string {
  const lines = [HEADERS.join(",")];
  for (const r of report.rows) {
    lines.push(
      [
        r.instructorName,
        r.employeeCode,
        r.capacityHours,
        r.productiveHours,
        r.unutilizedHours,
        r.missingDataHours,
        r.utilizationPct,
        r.openingCompliancePct,
        r.closingCompliancePct,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
