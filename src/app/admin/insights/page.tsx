"use client";

/**
 * AI insights across every university.
 *
 * Assembled the same way as Managers: one request per university over an
 * endpoint that already exists (admin has access to every tenant's insights),
 * rather than a new cross-tenant endpoint (§39).
 *
 * NOTE: the schema supports a PLATFORM-scoped insight (`AiInsight.scope`,
 * `universityId: null`) with its own read path in `/api/insights/[id]`, but
 * there is no endpoint that LISTS platform-scoped insights — only per-university
 * ones. This page therefore shows every university-scoped insight; a genuinely
 * platform-wide insight (if one is ever created) would not appear here. That is
 * a backend gap, reported rather than patched with a new route in this pass.
 */

import { useCallback, useMemo, useState } from "react";
import { Card, EmptyState, ErrorState, PageHeader, Select } from "@/app/_components/ui";
import { InsightCard, type Insight } from "@/app/_components/interactive";
import { apiGet, useLoad } from "@/app/_lib/api";

type University = { id: string; name: string };
type Row = Insight & { universityName: string };

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export default function AdminInsightsPage() {
  const [severity, setSeverity] = useState("");
  const [universityFilter, setUniversityFilter] = useState("");

  const load = useCallback(async () => {
    const universities = await apiGet<{ universities: University[] }>(
      "/api/universities",
      "Could not load universities.",
    );

    const perUniversity = await Promise.all(
      universities.universities.map(async (u) => {
        const body = await apiGet<{ insights: Insight[] }>(
          `/api/universities/${u.id}/insights`,
          "Could not load insights.",
        ).catch(() => ({ insights: [] as Insight[] }));
        return body.insights.map((i) => ({ ...i, universityName: u.name }));
      }),
    );

    return { universities: universities.universities, rows: perUniversity.flat() as Row[] };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "admin-insights");

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(
      (r) =>
        (!severity || r.severity === severity) &&
        (!universityFilter || r.universityName === universityFilter),
    );
  }, [data, severity, universityFilter]);

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

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI Insights" />
        <Card padded>
          <p className="text-sm text-muted">Loading…</p>
        </Card>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI Insights" />
        <ErrorState message="Unable to load insights" detail={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Insights"
        description="Across every university. Each one is traceable to the metrics it was derived from."
        actions={actions}
      />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No insights yet"
            description="Insights are generated per university from its Analytics or AI Insights page once there is enough recorded activity."
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="No insights match those filters" />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={{ ...insight, period: insight.period ? `${insight.universityName} · ${insight.period}` : insight.universityName }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
