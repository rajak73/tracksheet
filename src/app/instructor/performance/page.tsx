"use client";

/**
 * "How am I doing?" — one instructor's own performance.
 *
 * ── Not a copy of the admin or manager analytics page ──────────────────────
 * Those answer "who should I look at". This answers a question about one
 * person, so it drops rankings, comparisons and other people entirely. What it
 * keeps is the definitions: the same tracker the manager and admin read, asked
 * for one instructor, so nobody is ever shown a different number for the same
 * week than their manager sees.
 *
 * ── Where each figure comes from ───────────────────────────────────────────
 * The tracker is the single source. Every week's cell arrives carrying its
 * entries, and each entry already carries the answer to the only question this
 * screen turns on — whether those hours were spent WITH STUDENTS — so:
 *
 *     workingHours  = the hours on entries that count, added up per week
 *     recordedHours = the engine's productive hours — every category except
 *                     known idle time, which is why it is not called "logged"
 *
 * Working Hours is read from the entries and never from the engine's own
 * total, because countability lives on the DELIVERABLE and the engine never
 * loads one — see `countsAsWorkingHours`. Adding up the countable entries is
 * the same arithmetic `rollUp` and the tracker grid do, which is what keeps
 * this page and the manager's grid describing the same week.
 *
 * ── Two figures, and why both are named ────────────────────────────────────
 * A week is 40 recorded hours and 12 of them in front of students; an
 * instructor is owed both numbers, each under the name of what it measures.
 * "Working hours" used to be the recorded total, so preparation, meetings and
 * admin were being reported back as time with students.
 *
 * ── What this screen no longer shows ───────────────────────────────────────
 * Utilization, and with it the band and the performance-status badge: it
 * divided recorded minutes by the configured working day, which says nothing
 * about students — a week of internal meetings scored exactly as a week of
 * lectures — and it read over 100% routinely. The deliverable and
 * non-deliverable hours went with it: they split a week by whether the
 * ACTIVITY CATEGORY was literally "Deliverable Work", which filed lectures and
 * exams under "non-deliverable". Two more names for the same hours, both
 * saying something other than what they measured.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  StatTile,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDateShort, formatHours, humanizeCode } from "@/app/_lib/format";
import { isStudentFacingCategory } from "@/domain/working-hours";
import { AiRecommendations } from "@/app/_components/AiRecommendations";

type Week = { index: number; from: string; to: string; labelFrom: string | null; labelTo: string | null };

type Entry = {
  title: string;
  hours: number;
  /** Whether these hours are time with students. Decided by the tracker. */
  countable: boolean;
};

type Cell = {
  deliverables: Entry[];
  quantity: number;
  totalWorkingHours: number;
  hoursByCategory: Record<string, number>;
};

type Tracker = {
  from: string;
  to: string;
  weeks: Week[];
  rows: Array<{
    instructorId: string;
    cells: Record<number, Cell>;
    totals: {
      quantity: number;
      totalWorkingHours: number;
    };
  }>;
};

/**
 * Working Hours for one week: the hours on entries that count as time with
 * students. The flag is the tracker's own — an entry's deliverable decides,
 * and its category decides when it has none — so this page cannot arrive at a
 * different answer than the grid a manager opens for the same week.
 */
function studentFacingHours(cell: Cell | undefined): number {
  const hours = (cell?.deliverables ?? []).reduce((n, d) => n + (d.countable ? d.hours : 0), 0);
  return Math.round(hours * 100) / 100;
}

/** How many weeks of history to show. Bounded: the tracker caps at 26. */
const SPANS: Array<[number, string]> = [
  [4, "Last 4 weeks"],
  [8, "Last 8 weeks"],
  [12, "Last 12 weeks"],
];

