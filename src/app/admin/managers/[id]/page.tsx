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

import { use, useCallback, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Breadcrumb,
  ErrorState,
  PageHeader,
  Section,
  StatTile,
  TableSkeleton,
} from "@/app/_components/ui";
import { TrackerReport } from "@/app/_components/TrackerReport";
import type { Tracker } from "@/app/_components/TrackerGrid";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatHours } from "@/app/_lib/format";
import { TimeZoneProvider } from "@/app/_lib/zone";

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
  university: { id: string; name: string; code: string; timezone: string };
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

  /* Filled by the report below, which owns the period picker. `setTotals` is
   * stable, so passing it straight down does not re-fire the effect that
   * feeds it. */
  const [totals, setTotals] = useState<Tracker["totals"] | null>(null);

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
        /* ── The summary, on the header's own row ─────────────────────────
         * Beside the manager's name rather than stacked under it: these two
         * figures are what the page is about, and `PageHeader` aligns its
         * actions slot with the top of the header — the breadcrumb line, not
         * the title beneath it.
         *
         * They are FED by the report below through `onTotals`, because only it
         * knows which period is selected — it owns the picker and does its own
         * fetch. Assembled here instead they would be pinned to whatever this
         * page loaded, which is the fault that had two Working Hours tiles on
         * one screen disagreeing the moment somebody chose Current Month.
         * Passing them up MOVES the row: the report drops its own when asked.
         *
         * Absent until the report has loaded, so the header does not reserve
         * space for a figure it cannot yet state. Instructors is the
         * instructors in the selected period, not the size of the roster —
         * the better of the two questions on a page about whether a manager's
         * roster is recording. */
        actions={
          totals ? (
            <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
              <div className="min-w-[10rem]">
                <StatTile label="Instructors" value={totals.instructors} emphasis />
              </div>
              <div className="min-w-[10rem]">
                <StatTile
                  label="Working Hours"
                  value={formatHours(totals.totalWorkingHours)}
                  emphasis
                />
              </div>
            </div>
          ) : undefined
        }
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

          {data.roster.length === 0 ? (
            <p className="text-sm text-muted">
              Nobody reports to this manager yet. Assign instructors from the{" "}
              <Link href="/admin/instructors" className="text-primary hover:underline">
                instructor directory
              </Link>
              .
            </p>
          ) : null}

          <Section title="Weekly report">
            {/* The SUBJECT's zone, not the admin's — see the note on the
                university tracker page. */}
            <TimeZoneProvider timeZone={data.manager.university.timezone}>
              <TrackerReport
                universityId={data.universityId}
                managerId={id}
                onTotals={setTotals}
                emptyHint="Nothing was recorded by this manager's instructors in the selected period."
              />
            </TimeZoneProvider>
          </Section>
        </>
      ) : null}
    </div>
  );
}
