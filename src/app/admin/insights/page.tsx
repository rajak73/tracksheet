"use client";

/**
 * Every instructor's recorded period across every university, with the reading
 * of it in the last column.
 *
 * ── Inverted, like the manager's ──────────────────────────────────────────
 * This was a list of insight cards across all tenants — prose first, and the
 * figures behind each sentence only reachable by expanding one. An admin
 * comparing campuses cannot do that from prose. The measured figures are now
 * the table, and each row carries its own summary at the end, where it can be
 * checked against the numbers it came from without leaving the row.
 *
 * ── Why it still fans out per university ──────────────────────────────────
 * The analytics engine is scoped to one tenant by design — that scoping is the
 * boundary that stops a manager reading another campus, and widening it for
 * this one screen would put a cross-tenant query into the codebase for an
 * admin's convenience. So this asks each university in parallel and merges,
 * exactly as the insight version did, and a campus that fails to answer is
 * skipped rather than taking the page down with it.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  StatTile,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  THead,
  TD,
  TR,
} from "@/app/_components/ui";
import { AiInsightCell, type CellInsight } from "@/app/_components/AiInsightCell";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatHours } from "@/app/_lib/format";

type University = { id: string; name: string };

type Breakdown = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  utilizationPct: number | null;
  expectedWorkingDays: number;
};

type AnalyticsPayload = {
  analytics: { from: string; to: string; instructors: Breakdown[] };
  insights: Record<string, CellInsight>;
};

type Row = Breakdown & {
  universityName: string;
  insight: CellInsight | null;
};

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const COLUMNS = [
  { label: "Employee name" },
  { label: "Employee ID" },
  { label: "University" },
  { label: "Working hours", align: "right" as const },
  { label: "Capacity", align: "right" as const },
  { label: "Utilisation", align: "right" as const },
  { label: "AI Insight" },
];

export default function AdminInsightsPage() {
  const [severity, setSeverity] = useState("");
  const [universityFilter, setUniversityFilter] = useState("");

  const load = useCallback(async () => {
    const universities = await apiGet<{ universities: University[] }>(
      "/api/universities?limit=200",
      "Could not load universities.",
    );

    const perUniversity = await Promise.all(
      universities.universities.map(async (u) => {
        const body = await apiGet<AnalyticsPayload>(
          `/api/universities/${u.id}/analytics`,
          "Could not load recorded activity.",
        ).catch(() => null);
        if (!body) return [] as Row[];
        return body.analytics.instructors.map((i) => ({
          ...i,
          universityName: u.name,
          insight: body.insights[i.instructorId] ?? null,
        }));
      }),
    );

    return { universities: universities.universities, rows: perUniversity.flat() };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "admin-insights");

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(
      (r) =>
        (!severity || r.insight?.severity === severity) &&
        (!universityFilter || r.universityName === universityFilter),
    );
  }, [data, severity, universityFilter]);

  const totals = useMemo(() => {
    const list = data?.rows ?? [];
    return {
      people: list.length,
      recorded: list.reduce((n, r) => n + r.productiveHours, 0),
      capacity: list.reduce((n, r) => n + r.capacityHours, 0),
      flagged: list.filter((r) => r.insight?.severity === "HIGH" || r.insight?.severity === "CRITICAL")
        .length,
    };
  }, [data]);

  const actions =
    data && data.rows.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by university"
          value={universityFilter}
          onChange={(e) => setUniversityFilter(e.target.value)}
          className="w-auto"
        >
          <option value="">All universities</option>
          {data.universities.map((u) => (
            <option key={u.id} value={u.name}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="w-auto"
        >
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
    ) : null;

  if (error && !data) {
    return (
      <div>
        <PageHeader title="Recorded activity" />
        <ErrorState message="Unable to load recorded activity" detail={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Recorded activity"
        description="What every instructor recorded this period, across all universities, with the stored reading of each row."
        actions={actions}
      />

      {loading && !data ? (
        <TableSkeleton rows={8} cols={7} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Instructors" value={totals.people} />
            <StatTile label="Hours recorded" value={formatHours(totals.recorded)} />
            <StatTile label="Capacity" value={formatHours(totals.capacity)} />
            <StatTile
              label="Flagged"
              value={totals.flagged}
              tone={totals.flagged > 0 ? "warning" : "neutral"}
              hint="Concern or Critical"
            />
          </div>

          <Card className="mt-4">
            <CardHeader title="By instructor" />

            {rows.length === 0 ? (
              <EmptyState
                title={
                  severity || universityFilter
                    ? "Nobody matches those filters"
                    : "Nothing recorded this period"
                }
                description="Rows appear here once instructors record their days."
              />
            ) : (
              <TableWrap>
                <Table caption="Recorded hours per instructor across every university, with the stored reading of each.">
                  <THead columns={COLUMNS} />
                  <TBody>
                    {rows.map((r) => (
                      <TR key={`${r.universityName}:${r.instructorId}`}>
                        <TD strong>{r.instructorName}</TD>
                        <TD>
                          <span className="tabular">{r.employeeCode ?? "—"}</span>
                        </TD>
                        <TD>{r.universityName}</TD>
                        <TD align="right">{formatHours(r.productiveHours)}</TD>
                        <TD align="right">{formatHours(r.capacityHours)}</TD>
                        <TD align="right">
                          {r.utilizationPct === null ? (
                            <span className="text-subtle">—</span>
                          ) : (
                            `${Math.round(r.utilizationPct)}%`
                          )}
                        </TD>
                        <TD>
                          <AiInsightCell insight={r.insight} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
