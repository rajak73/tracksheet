"use client";

/**
 * All AI insights for the manager's university, with severity filtering.
 *
 * Generation is explicit (§23 — a recommendation, not a background job the
 * manager cannot see run) and every card is the same InsightCard used on the
 * dashboard, so there is exactly one visual definition of an insight in the
 * whole product (§24).
 */

import { useCallback, useMemo, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
} from "@/app/_components/ui";
import { InsightCard, type Insight, useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export default function ManagerInsightsPage() {
  const toast = useToast();
  const [severity, setSeverity] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) throw new Error("No university is linked to this account.");
    const body = await apiGet<{ insights: Insight[] }>(
      `/api/universities/${me.user.universityId}/insights`,
      "Could not load insights.",
    );
    return { universityId: me.user.universityId, insights: body.insights };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "manager-insights");

  const rows = useMemo(() => {
    if (!data) return [];
    return severity ? data.insights.filter((i) => i.severity === severity) : data.insights;
  }, [data, severity]);

  async function generate() {
    if (!data) return;
    setGenerating(true);
    try {
      await apiSend(
        `/api/universities/${data.universityId}/insights`,
        "POST",
        undefined,
        "Could not generate insights just now.",
      );
      toast("success", "Insights generated for this period.");
      reload();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not generate insights just now.");
    } finally {
      setGenerating(false);
    }
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {data && data.insights.length > 0 ? (
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
      ) : null}
      <Button variant="secondary" onClick={generate} disabled={generating}>
        {generating ? "Generating…" : "Generate insights"}
      </Button>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI Insights" actions={actions} />
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
        description="Derived from recorded activity — each one traceable to its metrics. Never a character judgement."
        actions={actions}
      />

      {data.insights.length === 0 ? (
        <Card>
          <EmptyState
            title="No insights yet"
            description="Insights are derived from recorded activity. Generate them once this period has enough recorded data."
            action={
              <Button variant="secondary" onClick={generate} disabled={generating}>
                {generating ? "Generating…" : "Generate insights"}
              </Button>
            }
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="No insights at that severity" />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}