export default function InstructorPerformancePage() {
  const [span, setSpan] = useState(4);

  const load = useCallback(async () => {
    const me = await fetchMe();
    const universityId = me.user.universityId;
    if (!universityId) throw new Error("No university is linked to your account.");

    // Walk back `span` whole weeks from this Monday.
    const now = new Date();
    const monday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const to = monday.toISOString().slice(0, 10);
    const fromDate = new Date(monday);
    fromDate.setUTCDate(fromDate.getUTCDate() - (span - 1) * 7);
    const from = fromDate.toISOString().slice(0, 10);

    // Self-scoped: the route pins the row to this instructor, so no id is sent.
    const { tracker } = await apiGet<{ tracker: Tracker }>(
      `/api/universities/${universityId}/tracker?from=${from}&to=${to}`,
      "Could not load your performance.",
    );
    return tracker;
  }, [span]);

  const { data, error, loading, reload } = useLoad(load, `instructor-performance:${span}`);

  const view = useMemo(() => {
    const row = data?.rows[0];
    if (!data || !row) return null;

    const weeks = [...data.weeks]
      .map((w) => {
        const cell = row.cells[w.index];
        return {
          week: w,
          workingHours: studentFacingHours(cell),
          recordedHours: cell?.totalWorkingHours ?? 0,
          quantity: cell?.quantity ?? 0,
        };
      })
      .reverse(); // newest first — the week you are in matters most.

    const byType: Record<string, number> = {};
    for (const w of data.weeks) {
      for (const [code, hrs] of Object.entries(row.cells[w.index]?.hoursByCategory ?? {})) {
        byType[code] = Math.round(((byType[code] ?? 0) + hrs) * 100) / 100;
      }
    }

    return {
      weeks,
      byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
      totals: {
        // The period's Working Hours is its weeks added up, rather than a
        // second pass over the same entries — the tile and the column below it
        // then cannot disagree about the period they both describe.
        workingHours: Math.round(weeks.reduce((n, w) => n + w.workingHours, 0) * 100) / 100,
        recordedHours: row.totals.totalWorkingHours,
        quantity: row.totals.quantity,
      },
    };
  }, [data]);

  const maxType = view?.byType[0]?.[1] ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Performance"
        description="Your own recorded work. These are the same figures your manager sees."
        actions={
          <div className="flex flex-wrap gap-2">
            {SPANS.map(([weeks, label]) => (
              <Button
                key={weeks}
                type="button"
                size="sm"
                variant={span === weeks ? "primary" : "secondary"}
                onClick={() => setSpan(weeks)}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />

      {error ? <ErrorState message="Unable to load your performance" detail={error} onRetry={reload} /> : null}
      {loading && !data ? <TableSkeleton cols={4} /> : null}

      {view ? (
        <>
          {/* The two hour figures and what was counted. Neither is a share of a
              working day: how much of a configured day was filled is not a
              measure of teaching, and it is not what an instructor is asking
              this page. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              label="Working Hours"
              value={formatHours(view.totals.workingHours)}
              hint="Time spent with students."
              emphasis
            />
            <StatTile
              label="Recorded hours"
              value={formatHours(view.totals.recordedHours)}
              hint="All the work you logged, students or not."
            />
            <StatTile label="Deliverable quantity" value={view.totals.quantity} />
          </div>

          <Section title="Week by week" description="Newest first.">
            <Card>
              {view.weeks.length === 0 ? (
                <EmptyState title="No weeks in this period" />
              ) : (
                <TableWrap>
                  <Table caption="Your performance by week">
                    <THead
                      columns={[
                        { label: "Week" },
                        { label: "Working Hours", align: "right" },
                        { label: "Recorded hours", align: "right" },
                        { label: "Deliverable qty", align: "right" },
                      ]}
                    />
                    <TBody>
                      {view.weeks.map((w) => (
                        <TR key={w.week.index}>
                          <TD strong>
                            <span className="tabular">
                              {formatDateShort(w.week.labelFrom ?? w.week.from)} –{" "}
                              {formatDateShort(w.week.labelTo ?? w.week.to)}
                            </span>
                          </TD>
                          <TD align="right">
                            <span className="tabular">{formatHours(w.workingHours)}</span>
                          </TD>
                          <TD align="right">
                            <span className="tabular">{formatHours(w.recordedHours)}</span>
                          </TD>
                          <TD align="right">
                            <span className="tabular">{w.quantity}</span>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </Card>
          </Section>

          <Section
            title="Where your hours went"
            description="Across the selected period. Highlighted categories are the ones that count toward Working Hours."
          >
            <Card>
              {view.byType.length === 0 ? (
                <EmptyState
                  title="Nothing recorded yet"
                  description="Log activity from the Activity Tracker and it will appear here."
                />
              ) : (
                <ul className="space-y-3 px-5 py-4">
                  {view.byType.map(([code, hours]) => (
                    <li key={code}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-content">{humanizeCode(code)}</span>
                        <span className="tabular text-muted">{formatHours(hours)}</span>
                      </div>
                      {/* Proportional to the largest bar, so the shape of the
                          week is readable without inventing a scale.

                          The tint is the same distinction the tiles are built
                          on — time with students, and everything else. A bar is
                          a whole category, so it is coloured by the category
                          rule alone and an hour of exam preparation is tinted
                          with the exam it belongs to; the exact figure is the
                          tile above, which reads each entry. The tint used to
                          single out the "Deliverable Work" category, which
                          shaded lectures and exams as though they were not the
                          work being delivered. */}
                      <div className="h-2 w-full overflow-hidden rounded-full bg-sunken">
                        <div
                          className={`h-full rounded-full ${
                            isStudentFacingCategory(code) ? "bg-primary" : "bg-info"
                          }`}
                          style={{ width: `${maxType > 0 ? (hours / maxType) * 100 : 0}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>
        </>
      ) : null}

      {data && !view ? (
        <Card>
          <EmptyState
            title="Nothing recorded in this period"
            description="Once you log activity it will appear here, week by week."
          />
        </Card>
      ) : null}

      {/* About this person only. */}
      <AiRecommendations title="AI recommendations for you" />
    </div>
  );
}
