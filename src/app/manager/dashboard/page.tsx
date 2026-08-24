"use client";

/**
 * The manager's dashboard.
 *
 * ── Four figures, then the roster, then the shape of the month ────────────
 * The order is the order the questions get asked. "Is my team in today?" is
 * answered before anything else and in four numbers; "who, exactly?" is the
 * table under them; "how has the month gone, and where did the hours go?" sits
 * beside both because it is context rather than an alert.
 *
 * ── Today's figures never follow the table's date ─────────────────────────
 * The four cards read TODAY and keep reading today when somebody pages the
 * table back to last Tuesday. A card labelled "Logged Today" that quietly
 * became last Tuesday's count would be worse than no card: it is the number
 * people repeat without re-reading the label.
 *
 * ── Nothing here is computed in the browser ───────────────────────────────
 * Every hour, percentage and count arrives derived from `computeAnalytics`.
 * The page arranges and formats; it never adds up a column, because a total the
 * page invents is a total that can disagree with the one the report carries.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Button,
  SearchInput,
  Select,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  StatGridSkeleton,
  TableSkeleton,
} from "@/app/_components/ui";
import {
  Change,
  DayTimelineCard,
  HoursDonut,
  KpiCard,
  WeekBars,
  type DayInstructor,
  type Slice,
  type WeekBar,
} from "@/app/_components/ManagerDashboard";
import {
  IconAlert,
  IconChevronDown,
  IconDownload,
  IconCheck,
  IconClock,
  IconUsers,
} from "@/app/_components/icons";
import { useToast } from "@/app/_components/interactive";
import { formatDuration, type Activity } from "@/app/_components/workload";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { useUniversityToday } from "@/app/_lib/zone";
import { formatDayAs } from "@/app/_lib/format";
import { pingNotifications } from "@/app/_components/NotificationBell";
import { Avatar } from "@/app/_components/AccountDialogs";
import { rollUp } from "@/domain/rollup";

/* ── Shapes ───────────────────────────────────────────────────────────────── */

type Overview = {
  timezone: string | null;
  today: {
    date: string;
    instructors: number;
    expected: number;
    logged: number;
    missing: number;
    loggedPct: number | null;
    hours: number;
    activities: number;
    yesterday: { hours: number | null; deltaPct: number | null; direction: string };
  } | null;
  month: { month: string; from: string; to: string; totalHours: number; weeks: WeekBar[] } | null;
  distribution: Slice[];
};

type WorklogRow = {
  instructorId: string;
  name: string;
  avatarUrl: string | null;
  employeeCode: string | null;
  totalHours: number;
  activityCount: number;
  status: DayInstructor["status"];
  days: Array<{ date: string; hours: number; activityCount: number; status: string }>;
  activities: Array<Activity & { date: string; durationHours: number }>;
};

type Worklog = {
  period: { from: string; to: string };
  timezone: string | null;
  instructors: WorklogRow[];
};

type View = "day" | "week" | "month";

/** One column of the roster grid: a day in Week view, a week in Month view. */
type GridPeriod = { key: string; label: string; sublabel: string; dates: string[] };

/** How many instructors the day view shows before asking. */
const VISIBLE_INSTRUCTORS = 5;

/* ── Dates ────────────────────────────────────────────────────────────────── */

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

/**
 * The month, as WHOLE weeks.
 *
 * A week cut off at the 1st is not comparable to the six-day column beside it —
 * the shorter total reads as a quieter week rather than a clipped one. Which is
 * why the first column can begin in the previous month. The week bars on the
 * right and the monthly tracker use the same rule, so all three agree.
 */
function monthEdges(iso: string): { from: string; to: string } {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}

/** Today, as the browser reads it. Corrected to the tenant's zone once known. */


