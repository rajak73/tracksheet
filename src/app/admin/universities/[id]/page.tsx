"use client";

/**
 * Drill-down step 2: a university's health, managers and instructors (§28).
 */

import { use, useCallback } from "react";
import {
  Badge,
  Breadcrumb,
  ButtonLink,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Meter,
  PageHeader,
  Section,
  Skeleton,
  StatTile,
  Table,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  complianceLabel,
  complianceTone,
  utilizationLabel,
  utilizationTone,
} from "@/app/_components/ui";
import { StaffForm } from "@/app/_components/StaffForm";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDate } from "@/app/_lib/format";

type Manager = {
  id: string;
  employeeCode: string | null;
  isPrimary: boolean;
  instructorCount: number;
  user: { name: string; email: string; isActive: boolean };
};
type InstructorRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
};
type Totals = {
  capacityHours: number;
  productiveHours: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

export default function AdminUniversityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const load = useCallback(async () => {
    const [managers, analytics] = await Promise.all([
      apiGet<{ managers: Manager[]; universityName: string }>(
        `/api/universities/${id}/managers`,
        "Could not load managers.",
      ),
      apiGet<{ analytics: { from: string; to: string; totals: Totals; instructors: InstructorRow[] } }>(
        `/api/universities/${id}/analytics`,
        "Could not load workload for this university.",
      ).catch(() => null),
    ]);
    return { managers: managers.managers, name: managers.universityName ?? "", analytics: analytics?.analytics ?? null };
  }, [id]);

  const { data, error, loading, reload } = useLoad(load, id);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-72" />
        <Card padded>
          <Skeleton className="h-20 w-full" />
        </Card>
        <Card padded>
          <Skeleton className="h-40 w-full" />
        </Card>
      </div>
    );
  }
  if (error || !data) return <ErrorState message="Unable to load this university" detail={error ?? undefined} onRetry={reload} />;

  const { analytics } = data;

  return (
    <div className="space-y-8">
      <PageHeader
        title={data.name}
        description={analytics ? `${formatDate(analytics.from)} to ${formatDate(analytics.to)}` : undefined}
        breadcrumb={<Breadcrumb items={[{ label: "Universities", href: "/admin/universities" }, { label: data.name }]} />}
        actions={
          <ButtonLink href={`/admin/universities/${id}/tracker`} variant="secondary">
            Weekly tracker
          </ButtonLink>
        }
      />

      {/* Health summary. */}
      {analytics ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Utilization"
            value={analytics.totals.utilizationPct}
            suffix="%"
            tone={utilizationTone(analytics.totals.utilizationPct)}
            status={utilizationLabel(analytics.totals.utilizationPct)}
            emphasis
          />
          <StatTile label="Instructors" value={analytics.instructors.length} />
          <StatTile
            label="Opening compliance"
            value={analytics.totals.openingCompliancePct}
            suffix="%"
            tone={complianceTone(analytics.totals.openingCompliancePct)}
            status={complianceLabel(analytics.totals.openingCompliancePct)}
          />
          <StatTile
            label="Closing compliance"
            value={analytics.totals.closingCompliancePct}
            suffix="%"
            tone={complianceTone(analytics.totals.closingCompliancePct)}
            status={complianceLabel(analytics.totals.closingCompliancePct)}
          />
        </div>
      ) : null}

      {/* Manager. */}
      <Section title="Manager">
        <Card>
          {data.managers.length === 0 ? (
            <div className="p-5">
              <p className="mb-4 text-sm text-muted">
                No manager assigned. The first manager created becomes the primary manager.
              </p>
              <StaffForm
                endpoint={`/api/universities/${id}/managers`}
                roleLabel="manager"
                onCreated={reload}
              />
            </div>
          ) : (
            <CardList>
              {data.managers.map((m) => (
                <CardListItem
                  key={m.id}
                  title={
                    <>
                      {m.user.name}
                      {m.isPrimary ? (
                        <span className="ml-2">
                          <Badge tone="primary">Primary</Badge>
                        </span>
                      ) : null}
                    </>
                  }
                  subtitle={m.user.email}
                  trailing={<span className="text-sm text-muted">{m.instructorCount} instructor(s)</span>}
                />
              ))}
            </CardList>
          )}
        </Card>
      </Section>

      {/* Instructor overview. */}
      <Section title="Instructors" description="Select one to drill into their days.">
        <Card>
          {!analytics || analytics.instructors.length === 0 ? (
            <EmptyState
              title="No instructors yet"
              description="This university's manager adds instructors from their own dashboard."
            />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap>
                  <Table caption="Instructors at this university">
                    <THead
                      columns={[
                        { label: "Instructor" },
                        { label: "Capacity", align: "right" },
                        { label: "Recorded", align: "right" },
                        { label: "No records", align: "right" },
                        { label: "Utilization" },
                      ]}
                    />
                    <TBody>
                      {analytics.instructors.map((i) => (
                        <TR key={i.instructorId}>
                          <TD strong>
                            <a
                              href={`/admin/instructors/${i.instructorId}`}
                              className="text-primary hover:underline"
                            >
                              {i.instructorName}
                            </a>
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
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
              <div className="md:hidden">
                <CardList>
                  {analytics.instructors.map((i) => (
                    <CardListItem
                      key={i.instructorId}
                      href={`/admin/instructors/${i.instructorId}`}
                      title={i.instructorName}
                      meta={<Meter value={i.utilizationPct} tone={utilizationTone(i.utilizationPct)} />}
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
