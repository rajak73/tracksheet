"use client";

import { useCallback, useState } from "react";
import { ButtonLink, ErrorState, PageHeader, TableSkeleton } from "@/app/_components/ui";
import { ReportTable, type ReportRow } from "@/app/_components/ReportTable";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate } from "@/app/_lib/format";

type Report = { from: string; to: string; rows: ReportRow[] };

export default function ManagerReportsPage() {
  const [period, setPeriod] = useState<Period | null>(null);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) throw new Error("No university is linked to this account.");
    const body = await apiGet<{ report: Report }>(
      `/api/universities/${me.user.universityId}/reports${periodQuery(period)}`,
      "Could not load the report for this period.",
    );
    return { universityId: me.user.universityId, report: body.report };
  }, [period]);

  const { data, error, loading, reload } = useLoad(
    load,
    period ? `${period.from}:${period.to}` : "default",
  );

  const selector = <PeriodSelector value={period} onChange={setPeriod} />;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workload report" actions={selector} />
        <TableSkeleton cols={7} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workload report" actions={selector} />
        <ErrorState message="Unable to load the report" detail={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workload report"
        description={`${formatDate(data.report.from)} to ${formatDate(data.report.to)} — the same figures shown on the dashboard.`}
        actions={
          <>
            {selector}
            <ButtonLink
              external
              href={`/api/universities/${data.universityId}/reports?from=${data.report.from}&to=${data.report.to}&export=csv`}
              variant="secondary"
            >
              Export CSV
            </ButtonLink>
          </>
        }
      />
      <ReportTable rows={data.report.rows} />
    </div>
  );
}
