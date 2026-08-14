"use client";

import { useCallback, useState } from "react";
import { ButtonLink, ErrorState, Field, PageHeader, Select, TableSkeleton } from "@/app/_components/ui";
import { ReportTable, type ReportRow } from "@/app/_components/ReportTable";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDate } from "@/app/_lib/format";

type University = { id: string; name: string };

export default function AdminReportsPage() {
  const [selected, setSelected] = useState<string>("");
  const [period, setPeriod] = useState<Period | null>(null);

  const load = useCallback(async () => {
    const body = await apiGet<{ universities: University[] }>(
      "/api/universities",
      "Could not load universities.",
    );
    return body.universities;
  }, []);

  const { data: universities, error, loading, reload } = useLoad(load, "admin-reports-universities");

  const activeId = selected || universities?.[0]?.id || "";

  const reportLoad = useCallback(async () => {
    if (!activeId) return null;
    const body = await apiGet<{ report: { from: string; to: string; rows: ReportRow[] } }>(
      `/api/universities/${activeId}/reports${periodQuery(period)}`,
      "Could not load the report for that university.",
    );
    return body.report;
  }, [activeId, period]);

  const report = useLoad(reportLoad, `${activeId}:${period ? `${period.from}:${period.to}` : "default"}`);

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="University" className="w-auto">
        <Select value={activeId} onChange={(e) => setSelected(e.target.value)} className="w-auto min-w-48">
          {(universities ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      <PeriodSelector value={period} onChange={setPeriod} />
      {activeId && report.data ? (
        <ButtonLink
          external
          href={`/api/universities/${activeId}/reports?from=${report.data.from}&to=${report.data.to}&export=csv`}
        >
          Export CSV
        </ButtonLink>
      ) : null}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Reports" />
        <TableSkeleton cols={7} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Reports" />
        <ErrorState message="Unable to load universities" detail={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description={report.data ? `${formatDate(report.data.from)} to ${formatDate(report.data.to)}` : "Workload by university."}
        actions={controls}
      />
      {report.loading ? (
        <TableSkeleton cols={7} />
      ) : report.error ? (
        <ErrorState message="Unable to load the report" detail={report.error} onRetry={report.reload} />
      ) : report.data ? (
        <ReportTable rows={report.data.rows} />
      ) : null}
    </div>
  );
}
