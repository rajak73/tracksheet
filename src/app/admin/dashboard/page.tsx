"use client";

/**
 * The admin's dashboard: the network, one row per university.
 *
 * ── The question this page answers ────────────────────────────────────────
 * A manager asks "how is MY roster doing". An admin is not managing a roster
 * and cannot usefully read thirty of them; the admin's question is whether the
 * day is being RECORDED across the institute, and where it is not. So the
 * centrepiece is a league table of universities, and the loudest figure on the
 * page is the count of people who wrote nothing.
 *
 * ── Why it was rewritten ──────────────────────────────────────────────────
 * The previous version led with a Utilization percentage taken from the
 * engine's `productiveMinutes` — every recorded minute, meetings and
 * preparation included — and ranked "top performing managers" by it. Working
 * Hours had since been defined as time spent WITH STUDENTS, and the instructor
 * sheet, the manager sheet, the manager dashboard and the client's tracker were
 * all rebuilt around that. This page was the last one still adding up a
 * different number and calling it the same thing, and it also still spoke the
 * old vocabulary: "Teaching" hours after that category was renamed Lecture,
 * bare decimal hours after the product settled on `01h 30m`.
 *
 * Ranking people by that figure was the part that had to go rather than be
 * relabelled. It rewarded whoever recorded the most minutes of anything.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 * No utilization percentage. It needs a capacity to divide by, and capacity is
 * configured per university — an institute-wide percentage would be dividing by
 * a number that means something different in each row. The drill-through leads
 * to the university's own page, where capacity is known.
 *
 * The average hours per instructor IS here, and the distinction is the
 * denominator: it divides by headcount, which counts the same thing everywhere,
 * rather than by capacity, which does not. That also fixes what it is an
 * average OF — the divisor is the whole roster, so an instructor who logged
 * nothing is a zero in the average rather than absent from it. See
 * `averageMinutesPerInstructor`.
 */

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { KpiCard } from "@/app/_components/ManagerDashboard";
import { PeriodPicker, type View } from "@/app/_components/PeriodPicker";
import { AverageHoursByUniversity } from "@/app/_components/AverageHoursByUniversity";
import {
  IconUniversity,
  IconUsers,
  IconActivity,
  IconAlert,
} from "@/app/_components/icons";
import {
  Card,
  ErrorState,
  EmptyState,
  PageHeader,
  StatGridSkeleton,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  type SortDirection,
} from "@/app/_components/ui";
import { apiGet, useLoad } from "@/app/_lib/api";
import { useQueryState } from "@/app/_lib/query-state";
import { useUniversityToday } from "@/app/_lib/zone";
import { formatDayAs, formatHours } from "@/app/_lib/format";
import { categoryColor } from "@/app/_components/charts";

/* ── What the endpoint returns ────────────────────────────────────────────── */

type Line = { code: string; label: string; hours: number; countable: boolean };

type UniversityRow = {
  id: string;
  name: string;
  slug: string;
  instructors: number;
  recording: number;
  silent: number;
  workingHours: number;
  otherHours: number;
  lines: Line[];
  lastRecordedOn: string | null;
};

type Network = {
  period: { from: string; to: string };
  universities: UniversityRow[];
  totals: {
    universities: number;
    silentUniversities: number;
    instructors: number;
    recording: number;
    silent: number;
    workingHours: number;
    otherHours: number;
  };
};

/* ── Dates. The same rules as the manager dashboard, so the two agree. ────── */

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

/** The month as WHOLE weeks — a week clipped at the 1st is not comparable. */
function monthEdges(iso: string): { from: string; to: string } {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}




