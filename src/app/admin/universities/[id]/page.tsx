"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge, Breadcrumb, Card, CardBody, CardHeader, EmptyState, ErrorState, Meter,
  PageHeader, Skeleton, Table, TableWrap, TBody, TD, THead, TR, utilizationTone,
} from "@/app/_components/ui";
import { StaffForm } from "@/app/_components/StaffForm";

type Manager = {
  id: string; employeeCode: string | null; isPrimary: boolean; instructorCount: number;
  user: { name: string; email: string; isActive: boolean };
};
type InstructorRow = {
  instructorId: string; instructorName: string; employeeCode: string | null;
  capacityHours: number; productiveHours: number; unutilizedHours: number;
  missingDataHours: number; utilizationPct: number | null;
};

/** Drill-down step 2: university → managers + instructors. */
export default function AdminUniversityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState("");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [instructors, setInstructors] = useState<InstructorRow[]>([]);
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [mRes, aRes] = await Promise.all([
          fetch(`/api/universities/${id}/managers`),
          fetch(`/api/universities/${id}/analytics`),
        ]);
        if (!mRes.ok) return setError(`Could not load managers (HTTP ${mRes.status})`);
        const m = await mRes.json();
        setManagers(m.managers);
        setName(m.universityName ?? "");
        if (aRes.ok) {
          const a = (await aRes.json()).analytics;
          setInstructors(a.instructors);
          setPeriod({ from: a.from, to: a.to });
        }
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-72" />
        <Card padded><Skeleton className="h-20 w-full" /></Card>
        <Card padded><Skeleton className="h-40 w-full" /></Card>
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        description={period ? `${period.from} to ${period.to}` : undefined}
        breadcrumb={<Breadcrumb items={[{ label: "Universities", href: "/admin/universities" }, { label: name }]} />}
      />

      <Card>
        <CardHeader title="Managers" />
        {managers.length === 0 ? (
          <CardBody>
            <p className="mb-4 text-sm text-muted">
              No manager assigned. The first manager created becomes the primary manager.
            </p>
            <StaffForm
              endpoint={`/api/universities/${id}/managers`}
              roleLabel="manager"
              onCreated={() => window.location.reload()}
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {managers.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-content">
                    {m.user.name}
                    {m.isPrimary ? <span className="ml-2"><Badge tone="primary">Primary</Badge></span> : null}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{m.user.email}</p>
                </div>
                <span className="text-sm text-muted">{m.instructorCount} instructor(s)</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Instructors" description="Select one to drill into their days." />
        {instructors.length === 0 ? (
          <EmptyState
            title="No instructors yet"
            description="This university's manager adds instructors from their own dashboard."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead
                columns={[
                  { label: "Instructor" }, { label: "Capacity", align: "right" },
                  { label: "Productive", align: "right" }, { label: "Missing", align: "right" },
                  { label: "Utilization" },
                ]}
              />
              <TBody>
                {instructors.map((i) => (
                  <TR key={i.instructorId}>
                    <TD strong>
                      <Link href={`/admin/instructors/${i.instructorId}`} className="text-primary hover:underline">
                        {i.instructorName}
                      </Link>
                    </TD>
                    <TD align="right">{i.capacityHours}</TD>
                    <TD align="right">{i.productiveHours}</TD>
                    <TD align="right">
                      {i.missingDataHours > 0 ? <span className="text-warning">{i.missingDataHours}</span> : 0}
                    </TD>
                    <TD><Meter value={i.utilizationPct} tone={utilizationTone(i.utilizationPct)} /></TD>
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
