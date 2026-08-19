"use client";

/**
 * Drill-down step 3 (admin): one manager and the instructors who report to
 * them.
 *
 * Universities → University → **Manager** → Instructor Report.
 *
 * The grid below is the SAME tracker every other reporting screen renders, just
 * asked for one roster: `?managerId=`. Nothing is recomputed here, so a
 * manager's hours on this page and the same manager's hours on the university
 * page cannot drift apart.
 */

import { use, useCallback } from "react";
import Link from "next/link";
import {
  Badge,
  Breadcrumb,
  Card,
  ErrorState,
  PageHeader,
  Section,
  StatTile,
  TableSkeleton,
} from "@/app/_components/ui";
import { TrackerReport } from "@/app/_components/TrackerReport";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatHours } from "@/app/_lib/format";

type Instructor = {
  id: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
};

/**
 * The one performance figure this page reads. The roster endpoint still
 * carries capacity and utilization, but nothing here asks for them, so they
 * are not named — a field declared on the client is a field somebody will
 * eventually render.
 */
type RosterPerf = {
  /** Time this manager's instructors spent with students. */
  workingHours: number;
};

type ManagerDetail = {
  id: string;
  employeeCode: string | null;
  universityId: string;
  university: { id: string; name: string; code: string };
  user: { name: string; email: string; isActive: boolean };
  isPrimary: boolean;
  instructorCount: number;
};

export default function AdminManagerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const load = useCallback(async () => {
    // The manager record is the anchor: it names the university, which
    // everything else here is scoped by. Reading it first means an empty roster
    // still renders a correct page rather than failing to resolve a tenant.
    const { manager } = await apiGet<{ manager: ManagerDetail }>(
      `/api/managers/${id}`,
      "Could not load this manager.",
    );
    const universityId = manager.universityId;

    const [roster, perfRows] = await Promise.all([
      apiGet<{ instructors: Instructor[] }>(
        `/api/instructors?managerId=${id}&limit=200`,
        "Could not load this manager's instructors.",
      ),
      apiGet<{ managers: Array<{ id: string } & RosterPerf> }>(
        `/api/managers?universityId=${universityId}&status=all`,
        "Could not load performance figures.",
      ).catch(() => ({ managers: [] as Array<{ id: string } & RosterPerf> })),
    ]);

    // One source for the hours figure: the same roster aggregation the Managers
    // list and the dashboard read, so a roster's hours here cannot disagree
    // with the same roster's hours one screen up. `null` when this manager is
    // absent from that response — an unknown figure renders as "—", never as a
    // confident zero.
    const perf = perfRows.managers.find((m) => m.id === id) ?? null;

    return { manager, perf, universityId, roster: roster.instructors };
  }, [id]);

  const { data, error, loading, reload } = useLoad(load, `admin-manager:${id}`);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Universities", href: "/admin/universities" },
              ...(data
                ? [
                    {
                      label: data.manager.university.name,
                      href: `/admin/universities/${data.universityId}`,
                    },
                  ]
                : []),
              { label: "Managers" },
              { label: data?.manager.user.name ?? "…" },
            ]}
          />
        }
        title={
          data
            ? `${data.manager.user.name}${
                data.manager.employeeCode ? ` (${data.manager.employeeCode})` : ""
              }`
            : "Manager"
        }
        description={data ? `${data.manager.university.name} (${data.manager.university.code}) · ${data.manager.user.email}` : undefined}
      />

      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <TableSkeleton /> : null}

      {data ? (
        <>
          {data.manager.isPrimary || !data.manager.user.isActive ? (
            <div className="flex flex-wrap items-center gap-2">
              {data.manager.isPrimary ? <Badge tone="primary">Primary manager</Badge> : null}
              {!data.manager.user.isActive ? <Badge tone="warning">Deactivated</Badge> : null}
            </div>
          ) : null}

          {/* Two KPIs for the current week. The roster count is the list
              rendered directly below it, so the heading and the tile can never
              disagree; the hours come from the roster aggregation the Managers
              list quotes, so this manager reads the same on both screens.

              Working Hours is the roster's time WITH STUDENTS — lectures,
              practice, exams, mentoring, student support — and it is the only
              hours figure the product keeps. The three that used to sit beside
              it answered nothing about students. Utilization divided every
              recorded minute by a configured working day, so a week of
              internal meetings scored like a week of teaching. "Deliverable"
              and "non-deliverable" hours split the same minutes by whether the
              activity type was literally "Deliverable Work", which filed
              lectures and exams under non-deliverable — the label said the
              opposite of what it counted. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile label="Assigned instructors" value={data.roster.length} />
            <StatTile
              label="Working Hours"
              value={formatHours(data.perf?.workingHours ?? null)}
            />
          </div>

          <Section title={`Assigned instructors (${data.roster.length})`}>
            {data.roster.length === 0 ? (
              <Card>
                <p className="px-5 py-6 text-sm text-muted">
                  Nobody reports to this manager yet. Assign instructors from the{" "}
                  <Link href="/admin/instructors" className="text-primary hover:underline">
                    instructor directory
                  </Link>
                  .
                </p>
              </Card>
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {data.roster.map((i) => (
                    <li key={i.id}>
                      <Link
                        href={`/admin/instructors/${i.id}/report`}
                        className="flex items-center justify-between px-5 py-3 hover:bg-hovered"
                      >
                        <span>
                          <span className="block font-medium text-content">{i.user.name}</span>
                          <span className="tabular block text-xs text-muted">
                            {i.employeeCode ?? "—"} · {i.user.email}
                          </span>
                        </span>
                        {!i.user.isActive ? <Badge tone="warning">Former</Badge> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>

          <Section title="Weekly report">
            <TrackerReport
              universityId={data.universityId}
              managerId={id}
              emptyHint="Nothing was recorded by this manager's instructors in the selected period."
            />
          </Section>
        </>
      ) : null}
    </div>
  );
}
