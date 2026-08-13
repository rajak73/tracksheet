"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert, Badge, Button, Card, CardHeader, Dot, EmptyState, ErrorState, Meter,
  PageHeader, StatGridSkeleton, StatTile, Table, TableSkeleton, TableWrap, TBody,
  TD, THead, TR, complianceTone, utilizationTone, type Tone,
} from "@/app/_components/ui";

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

type Analytics = {
  from: string;
  to: string;
  totals: {
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
  instructors: InstructorRow[];
};

type AiInsight = {
  id: string;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  period: string;
  title?: string;
  summary?: string;
  recommendation: string;
};

type Notification = { id: string; title: string; message: string };

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "info",
};

export default function ManagerDashboardPage() {
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        setError("Your session has expired.");
        return;
      }
      const me = await meRes.json();
      const uid = me.user.universityId as string;
      setUniversityId(uid);

      const [aRes, iRes, nRes] = await Promise.all([
        fetch(`/api/universities/${uid}/analytics`),
        fetch(`/api/universities/${uid}/insights`),
        fetch(`/api/notifications`),
      ]);

      if (aRes.ok) setAnalytics((await aRes.json()).analytics);
      else setError(`Could not load analytics (HTTP ${aRes.status})`);

      if (iRes.ok) setInsights((await iRes.json()).insights);
      if (nRes.ok) setNotifications((await nRes.json()).notifications);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function generateInsights() {
    if (!universityId) return;
    setGenerating(true);
    try {
      await fetch(`/api/universities/${universityId}/insights`, { method: "POST" });
      const res = await fetch(`/api/universities/${universityId}/insights`);
      if (res.ok) setInsights((await res.json()).insights);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="Your university's workload this period." />
        <StatGridSkeleton />
        <TableSkeleton cols={6} />
      </div>
    );
  }

  if (error || !analytics) return <ErrorState message={error ?? "No data returned."} />;

  const t = analytics.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`${analytics.from} to ${analytics.to}`}
        actions={
          <Link
            href="/manager/reports"
            className="rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-content hover:bg-hovered"
          >
            View reports
          </Link>
        }
      />

      {notifications.length > 0 ? (
        <Alert tone="info" title={`${notifications.length} unread notification${notifications.length === 1 ? "" : "s"}`}>
          {notifications[0].title}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Utilization"
          value={t.utilizationPct}
          suffix="%"
          tone={utilizationTone(t.utilizationPct)}
          emphasis
          hint={`${t.productiveHours} of ${t.capacityHours} hrs`}
        />
        <StatTile label="Instructors" value={t.instructors} />
        <StatTile
          label="Opening compliance"
          value={t.openingCompliancePct}
          suffix="%"
          tone={complianceTone(t.openingCompliancePct)}
        />
        <StatTile
          label="Closing compliance"
          value={t.closingCompliancePct}
          suffix="%"
          tone={complianceTone(t.closingCompliancePct)}
        />
      </div>

      {t.missingDataHours > 0 ? (
        <Alert tone="warning" title="Some working time has no records">
          {t.missingDataHours} hours carry no activity records. That is missing data, not
          unutilized time.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Instructor workload" description="Utilization against configured capacity." />
        {analytics.instructors.length === 0 ? (
          <EmptyState
            title="No active instructors"
            description="Add instructors to start tracking workload for this university."
            action={
              <Link
                href="/manager/instructors"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
              >
                Add an instructor
              </Link>
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <THead
                columns={[
                  { label: "Instructor" },
                  { label: "Capacity", align: "right" },
                  { label: "Productive", align: "right" },
                  { label: "Missing", align: "right" },
                  { label: "Utilization" },
                  { label: "Open / Close" },
                ]}
              />
              <TBody>
                {analytics.instructors.map((i) => (
                  <TR key={i.instructorId}>
                    <TD strong>
                      {i.instructorName}
                      {i.employeeCode ? (
                        <span className="ml-2 text-xs text-subtle">{i.employeeCode}</span>
                      ) : null}
                      {i.overlapHours > 0 ? (
                        <span className="ml-2">
                          <Badge tone="warning">overlap</Badge>
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
                      <Meter value={i.utilizationPct} tone={utilizationTone(i.utilizationPct)} />
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={complianceTone(i.openingCompliancePct)}>
                          {i.openingCompliancePct === null ? "—" : `${i.openingCompliancePct}%`}
                        </Badge>
                        <Badge tone={complianceTone(i.closingCompliancePct)}>
                          {i.closingCompliancePct === null ? "—" : `${i.closingCompliancePct}%`}
                        </Badge>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHeader
          title="AI insights"
          description="Derived from recorded activity — each one traceable to its metrics."
          actions={
            <Button size="sm" variant="secondary" onClick={generateInsights} disabled={generating}>
              {generating ? "Generating…" : "Generate"}
            </Button>
          }
        />
        {insights.length === 0 ? (
          <EmptyState
            title="No insights yet"
            description="Insights are derived from recorded activity. If nothing has been logged for this period, none will be generated."
          />
        ) : (
          <ul className="divide-y divide-line">
            {insights.map((insight) => (
              <li key={insight.id} className="flex gap-3 px-5 py-4">
                <span className="mt-1.5">
                  <Dot tone={SEVERITY_TONE[insight.severity] ?? "neutral"} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-sm font-medium text-content">
                      {insight.title ?? insight.type.replaceAll("_", " ")}
                    </p>
                    <span className="text-xs text-subtle">{insight.period}</span>
                  </div>
                  {insight.summary ? (
                    <p className="mt-1 text-sm text-muted">{insight.summary}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-muted">{insight.recommendation}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