type Sort = "name" | "hours-desc" | "hours-asc" | "silent-desc";

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function AdminDashboardPage() {
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
  /* View, date and sort live in the URL, the same as the manager's dashboard
   * and the instructor's worklog. This was a hand-rolled localStorage restore
   * — a key, a `restored` flag and two effects, one of them deferred by a
   * timeout to keep a synchronous set inside an effect from cascading a second
   * render. All of it is what `useQueryState` does, and the URL does three more
   * things it could not: Back works, a period can be linked to somebody, and
   * two tabs stop overwriting one shared value.
   *
   * The old note said the view survives a refresh but the DATE deliberately
   * does not, so that coming back tomorrow lands on tomorrow. That still holds:
   * `on` is absent until somebody actually moves off today, so a fresh visit
   * resolves to today either way. What changes is that a date you DID navigate
   * to now survives the refresh you make while reading it.
   *
   * Silent first by default. The reason to open this page is to find what is
   * missing, and sorting by name would bury it behind whoever is alphabetically
   * first. */
  const [q, setQ] = useQueryState({ view: "day", on: "", sort: "silent-desc" });
  const view = (["day", "week", "month"].includes(q.view) ? q.view : "day") as View;
  const anchor = q.on || today;
  const sort = (["name", "hours-desc", "hours-asc", "silent-desc"].includes(q.sort)
    ? q.sort
    : "silent-desc") as Sort;

  const setView = (v: View) => setQ({ view: v });
  const setAnchor = (v: string) => setQ({ on: v });
  const setSort = (v: Sort) => setQ({ sort: v });

  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") {
      const monday = mondayOf(anchor);
      return { from: monday, to: addDays(monday, 6) };
    }
    return monthEdges(anchor);
  }, [view, anchor]);

  const load = useCallback(
    () =>
      apiGet<Network>(
        `/api/admin/network?from=${range.from}&to=${range.to}`,
        "Could not load the network.",
      ),
    [range.from, range.to],
  );
  const network = useLoad(load, `admin-network:${range.from}:${range.to}`);

  const rows = useMemo(() => {
    const all = network.data?.universities ?? [];
    if (sort === "name") return [...all].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "silent-desc") {
      // Ties broken by name, so the order is stable rather than incidental.
      return [...all].sort((a, b) => b.silent - a.silent || a.name.localeCompare(b.name));
    }
    return [...all].sort((a, b) =>
      sort === "hours-desc"
        ? b.workingHours - a.workingHours
        : a.workingHours - b.workingHours,
    );
  }, [network.data, sort]);

  const totals = network.data?.totals ?? null;

  if (network.error && !network.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <ErrorState message="Unable to load the dashboard" detail={network.error} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Every university delivering the programme, in the period you are looking at."
        actions={
          <PeriodPicker
            view={view}
            onView={setView}
            selected={anchor}
            onSelect={setAnchor}
            today={today}
          />
        }
      />

      {/* ── What each university averages per active instructor-day ────────
        * Shown first, ahead of the network totals below: it is the one figure
        * on this page an admin reads university-by-university rather than as
        * a single network-wide number, so it leads rather than follows.
        * Σ(active minutes) ÷ Σ(active instructor-count) — see
        * `src/domain/average-hours.ts` for the confirmed formula. Its own
        * Day/Week/Month switch, because the question "what are we averaging"
        * is asked at a granularity of its own rather than whatever the page
        * below happens to be showing. */}
      <AverageHoursByUniversity />

      {/* ── The four figures ─────────────────────────────────────────────── */}
      {network.loading && !totals ? (
        <StatGridSkeleton />
      ) : totals ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Universities"
            value={String(totals.universities)}
            icon={<IconUniversity size={20} />}
            tint="blue"
            footnote={
              totals.silentUniversities > 0
                ? `${totals.silentUniversities} recorded nothing`
                : "All recorded something"
            }
          />
          <KpiCard
            label="Instructors"
            value={String(totals.instructors)}
            icon={<IconUsers size={20} />}
            tint="violet"
            footnote={`${totals.recording} recorded in this period`}
          />
          <KpiCard
            label="Working Hours"
            value={formatHours(totals.workingHours)}
            icon={<IconActivity size={20} />}
            tint="green"
            footnote={
              /* Stated, not hidden. The two figures do not add up to a day's
               * work by accident — one of them is deliberately excluded, and a
               * total with no explanation invites the arithmetic anyway. */
              <>Time with students. {formatHours(totals.otherHours)} recorded elsewhere.</>
            }
          />
          <KpiCard
            label="Recorded nothing"
            value={String(totals.silent)}
            icon={<IconAlert size={20} />}
            tint="amber"
            footnote={
              totals.silent === 0
                ? "Everyone wrote something"
                : "Not the same as zero hours — nothing was written"
            }
          />
        </div>
      ) : null}

      {/* ── The network ──────────────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-content">Universities</h2>
            <p className="mt-0.5 text-sm text-muted">
              {formatDayAs(range.from, { day: "numeric", month: "short", year: "numeric" })}
              {range.from === range.to
                ? null
                : ` – ${formatDayAs(range.to, { day: "numeric", month: "short", year: "numeric" })}`}
            </p>
          </div>
        </div>

        {network.loading && !network.data ? (
          <TableSkeleton rows={5} cols={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No universities yet"
            description="Add a university and its instructors before anything can be recorded."
          />
        ) : (
          <TableWrap>
            <Table caption="Every university, with what its instructors recorded in this period.">
              <THead
                columns={[
                  { label: "University", sortKey: "name" },
                  { label: "Not recording", sortKey: "silent", align: "right" },
                  { label: "Where the hours went" },
                  { label: "Working Hours", sortKey: "hours", align: "right" },
                ]}
                sort={sortColumn(sort)}
                onSort={(key) => setSort(nextSort(key, sort))}
              />
              <TBody>
                {rows.map((row) => (
                  <UniversityRowCells key={row.id} row={row} />
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

/**
 * The chosen sort, as the column header understands it.
 *
 * The page's four options are not four columns — two of them are the same
 * column in opposite directions — so the two models have to be mapped rather
 * than merged. Name and Not-recording each have one useful direction and do not
 * toggle: nobody wants the university that IS recording listed first, and the
 * point of the page is what is missing.
 */
function sortColumn(sort: Sort): { key: string; direction: SortDirection } {
  if (sort === "name") return { key: "name", direction: "asc" };
  if (sort === "silent-desc") return { key: "silent", direction: "desc" };
  return { key: "hours", direction: sort === "hours-desc" ? "desc" : "asc" };
}

/** Clicking a column: hours flips, the other two just select. */
function nextSort(key: string, current: Sort): Sort {
  if (key === "name") return "name";
  if (key === "silent") return "silent-desc";
  return current === "hours-desc" ? "hours-asc" : "hours-desc";
}

/* ── One university ───────────────────────────────────────────────────────── */

/**
 * One university as a table row.
 *
 * This was a card in a list, sorted by a strip of chips above it. The figures
 * it carries are all comparisons — how many are silent, how many hours, where
 * they went — and a comparison is read down a column, not across a stack of
 * cards. It now sits in the same table the rest of admin uses, and the chips
 * are gone because the column headers sort.
 */
function UniversityRowCells({ row }: { row: UniversityRow }) {
  const nothingWritten = row.instructors > 0 && row.recording === 0;

  return (
    <TR>
      <TD strong>
        <Link
          href={`/admin/universities/${row.id}`}
          className="text-primary hover:underline"
        >
          {row.name}
        </Link>
        <span className="mt-0.5 block text-xs text-muted">
          {row.instructors === 0 ? (
            "No instructors yet"
          ) : (
            <>
              {row.recording} of {row.instructors} recorded
              {row.lastRecordedOn ? (
                <>
                  {" · last on "}
                  {formatDayAs(row.lastRecordedOn, { day: "numeric", month: "short" })}
                </>
              ) : null}
            </>
          )}
        </span>
      </TD>

      <TD align="right">
        {row.instructors === 0 ? (
          <span className="text-subtle">—</span>
        ) : (
          /* Warned only when NOBODY wrote anything. Some of a roster being
             silent on a given day is ordinary; all of it is the thing this
             page exists to surface. */
          <span className={nothingWritten ? "font-medium text-warning-text" : "text-content"}>
            {row.silent}
          </span>
        )}
      </TD>

      {/* Muted segments are the ones that do not count toward Working Hours —
          shown, because the work happened, and muted, so nobody adds the bar
          up to the figure beside it. */}
      <TD>
        {row.lines.length === 0 ? (
          <span className="text-xs text-subtle">Nothing recorded</span>
        ) : (
          <span className="block min-w-[14rem]">
            <span className="flex h-2 overflow-hidden rounded-chip bg-sunken">
              {row.lines.map((line) => (
                <span
                  key={`${line.code}:${line.countable}`}
                  title={`${line.label} – ${formatHours(line.hours)}${
                    line.countable ? "" : " (not counted in Working Hours)"
                  }`}
                  style={{
                    width: `${(line.hours / (row.workingHours + row.otherHours)) * 100}%`,
                    background: categoryColor(line.code),
                    opacity: line.countable ? 1 : 0.35,
                  }}
                />
              ))}
            </span>
            <span className="mt-1.5 block truncate text-xs text-muted">
              {row.lines
                .slice(0, 3)
                .map((l) => `${l.label} ${formatHours(l.hours)}`)
                .join(" · ")}
              {row.lines.length > 3 ? ` · +${row.lines.length - 3} more` : ""}
            </span>
          </span>
        )}
      </TD>

      <TD align="right" strong>
        {formatHours(row.workingHours)}
      </TD>
    </TR>
  );
}
