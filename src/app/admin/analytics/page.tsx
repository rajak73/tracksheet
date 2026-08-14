"use client";

/**
 * Platform-wide analytics, one level deeper than the Overview comparison table.
 *
 * Same rollup-backed endpoint as the dashboard; this page adds the allocation
 * and compliance-spread views that would clutter a page whose job is a
 * three-second read of "is anything wrong" (§16 vs §20).
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Section,
  StatGridSkeleton,
  StatTile,
  complianceLabel,
  complianceTone,
  utilizationLabel,
  utilizationTone,
} from "@/app/_components/ui";
import { AllocationBar, ChartCard } from "@/app/_components/charts";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatHours } from "@/app/_lib/format";

type UniversityRow = {
  name: string;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

type Overview = {
  totalUniversities: number;
  totalInstructors: number;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  teachingHours: number;
  learningHours: number;
};

export default function AdminAnalyticsPage() {
  const [period, setPeriod] = useState<Period | null>(null);

  const load = useCallback(async () => {
    const body = await apiGet<{ overview: Overview; universities: UniversityRow[] }>(
      `/api/admin/overview${periodQuery(period)}`,
      "Could not load platform analytics.",
    );
    return body;
  }, [period]);

  const { data, error, loading, reload } = useLoad(
    load,
    period ? `${period.from}:${period.to}` : "default",
  );

  const selector = <PeriodSelector value={period} onChange={setPeriod} />;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" actions={selector} />
        <StatGridSkeleton />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" actions={selector} />
        <ErrorState message="Unable to load analytics" detail={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  const { overview, universities } = data;

  // Presentation-only bucketing over rows the server already returned —
  // counts of "how many universities" per band, not a recomputation of any
  // university's own figure.
  const bands = { healthy: 0, borderline: 0, concerning: 0, unmeasured: 0 };
  for (const u of universities) {
    if (u.utilizationPct === null) bands.unmeasured++;
    else if (u.utilizationPct >= 75) bands.healthy++;
    else if (u.utilizationPct >= 60) bands.borderline++;
    else bands.concerning++;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description="Platform-wide trends, the same figures shown on Overview at greater depth."
        actions={selector}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Utilization"
          value={overview.utilizationPct}
          suffix="%"
          tone={utilizationTone(overview.utilizationPct)}
          status={utilizationLabel(overview.utilizationPct)}
          emphasis
        />
        <StatTile label="Universities" value={overview.totalUniversities} />
        <StatTile label="Active instructors" value={overview.totalInstructors} />
        <StatTile
          label="No records"
          value={overview.missingDataHours}
          suffix="hrs"
          tone={overview.missingDataHours > 0 ? "warning" : "neutral"}
        />
      </div>

      {overview.missingDataHours > 0 ? (
        <Alert tone="warning" title="Some working time has no records">
          {formatHours(overview.missingDataHours)} across the platform carry no activity.
        </Alert>
      ) : null}

      <ChartCard
        question="How was platform time allocated?"
        isEmpty={overview.teachingHours + overview.learningHours === 0}
      >
        <AllocationBar
          slices={[
            { code: "TEACHING", hours: overview.teachingHours },
            { code: "LEARNING", hours: overview.learningHours },
          ]}
          unutilizedHours={overview.unutilizedHours}
          missingDataHours={overview.missingDataHours}
        />
      </ChartCard>

      <Section
        title="Utilization spread"
        description="How many universities fall into each band, using the same thresholds as every utilization figure in the product."
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Healthy (≥75%)" value={bands.healthy} tone="success" />
          <StatTile label="Below target (60–75%)" value={bands.borderline} tone="warning" />
          <StatTile label="Low (<60%)" value={bands.concerning} tone="danger" />
          <StatTile label="Not measurable" value={bands.unmeasured} tone="neutral" />
        </div>
      </Section>

      <Section title="Compliance">
        <Card>
          <CardHeader title="By university" description="Opening and closing compliance for the selected period." />
          <div className="divide-y divide-line">
            {universities.map((u) => (
              <div key={u.name} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="font-medium text-content">{u.name}</span>
                <div className="flex items-center gap-4 text-xs">
                  <span className={complianceTone(u.openingCompliancePct) === "danger" ? "text-danger" : "text-muted"}>
                    Opening {complianceLabel(u.openingCompliancePct)}
                  </span>
                  <span className={complianceTone(u.closingCompliancePct) === "danger" ? "text-danger" : "text-muted"}>
                    Closing {complianceLabel(u.closingCompliancePct)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
}
