"use client";

/**
 * The manager's university.
 *
 * Ordered to answer one question first — "who needs attention?" (§17). The
 * health figures set context, the instructor table names the people, and
 * exceptions say what specifically is wrong. Trends come last because they
 * inform next week rather than today.
 *
 * The instructor table is sortable in the browser over rows the server already
 * returned, so ranking by utilisation costs no request and cannot disagree with
 * the totals above it.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  ButtonLink,
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
  complianceLabel,
  complianceTone,
  utilizationLabel,
  utilizationTone,
  type SortDirection,
} from "@/app/_components/ui";
import { AllocationBar, ChartCard } from "@/app/_components/charts";
import {
  InsightCard,
  PeriodSelector,
  periodQuery,
  type Period,
} from "@/app/_components/interactive";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatHours } from "@/app/_lib/format";

type InstructorRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  overlapHours: number;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

type Totals = {
  instructors: number;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
  hoursByActivityType: Record<string, number>;
};

type Insight = {
  id: string;
  type: string;
  severity: string;
  title?: string;
  summary?: string;
  recommendation: string;
  period?: string;
  status?: string;
  sourceMetrics?: Record<string, unknown> | null;
};

type ExceptionFlag = {
  type: string;
  severity: string;
  instructorName: string;
  date: string;
  detail: string;
};

export default function ManagerDashboardPage() {
  const [period, setPeriod] = useState<Period | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({
    key: "utilizationPct",
    direction: "asc",
  });

  const load = useCallback(async () => {
    const me = await fetchMe();
    const universityId = me.user.universityId;
    if (!universityId) throw new Error("No university is linked to this account.");

    const query = periodQuery(period);
    const [analytics, insights, exceptions] = await Promise.all([
      apiGet<{ analytics: { from: string; to: string; totals: Totals; instructors: InstructorRow[] } }>(
        `/api/universities/${universityId}/analytics${query}`,
        "Could not load your university's workload for this period.",
      ),
      apiGet<{ insights: Insight[] }>(
        `/api/universities/${universityId}/insights${query}`,
        "Could not load insights.",
      ).catch(() => ({ insights: [] as Insight[] })),
      apiGet<{ exceptions: { total: number; exceptions: ExceptionFlag[] } }>(
        `/api/universities/${universityId}/exceptions${query}`,
        "Could not load exceptions.",
      ).catch(() => ({ exceptions: { total: 0, exceptions: [] as ExceptionFlag[] } })),
    ]);

    return {
      universityId,
      from: analytics.analytics.from,
      to: analytics.analytics.to,
      totals: analytics.analytics.totals,
      instructors: analytics.analytics.instructors,
      insights: insights.insights,
      exceptions: exceptions.exceptions,
    };
  }, [period]);

  const { data, error, loading, reload } = useLoad(
    load,
    period ? `${period.from}:${period.to}` : "default",
  );

  /** Sorting and filtering over rows the server already sent. No refetch. */
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    const filtered = data.instructors.filter(
      (i) =>
        !needle ||
        i.instructorName.toLowerCase().includes(needle) ||
        (i.employeeCode ?? "").toLowerCase().includes(needle),
    );

    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof InstructorRow;
      const av = a[key];
      const bv = b[key];

      // Nulls last in both directions: "not measurable" is never the most
      // interesting row, whichever way the column is sorted.
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
    setSort((s) => ({
      key,
      direction: s.key === key && s.direction === "asc" ? "desc" : "asc",
    }));
  }

  const selector = (
    <>
      <PeriodSelector value={period} onChange={setPeriod} />
      <ButtonLink href="/manager/reports" variant="secondary">
        View reports
      </ButtonLink>
    </>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" actions={selector} />
        <StatGridSkeleton />
        <TableSkeleton cols={6} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" actions={selector} />
        <ErrorState message="Unable to load your university" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  const t = data.totals;
  const attention = data.instructors.filter(
    (i) => i.utilizationPct !== null && i.utilizationPct < 60,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={`${formatDate(data.from)} to ${formatDate(data.to)}`}
        actions={selector}
      />

      {/* 1 — University health. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Utilization"
          value={t.utilizationPct}
          suffix="%"
          tone={utilizationTone(t.utilizationPct)}
          status={utilizationLabel(t.utilizationPct)}
          emphasis
          hint={`${t.productiveHours} of ${t.capacityHours} hrs`}
        />
        <StatTile label="Active instructors" value={t.instructors} />
        <StatTile
          label="Opening compliance"
          value={t.openingCompliancePct}
          suffix="%"
          tone={complianceTone(t.openingCompliancePct)}
          status={complianceLabel(t.openingCompliancePct)}
        />
        <StatTile
          label="Closing compliance"
          value={t.closingCompliancePct}
          suffix="%"
          tone={complianceTone(t.closingCompliancePct)}
          status={complianceLabel(t.closingCompliancePct)}
        />
      </div>

      {t.missingDataHours > 0 ? (
        <Alert tone="warning" title="Some working time has no records">
          {formatHours(t.missingDataHours)} carry no activity. That is missing data, not
          unutilized time — the utilization figure above is calculated over what was recorded.
        </Alert>
      ) : null}

      {/* 2 — Who needs attention. */}
      <Section
        title="Instructor workload"
        description="Sorted by utilization, lowest first — the people most likely to need a conversation."
      >
        <Card>
          <CardHeader
            title="Instructors"
            description={
              attention.length > 0
                ? `${attention.length} below 60% utilization in this period.`
                : "All instructors are at or above 60% utilization."
            }
            actions={
              data.instructors.length > 5 ? (
                <SearchInput
                  label="Search instructors"
                  value={query}
                  onChange={setQuery}
                  placeholder="Search by name or code…"
                  className="w-full sm:w-56"
                />
              ) : null
            }
          />

          {data.instructors.length === 0 ? (
            <EmptyState
              title="No active instructors"
              description="Add instructors to start tracking workload for this university."
              action={<ButtonLink href="/manager/instructors">Add an instructor</ButtonLink>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No instructor matches that search"
              description="Try a different name or employee code."
            />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap>
                  <Table caption="Instructor workload for the selected period">
                    <THead
                      sort={sort}
                      onSort={toggleSort}
                      columns={[
                        { label: "Instructor", sortKey: "instructorName" },
                        { label: "Capacity", align: "right", sortKey: "capacityHours" },
                        { label: "Recorded", align: "right", sortKey: "productiveHours" },
                        { label: "No records", align: "right", sortKey: "missingDataHours" },
                        { label: "Utilization", sortKey: "utilizationPct" },
                        { label: "Open / close" },
                      ]}
                    />
                    <TBody>
                      {rows.map((i) => (
                        <TR key={i.instructorId}>
                          <TD strong>
                            <span className="whitespace-nowrap">{i.instructorName}</span>
                            {i.employeeCode ? (
                              <span className="ml-2 text-xs text-subtle">{i.employeeCode}</span>
                            ) : null}
                            {i.overlapHours > 0 ? (
                              <span className="ml-2">
                                <Badge tone="warning">Overlapping records</Badge>
                              </span>
                            ) : null}
                          </TD>
                          <TD align="right">{i.capacityHours}</TD>
                          <TD align="right">{i.productiveHours}</TD>
                          <TD align="right">
                            {i.missingDataHours > 0 ? (
                              <span className="text-warning">{i.missingDataHours}</span>
                            ) : (
                              0
                            )}
                          </TD>
                          <TD>
                            <Meter
                              value={i.utilizationPct}
                              tone={utilizationTone(i.utilizationPct)}
                              label={utilizationLabel(i.utilizationPct)}
                            />
                          </TD>
                          <TD>
                            <div className="flex items-center gap-1.5">
                              <Badge tone={complianceTone(i.openingCompliancePct)}>
                                {i.openingCompliancePct === null
                                  ? "—"
                                  : `${i.openingCompliancePct}%`}
                              </Badge>
                              <Badge tone={complianceTone(i.closingCompliancePct)}>
                                {i.closingCompliancePct === null
                                  ? "—"
                                  : `${i.closingCompliancePct}%`}
                              </Badge>
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>

              {/* Mobile: name, utilization, status — the three fields that
                  answer "who needs attention". The rest is a drill-down. */}
              <div className="md:hidden">
                <CardList>
                  {rows.map((i) => (
                    <CardListItem
                      key={i.instructorId}
                      title={i.instructorName}
                      subtitle={utilizationLabel(i.utilizationPct)}
                      meta={
                        <Meter
                          value={i.utilizationPct}
                          tone={utilizationTone(i.utilizationPct)}
                        />
                      }
                    />
                  ))}
                </CardList>
              </div>
            </>
          )}
        </Card>
      </Section>

      {/* 3 — Exceptions. */}
      {data.exceptions.total > 0 ? (
        <Section
          title="Exceptions"
          description="Data-quality flags detected in this period. Each one names the measurement, not a judgement about a person."
        >
          <Card>
            <CardHeader
              title={`${data.exceptions.total} flagged`}
              description={
                data.exceptions.exceptions.length < data.exceptions.total
                  ? `Showing the first ${data.exceptions.exceptions.length}.`
                  : undefined
              }
            />
            <CardList>
              {data.exceptions.exceptions.slice(0, 8).map((e, i) => (
                <CardListItem
                  key={`${e.type}-${e.instructorName}-${e.date}-${i}`}
                  title={e.instructorName}
                  subtitle={e.detail}
                  trailing={
                    <Badge
                      tone={
                        e.severity === "HIGH"
                          ? "danger"
                          : e.severity === "MEDIUM"
                            ? "warning"
                            : "info"
                      }
                    >
                      {e.type.replaceAll("_", " ").toLowerCase()}
                    </Badge>
                  }
                />
              ))}
            </CardList>
          </Card>
        </Section>
      ) : null}

      {/* 4 — Trends. */}
      <ChartCard
        question="How was your university's capacity allocated?"
        description={`${formatDate(data.from)} to ${formatDate(data.to)}`}
        isEmpty={Object.keys(t.hoursByActivityType).length === 0}
        emptyTitle="No activity recorded in this period"
        emptyDescription="Once instructors record activity, the distribution appears here."
      >
        <AllocationBar
          slices={Object.entries(t.hoursByActivityType).map(([code, hours]) => ({ code, hours }))}
          unutilizedHours={t.unutilizedHours}
          missingDataHours={t.missingDataHours}
        />
      </ChartCard>

      {/* 5 — Insights. */}
      {data.insights.length > 0 ? (
        <Section
          title="AI insights"
          description="Each one shows the metrics it was derived from."
          actions={
            <ButtonLink href="/manager/insights" variant="ghost" size="sm">
              View all
            </ButtonLink>
          }
        >
          <div className="space-y-3">
            {data.insights.slice(0, 3).map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
