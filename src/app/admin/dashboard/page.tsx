"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert, Badge, Card, CardHeader, EmptyState, ErrorState, Meter, PageHeader,
  StatGridSkeleton, StatTile, Table, TableSkeleton, TableWrap, TBody, TD, THead, TR,
  complianceTone, utilizationTone,
} from "@/app/_components/ui";

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
};

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [universities, setUniversities] = useState<UniversityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/overview");
        if (!res.ok) {
          setError(`Could not load platform metrics (HTTP ${res.status})`);
          return;
        }
        const data = await res.json();
        setOverview(data.overview);
        setUniversities(data.universities);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="Platform-wide metrics across all universities." />
        <StatGridSkeleton />
        <TableSkeleton cols={7} />
      </div>
    );
  }

  if (error || !overview) return <ErrorState message={error ?? "No data returned."} />;

  const period = universities[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={
          period
            ? `Platform-wide metrics · ${period.from} to ${period.to}`
            : "Platform-wide metrics across all universities."
        }
      />

      {/* Utilisation leads: it is the one number that answers "is capacity
          being used?", which is what this product exists to tell an admin. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Utilization"
          value={overview.utilizationPct}
          suffix="%"
          tone={utilizationTone(overview.utilizationPct)}
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Universities" value={overview.totalUniversities} />
        <StatTile label="Managers" value={overview.totalManagers} />
        <StatTile label="Active instructors" value={overview.totalInstructors} />
        <StatTile
          label="Open insights"
          value={overview.openInsights}
          tone={overview.openInsights > 0 ? "info" : "neutral"}
        />
      </div>

      {overview.missingDataHours > 0 ? (
        <Alert tone="warning" title="Some working time has no records">
          {overview.missingDataHours} hours of expected working time carry no activity records.
          These are reported as missing data, not as unutilized time — the figures above should
          be read with that in mind.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="University comparison"
          description="Select a university to drill into its managers and instructors."
        />
        {universities.length === 0 ? (
          <EmptyState
            title="No universities yet"
            description="Create the first university to start tracking workload."
            action={
              <Link
                href="/admin/universities/new"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
              >
                Create a university
              </Link>
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <THead
                columns={[
                  { label: "University" },
                  { label: "Instructors", align: "right" },
                  { label: "Capacity", align: "right" },
                  { label: "Productive", align: "right" },
                  { label: "Utilization" },
                  { label: "Opening" },
                  { label: "Closing" },
                ]}
              />
              <TBody>
                {universities.map((u) => (
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
        )}
      </Card>
    </div>
  );
}
