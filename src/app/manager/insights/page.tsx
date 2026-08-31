"use client";

/**
 * What the roster actually recorded, with the reading of it in the last column.
 *
 * ── This page used to be the other way round ──────────────────────────────
 * It was a stack of insight cards: prose first, and the figures behind each
 * sentence only reachable by expanding one. That is the wrong order for the
 * person who opens it. A manager comes here to find out what their instructors
 * recorded — the hours, the shortfalls, the days nobody filed — and a summary
 * they cannot immediately check against the numbers is something they have to
 * take on trust.
 *
 * So the numbers come first, one row per instructor, and the reading sits at
 * the end of the row it is about. Same information, opposite emphasis: you see
 * what was recorded, then what was made of it, and the second is checkable
 * against the first without leaving the row.
 *
 * ── The insight column is READ, never generated here ──────────────────────
 * Every summary was written when a day was submitted and stored then. Opening
 * this page calls no model, so it costs a query rather than a provider round
 * trip, and a row whose days have not been analysed yet prints an em dash —
 * which is honest, and better than making the reader wait for prose.
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
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatHours } from "@/app/_lib/format";

/** One instructor's measured period — the raw half of this screen. */
type Breakdown = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  expectedWorkingDays: number;
};

type Payload = {
  analytics: {
    from: string;
    to: string;
    instructors: Breakdown[];
  };
  /** Keyed by instructor id. Absent where nothing has been analysed yet. */
  insights: Record<string, CellInsight>;
};

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const COLUMNS = [
  { label: "Employee name" },
  { label: "Employee ID" },
  { label: "Working hours", align: "right" as const },
  { label: "Capacity", align: "right" as const },
  { label: "Utilisation", align: "right" as const },
  { label: "Days expected", align: "right" as const },
  /* Last, after everything it is describing. See `AiInsightCell`. */
  { label: "AI Insight" },
];

export default function ManagerInsightsPage() {
  const [severity, setSeverity] = useState("");

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) throw new Error("No university is linked to this account.");
    return apiGet<Payload>(
      `/api/universities/${me.user.universityId}/analytics`,
      "Could not load recorded activity.",
    );
  }, []);

  const { data, error, loading, reload } = useLoad(load, "manager-insights");

  /* Filtering by severity filters the ROWS, which is the point of putting the
     insight on the row: "show me the concerning ones" is a question about
     people and their hours, not about a list of sentences. A row with no
     insight yet cannot match a severity and drops out — that is correct, it has
     not been judged. */
  const rows = useMemo(() => {
    if (!data) return [];
    const all = data.analytics.instructors;
    if (!severity) return all;
    return all.filter((r) => data.insights[r.instructorId]?.severity === severity);
  }, [data, severity]);

  const totals = useMemo(() => {
    const list = data?.analytics.instructors ?? [];
    const recorded = list.reduce((n, r) => n + r.productiveHours, 0);
    const capacity = list.reduce((n, r) => n + r.capacityHours, 0);
    const flagged = list.filter((r) => {
      const s = data?.insights[r.instructorId]?.severity;
      return s === "HIGH" || s === "CRITICAL";
    }).length;
    return { people: list.length, recorded, capacity, flagged };
  }, [data]);

  const actions =
    data && data.analytics.instructors.length > 0 ? (
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
        description="What your roster recorded this period, and what was made of it. Every summary is derived from the figures in its own row."
        actions={actions}
      />

      {loading && !data ? (
        <TableSkeleton rows={6} cols={7} />
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
            <CardHeader
              title="By instructor"
              description={
                data
                  ? `${data.analytics.from} to ${data.analytics.to}`
                  : undefined
              }
            />

            {rows.length === 0 ? (
              <EmptyState
                title={severity ? "Nobody at that severity" : "Nothing recorded this period"}
                description={
                  severity
                    ? "Rows appear here once a day has been recorded and analysed."
                    : "Once instructors record their days, their figures appear here."
                }
              />
            ) : (
              <TableWrap>
                <Table caption="Recorded hours per instructor, with the stored reading of each.">
                  <THead columns={COLUMNS} />
                  <TBody>
                    {rows.map((r) => (
                      <TR key={r.instructorId}>
                        <TD strong>{r.instructorName}</TD>
                        <TD>
                          <span className="tabular">{r.employeeCode ?? "—"}</span>
                        </TD>
                        <TD align="right">{formatHours(r.productiveHours)}</TD>
                        <TD align="right">{formatHours(r.capacityHours)}</TD>
                        <TD align="right">
                          {/* Null is not zero. No capacity configured means the
                              ratio has no denominator, which is a different
                              thing from having worked none of it. */}
                          {r.utilizationPct === null ? (
                            <span className="text-subtle">—</span>
                          ) : (
                            `${Math.round(r.utilizationPct)}%`
                          )}
                        </TD>
                        <TD align="right">{r.expectedWorkingDays}</TD>
                        <TD>
                          <AiInsightCell insight={data?.insights[r.instructorId] ?? null} />
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