const fmt = formatDayAs;

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function ManagerDashboardPage() {
  /**
   * Today, in the UNIVERSITY's zone.
   *
   * This was a hand-rolled helper reading `getFullYear()/getMonth()/getDate()` —
   * the BROWSER's date. The audit that removed every other one of these missed
   * all three, because it searched for the name `todayISO` and these were spelled
   * `todayIso` and defined locally rather than imported. The guard is a pattern
   * now, not a name.
   */
  const today = useUniversityToday();
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState(today);
  const [reminding, setReminding] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  /* Name first, because a roster is usually read looking for somebody. Hours
   * is the other question — "who is light this week, who is buried" — and it
   * only answers it if the figure sorted on is the SAME one on the cards. */
  const [sort, setSort] = useState<"name" | "hours-desc" | "hours-asc">("name");
  const toast = useToast();

  const month = anchor.slice(0, 7);

  const loadOverview = useCallback(
    () =>
      apiGet<Overview>(
        `/api/manager/overview?date=${today}&month=${month}`,
        "Could not load your dashboard.",
      ),
    [today, month],
  );
  const overview = useLoad(loadOverview, `manager-overview:${today}:${month}`);

  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") {
      const monday = mondayOf(anchor);
      return { from: monday, to: addDays(monday, 6) };
    }
    return monthEdges(anchor);
  }, [view, anchor]);

  const loadWorklog = useCallback(
    () =>
      apiGet<Worklog>(
        `/api/manager/worklog?from=${range.from}&to=${range.to}`,
        "Could not load your roster's worklog.",
      ),
    [range.from, range.to],
  );
  const worklog = useLoad(loadWorklog, `manager-worklog:${range.from}:${range.to}`);

  const timeZone = overview.data?.timezone ?? worklog.data?.timezone ?? "UTC";

  /* Filtered here rather than by the endpoint: this is a roster of a size a
   * person scans, and narrowing it should not cost a round trip while they
   * type. */
  const roster = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = (worklog.data?.instructors ?? []).filter(
      (r) =>
        !needle ||
        r.name.toLowerCase().includes(needle) ||
        (r.employeeCode ?? "").toLowerCase().includes(needle),
    );

    if (sort === "name") return [...rows].sort((a, b) => a.name.localeCompare(b.name));

    /* Sorted on the SAME hours the card shows — the student-facing total from
     * `rollUp`, not the engine's every-recorded-minute figure. Ordering by one
     * number while displaying another is how a list stops making sense. */
    const hoursOf = (r: WorklogRow) => rollUp(r.activities).hours;
    return [...rows].sort((a, b) =>
      sort === "hours-desc" ? hoursOf(b) - hoursOf(a) : hoursOf(a) - hoursOf(b),
    );
  }, [worklog.data, search, sort]);

  /* A long roster is a wall. The first few answer "is anything wrong today?",
   * which is the question this page opens with; the rest is a click away. */
  const visible = showAll ? roster : roster.slice(0, VISIBLE_INSTRUCTORS);

  /** Exactly what is on screen, as a spreadsheet. */
  const exportCsv = () => {
    if (roster.length === 0) return;
    const rows = [
      ["Instructor", "Employee ID", "Date", "Total hours", "Activities", "Status"],
      ...roster.flatMap((r) =>
        r.days.map((d) => [
          r.name,
          r.employeeCode ?? "",
          d.date,
          formatDuration(d.hours),
          String(d.activityCount),
          d.status,
        ]),
      ),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `roster-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* Week gives a column per day; Month gives a column per WEEK. Thirty-one
   * columns is not a table anybody reads a row of. */
  const gridPeriods: GridPeriod[] = useMemo(() => {
    if (view === "month") {
      const out: GridPeriod[] = [];
      for (let start = range.from, i = 1; start <= range.to; start = addDays(start, 7), i++) {
        out.push({
          key: start,
          label: `Week ${i}`,
          sublabel: `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(addDays(start, 6), { day: "numeric", month: "short" })}`,
          dates: Array.from({ length: 7 }, (_, d) => addDays(start, d)),
        });
      }
      return out;
    }

    const days = Math.round(
      (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    return Array.from({ length: days }, (_, i) => {
      const date = addDays(range.from, i);
      return {
        key: date,
        label: fmt(date, { day: "numeric", month: "short" }),
        sublabel: fmt(date, { weekday: "short" }),
        dates: [date],
      };
    });
  }, [view, range.from, range.to]);

  const step = (direction: 1 | -1) => {
    if (view === "day") return setAnchor(addDays(anchor, direction));
    if (view === "week") return setAnchor(addDays(anchor, direction * 7));
    const d = new Date(`${anchor}T00:00:00.000Z`);
    d.setUTCMonth(d.getUTCMonth() + direction, 1);
    setAnchor(d.toISOString().slice(0, 10));
  };

  /** A nudge, not a record: it writes a notification and changes no hours. */
  const remind = async (instructorId: string) => {
    setReminding(instructorId);
    try {
      await apiSend(
        `/api/instructors/${instructorId}/remind`,
        "POST",
        { workDate: range.from },
        "That reminder could not be sent.",
      );
      toast("success", "Reminder sent.");
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "That reminder could not be sent.");
      pingNotifications();
    } finally {
      setReminding(null);
    }
  };

  if (overview.error && !overview.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <ErrorState message="Unable to load your dashboard" detail={overview.error} />
      </div>
    );
  }

  const stats = overview.data?.today ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" />

      {/* ── The four figures ─────────────────────────────────────────────── */}
      {overview.loading && !stats ? (
        <StatGridSkeleton />
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total instructors"
            value={String(stats.instructors)}
            icon={<IconUsers size={20} />}
            tint="blue"
            footnote="All active"
          />
          <KpiCard
            label="Logged today"
            value={String(stats.logged)}
            icon={<IconCheck size={20} />}
            tint="green"
            footnote={
              stats.loggedPct === null
                ? "No working days today"
                : `${stats.loggedPct}% of ${stats.expected} expected · ${stats.activities} ${
                    stats.activities === 1 ? "activity" : "activities"
                  }`
            }
          />
          <KpiCard
            label="Total hours today"
            value={formatDuration(stats.hours)}
            icon={<IconClock size={20} />}
            tint="amber"
            footnote={
              <Change pct={stats.yesterday.deltaPct} direction={stats.yesterday.direction} />
            }
          />
          <KpiCard
            label="Missing worklog"
            value={String(stats.missing)}
            icon={<IconAlert size={20} />}
            tint="violet"
            footnote={
              stats.missing > 0 ? (
                <a className="text-primary-text hover:underline" href="/manager/worklog">
                  View instructors →
                </a>
              ) : (
                "Everyone on your roster is in"
              )
            }
          />
        </div>
      ) : (
        <EmptyState
          title="No instructors assigned to you yet"
          description="Once instructors are assigned to you, their workload appears here."
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── The roster ─────────────────────────────────────────────────── */}
        <Section
          title={
            view === "day"
              ? fmt(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
              : view === "week"
                ? `Week: ${fmt(range.from, { day: "numeric", month: "short" })} – ${fmt(range.to, { day: "numeric", month: "short" })}`
                : fmt(anchor, { month: "long", year: "numeric" })
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-control border border-line p-0.5">
                {(["day", "week", "month"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`rounded-[0.4rem] px-3 py-1.5 text-sm font-medium capitalize transition ${
                      view === v ? "bg-primary text-white" : "text-muted hover:text-content"
                    }`}
                  >
                    {v} view
                  </button>
                ))}
              </div>
              <Button size="sm" variant="secondary" onClick={() => setAnchor(today)}>
                Today
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Previous ${view}`} onClick={() => step(-1)}>
                ←
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Next ${view}`} onClick={() => step(1)}>
                →
              </Button>
              <SearchInput
                label="Search instructor or ID"
                value={search}
                onChange={setSearch}
                placeholder="Search instructor"
                className="w-48"
              />
              <Select
                aria-label="Sort by"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="w-auto min-w-[11rem]"
              >
                <option value="name">Sort: name</option>
                <option value="hours-desc">Sort: most hours</option>
                <option value="hours-asc">Sort: fewest hours</option>
              </Select>
              <Button size="sm" variant="secondary" onClick={exportCsv}>
                <IconDownload size={16} />
                Export
              </Button>
            </div>
          }
        >
          {worklog.loading && !worklog.data ? (
            <TableSkeleton cols={5} />
          ) : worklog.error ? (
            <ErrorState message="Unable to load the worklog" detail={worklog.error} />
          ) : roster.length === 0 ? (
            <EmptyState
              title={search.trim() ? "Nobody matches that search" : "Nobody on your roster yet"}
              description={
                search.trim()
                  ? "Clear the search to see the whole roster."
                  : "Instructors assigned to you appear here with their day."
              }
            />
          ) : view === "day" ? (
            <div className="space-y-3">
              {visible.map((row) => (
                <DayTimelineCard
                  key={row.instructorId}
                  row={{
                    instructorId: row.instructorId,
                    name: row.name,
                    avatarUrl: row.avatarUrl,
                    employeeCode: row.employeeCode,
                    totalHours: row.totalHours,
                    activityCount: row.activityCount,
                    status: row.status,
                    activities: row.activities,
                  }}
                  timeZone={timeZone}
                  onRemind={anchor === today ? remind : undefined}
                  reminding={reminding === row.instructorId}
                />
              ))}

              {roster.length > VISIBLE_INSTRUCTORS ? (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-card border border-line bg-surface py-2.5 text-sm font-medium text-muted transition hover:bg-hovered hover:text-content"
                >
                  {showAll
                    ? "Show fewer instructors"
                    : `View more instructors (${roster.length - VISIBLE_INSTRUCTORS})`}
                  <IconChevronDown
                    size={16}
                    className={`transition-transform ${showAll ? "rotate-180" : ""}`}
                  />
                </button>
              ) : null}
            </div>
          ) : (
            <Card>
              <RosterGrid rows={roster} periods={gridPeriods} />
            </Card>
          )}
        </Section>

        {/* ── The month, beside the roster rather than under it ───────────── */}
        <div className="space-y-6">
          <Card>
            <CardHeader
              title={`Month view (${fmt(`${month}-01`, { month: "long", year: "numeric" })})`}
              description="Week-wise total hours across your whole roster."
            />
            <div className="px-5 pb-5">
              {overview.data?.month ? (
                <WeekBars weeks={overview.data.month.weeks} />
              ) : (
                <p className="text-sm text-muted">Nothing recorded this month.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Hours distribution"
              description="Across the same weeks, so the two add up to one total."
            />
            <div className="px-5 pb-5">
              {overview.data && overview.data.distribution.length > 0 ? (
                <HoursDonut
                  slices={overview.data.distribution}
                  totalHours={overview.data.month?.totalHours ?? 0}
                />
              ) : (
                <p className="text-sm text-muted">No hours recorded in this period yet.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ── Week and month: instructors down, days across ────────────────────────── */

/**
 * The roster as a grid: instructors down, periods across.
 *
 * ── A month is weeks, not thirty-one days ─────────────────────────────────
 * Rendering a day per column made the month view a wall about a metre wide
 * that nobody could read a row of. Weeks are the unit the report is written
 * in — the client's own sheet has four columns, not thirty — so the month
 * aggregates into them and stays legible on one screen.
 *
 * ── The hours are the ones on the cards ───────────────────────────────────
 * Computed by `rollUp`, so this grid, the day cards and both sheets show the
 * same figure: the time spent with students. A grid that quietly used the
 * engine's every-recorded-minute total would disagree with the card directly
 * above it.
 */
function RosterGrid({ rows, periods }: { rows: WorklogRow[]; periods: GridPeriod[] }) {
  const head = "px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-text";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only-text">
          Hours and activity counts recorded by each instructor in each period.
        </caption>
        <thead>
          <tr className="border-b border-line bg-primary-subtle">
            <th scope="col" className={`${head} text-left`}>
              Instructor
            </th>
            {periods.map((p) => (
              <th key={p.key} scope="col" className={`${head} text-right`}>
                {p.label}
                <span className="block font-normal normal-case">{p.sublabel}</span>
              </th>
            ))}
            <th scope="col" className={`${head} text-right`}>
              Total hours
            </th>
            <th scope="col" className={`${head} text-right`}>
              Activities
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const byDate = row.activities.reduce<Record<string, typeof row.activities>>(
              (acc, a) => {
                (acc[a.date] ??= []).push(a);
                return acc;
              },
              {},
            );

            const cells = periods.map((p) => {
              const acts = p.dates.flatMap((d) => byDate[d] ?? []);
              return { key: p.key, hours: rollUp(acts).hours, count: acts.length };
            });

            return (
              <tr
                key={row.instructorId}
                className="border-b border-line-subtle transition-colors hover:bg-hovered"
              >
                <th scope="row" className="px-3 py-2.5 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <Avatar name={row.name} avatarUrl={row.avatarUrl} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-content">{row.name}</span>
                      {row.employeeCode ? (
                        <span className="tabular block truncate text-xs text-muted">
                          {row.employeeCode}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </th>

                {cells.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-right">
                    {c.count > 0 ? (
                      <>
                        <span className="tabular block text-content">{formatDuration(c.hours)}</span>
                        <span className="tabular block text-xs text-muted">{c.count}</span>
                      </>
                    ) : (
                      // A dash rather than "00h 00m": nothing recorded and
                      // nothing done are different claims.
                      <>
                        <span className="block text-subtle">—</span>
                        <span className="tabular block text-xs text-subtle">0</span>
                      </>
                    )}
                  </td>
                ))}

                <td className="tabular px-3 py-2.5 text-right font-semibold text-content">
                  {formatDuration(cells.reduce((n, c) => n + c.hours, 0))}
                </td>
                <td className="tabular px-3 py-2.5 text-right font-semibold text-content">
                  {cells.reduce((n, c) => n + c.count, 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
