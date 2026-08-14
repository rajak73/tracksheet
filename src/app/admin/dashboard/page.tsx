"use client";

/**
 * The platform-wide view.
 *
 * Ordered per §16: overview, then global utilization, then compliance, then
 * exceptions, then the university comparison table an admin drills into. This
 * page is a summary of the same rollup every university's manager sees, never
 * a second calculation of it.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Meter,
  PageHeader,
  SearchInput,
  Section,
  StatGridSkeleton,
  StatTile,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  complianceTone,
  utilizationLabel,
  utilizationTone,
  type SortDirection,
} from "@/app/_components/ui";
import { ButtonLink } from "@/app/_components/ui";
import { AllocationBar, ChartCard } from "@/app/_components/charts";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDate, formatHours } from "@/app/_lib/format";

type UniversityRow = {
  universityId: string;
  name: string;
  timezone: string;
  from: string;
  to: string;
  instructors: number;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

type Overview = {
  totalUniversities: number;
  totalManagers: number;
  totalInstructors: number;
  openInsights: number;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  teachingHours: number;
  learningHours: number;
  /** False when the rollup cache does not cover the whole selected window. */
  rollupComplete?: boolean;
};

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<Period | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({
    key: "utilizationPct",
    direction: "asc",
  });

  const load = useCallback(async () => {
    const body = await apiGet<{ overview: Overview; universities: UniversityRow[] }>(
      `/api/admin/overview${periodQuery(period)}`,
      "Could not load platform metrics.",
    );
    return body;
  }, [period]);

  const { data, error, loading, reload } = useLoad(
    load,
    period ? `${period.from}:${period.to}` : "default",
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    const filtered = data.universities.filter((u) => !needle || u.name.toLowerCase().includes(needle));
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof UniversityRow;
      const av = a[key];
      const bv = b[key];
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [data, query, sort]);

  function toggleSort(key: string) {
    setSort((s) => ({ key, direction: s.key === key && s.direction === "asc" ? "desc" : "asc" }));
  }

  const selector = <PeriodSelector value={period} onChange={setPeriod} />;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="Platform-wide metrics across all universities." actions={selector} />
        <StatGridSkeleton />
        <TableSkeleton cols={7} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" actions={selector} />
        <ErrorState message="Unable to load platform metrics" detail={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  const { overview } = data;
  const period0 = data.universities[0];
  const attention = data.universities.filter(
    (u) => u.utilizationPct !== null && u.utilizationPct < 60,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={
          period0
            ? `Platform-wide metrics · ${formatDate(period0.from)} to ${formatDate(period0.to)}`
            : "Platform-wide metrics across all universities."
        }
        actions={selector}
      />

      {/* 1 — Platform overview / university count. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Universities" value={overview.totalUniversities} emphasis />
        <StatTile label="Managers" value={overview.totalManagers} />
        <StatTile label="Active instructors" value={overview.totalInstructors} />
        <StatTile
          label="Open insights"
          value={overview.openInsights}
          tone={overview.openInsights > 0 ? "info" : "neutral"}
        />
      </div>

      {/* 2 — Global utilization. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Utilization"
          value={overview.utilizationPct}
          suffix="%"
          tone={utilizationTone(overview.utilizationPct)}
          status={utilizationLabel(overview.utilizationPct)}
          emphasis
          hint={`${overview.productiveHours} of ${overview.capacityHours} hrs`}
        />
        <StatTile label="Teaching" value={overview.teachingHours} suffix="hrs" />
        <StatTile label="Learning" value={overview.learningHours} suffix="hrs" />
        <StatTile
          label="Unutilized"
          value={overview.unutilizedHours}
          suffix="hrs"
          tone={overview.unutilizedHours > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* The figures on this page are read from a summary cache. If the
          scheduler has not summarised the whole selected window yet, they are
          computed over fewer days than were requested and will not match the
          per-university analytics — so say so rather than presenting partial
          data as complete. */}
      {overview.rollupComplete === false ? (
        <Alert tone="warning" title="These figures are still being summarised">
          Part of the selected period has not been rolled up yet, so the totals below cover fewer
          days than the range you chose and may differ from a university&rsquo;s own analytics
          page. They will reconcile once the next summary run completes.
        </Alert>
      ) : null}

      {overview.missingDataHours > 0 ? (
        <Alert tone="warning" title="Some working time has no records">
          {formatHours(overview.missingDataHours)} of expected working time carry no activity
          records across the platform. This is reported as missing data, not as unutilized time
          — the figures above should be read with that in mind.
        </Alert>
      ) : null}

      {/* 3 — Compliance / risk. */}
      {attention.length > 0 ? (
        <Alert tone="warning" title={`${attention.length} universit${attention.length === 1 ? "y needs" : "ies need"} attention`}>
          Utilization is below 60% in this period. See the comparison table below.
        </Alert>
      ) : null}

      <ChartCard
        question="How was platform-wide time allocated?"
        description="Teaching, learning and other recorded work, summed across every university."
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

      {/* 4 — University comparison / drill-down. */}
      <Section title="Universities">
        <Card>
          <CardHeader
            title="Comparison"
            description="Select a university to drill into its managers and instructors."
            actions={
              data.universities.length > 5 ? (
                <SearchInput
                  label="Search universities"
                  value={query}
                  onChange={setQuery}
                  placeholder="Search by name…"
                  className="w-full sm:w-56"
                />
              ) : null
            }
          />
          {data.universities.length === 0 ? (
            <EmptyState
              title="No universities yet"
              description="Create the first university to start tracking workload."
              action={<ButtonLink href="/admin/universities/new">Create a university</ButtonLink>}
            />
          ) : rows.length === 0 ? (
            <EmptyState title="No university matches that search" />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap>
                  <Table caption="University comparison">
                    <THead
                      sort={sort}
                      onSort={toggleSort}
                      columns={[
                        { label: "University", sortKey: "name" },
                        { label: "Instructors", align: "right", sortKey: "instructors" },
                        { label: "Capacity", align: "right", sortKey: "capacityHours" },
                        { label: "Recorded", align: "right", sortKey: "productiveHours" },
                        { label: "Utilization", sortKey: "utilizationPct" },
                        { label: "Opening" },
                        { label: "Closing" },
                      ]}
                    />
                    <TBody>
                      {rows.map((u) => (
                        <TR key={u.universityId}>
                          <TD strong>
                            <Link
                              href={`/admin/universities/${u.universityId}`}
                              className="text-primary hover:underline"
                            >
                              {u.name}
                            </Link>
                            <span className="ml-2 text-xs text-subtle">{u.timezone}</span>
                          </TD>
                          <TD align="right">{u.instructors}</TD>
                          <TD align="right">{u.capacityHours}</TD>
                          <TD align="right">{u.productiveHours}</TD>
                          <TD>
                            <Meter value={u.utilizationPct} tone={utilizationTone(u.utilizationPct)} />
                          </TD>
                          <TD>
                            <Badge tone={complianceTone(u.openingCompliancePct)}>
                              {u.openingCompliancePct === null ? "—" : `${u.openingCompliancePct}%`}
                            </Badge>
                          </TD>
                          <TD>
                            <Badge tone={complianceTone(u.closingCompliancePct)}>
                              {u.closingCompliancePct === null ? "—" : `${u.closingCompliancePct}%`}
                            </Badge>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
              <div className="md:hidden">
                <CardList>
                  {rows.map((u) => (
                    <CardListItem
                      key={u.universityId}
                      href={`/admin/universities/${u.universityId}`}
                      title={u.name}
                      subtitle={`${u.instructors} instructors`}
                      meta={<Meter value={u.utilizationPct} tone={utilizationTone(u.utilizationPct)} />}
                    />
                  ))}
                </CardList>
              </div>
            </>
          )}
        </Card>
      </Section>
    </div>
  );
}
