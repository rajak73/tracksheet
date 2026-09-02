"use client";

/**
 * Drill-down step 2: a university's health, managers and instructors (§28).
 */

import { use, useCallback } from "react";
import {
  Breadcrumb,
  ButtonLink,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
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
} from "@/app/_components/ui";
import { StaffForm } from "@/app/_components/StaffForm";
import { ManagerTable } from "@/app/_components/ManagerTable";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDate, formatHours } from "@/app/_lib/format";

type Manager = {
  id: string;
  employeeCode: string | null;
  isPrimary: boolean;
  /** This manager's OWN roster size, not the university total. */
  instructorCount: number;
  currentWeekWorkingHours: number;
  currentWeekDeliverables: number;
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
};
type Totals = {
  capacityHours: number;
  productiveHours: number;
};

export default function AdminUniversityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const load = useCallback(async () => {
    const [managers, analytics] = await Promise.all([
      apiGet<{
        managers: Manager[];
        universityName: string;
        universityCode: string | null;
        unassignedInstructors: number;
      }>(
        `/api/universities/${id}/managers`,
        "Could not load managers.",
      ),
      apiGet<{ analytics: { from: string; to: string; totals: Totals; instructors: InstructorRow[] } }>(
        `/api/universities/${id}/analytics`,
        "Could not load workload for this university.",
      ).catch(() => null),
    ]);
    return {
      managers: managers.managers,
      name: managers.universityName ?? "",
      code: managers.universityCode ?? null,
      unassignedInstructors: managers.unassignedInstructors ?? 0,
      analytics: analytics?.analytics ?? null,
    };
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
        title={data.code ? `${data.name} (${data.code})` : data.name}
        description={analytics ? `${formatDate(analytics.from)} to ${formatDate(analytics.to)}` : undefined}
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Universities", href: "/admin/universities" },
              { label: data.name },
              { label: "Managers" },
            ]}
          />
        }
        actions={
          <ButtonLink href={`/admin/universities/${id}/tracker`} variant="secondary">
            Weekly tracker
          </ButtonLink>
        }
      />

      {/* Health summary: headcount and whether the day was opened and closed.
          The tile that used to lead this row was Utilization — minutes
          recorded against the configured working day — and it answered a
          question nobody here is asking. A week of internal meetings scored
          exactly like a week of teaching, and the figure ran past 100% often
          enough that reading it as health was a mistake. The one hours figure
          this product stands behind is Working Hours, time spent with
          students, and the analytics endpoint behind this page does not
          separate it out. So the page shows what it can state honestly and
          leaves the hours to the weekly tracker, which does. */}
      {analytics ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatTile label="Instructors" value={analytics.instructors.length} />
            {/* Opening and closing compliance are gone. Both counted days
                carrying an entry of type DAILY_OPENING or DAILY_CLOSING — two
                codes out of sixteen — and the measure cannot be asked without a
                list of entry kinds to ask it about. */}
        </div>
      ) : null}

      {/* Managers — the drill-down step. Each row leads to that manager's own
          roster and weekly report, which is the level the hierarchy was
          missing: a university's people belong to a specific manager, not to
          the university at large. */}
      <Section title={`Managers (${data.managers.length})`}>
        {data.managers.length === 0 ? (
          <Card>
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
          </Card>
        ) : (
          <ManagerTable
            managers={data.managers}
            unassignedInstructors={data.unassignedInstructors}
            universityId={id}
          />
        )}
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
              {/* What the period expected, what was actually written down, and
                  where nothing was written at all. That is a coverage view,
                  and it is all these three columns ever were: the utilization
                  meter that used to close each row divided the second figure
                  by the first and presented the result as performance, which
                  it never was — a full calendar of meetings and a full
                  calendar of classes came out the same. Hours read as
                  `08h 30m` rather than `8.5`, because a column of decimal
                  hours is one nobody can add up while looking at it. */}
              <div className="hidden md:block">
                <TableWrap>
                  <Table caption="Instructors at this university">
                    <THead
                      columns={[
                        { label: "Instructor" },
                        { label: "Capacity", align: "right" },
                        { label: "Recorded", align: "right" },
                        { label: "No records", align: "right" },
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
                          <TD align="right">
                            <span className="tabular">{formatHours(i.capacityHours)}</span>
                          </TD>
                          <TD align="right">
                            <span className="tabular">{formatHours(i.productiveHours)}</span>
                          </TD>
                          <TD align="right">
                            <span className={i.missingDataHours > 0 ? "tabular text-warning" : "tabular"}>
                              {formatHours(i.missingDataHours)}
                            </span>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
              {/* Mobile carries the same three figures rather than a summary of
                  them, so the two layouts cannot tell different stories. */}
              <div className="md:hidden">
                <CardList>
                  {analytics.instructors.map((i) => (
                    <CardListItem
                      key={i.instructorId}
                      href={`/admin/instructors/${i.instructorId}`}
                      title={i.instructorName}
                      subtitle={`${formatHours(i.productiveHours)} recorded of ${formatHours(
                        i.capacityHours,
                      )} capacity`}
                      trailing={
                        i.missingDataHours > 0 ? (
                          <span className="tabular text-sm text-warning">
                            {formatHours(i.missingDataHours)} no records
                          </span>
                        ) : null
                      }
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
