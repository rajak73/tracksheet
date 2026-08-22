"use client";

/**
 * The manager's worklog: what the roster recorded, in the report's own columns.
 *
 * ── A monitoring screen, not an editor ────────────────────────────────────
 * An instructor's dashboard exists to RECORD work. This exists to READ it. So
 * there is no "add workload" and no correction anywhere on the page: a manager
 * filling in somebody else's timesheet would make the record of who did what
 * untrue, and the number a manager is themselves measured on is derived from
 * it. Correcting stays with the person whose record it is.
 *
 * ── The same table the instructor reads ───────────────────────────────────
 * Employee Name and Employee ID lead, and everything after them is computed by
 * the same `rollUp` the instructor's own sheet uses. A manager questioning a
 * figure and the person who recorded it are looking at one number rather than
 * two that happen to agree.
 *
 * ── Approvals sit above the range ─────────────────────────────────────────
 * A day held last Tuesday is still held today, so the queue ignores whatever
 * the calendar is pointing at. Until it is decided, nothing of that day is
 * recorded for the instructor.
 */

import { useCallback, useMemo, useState } from "react";
import {
  broadCategoryCell,
  deliverableCell,
  quantityCell,
  remarksCell,
  subjectsCell,
  suppliedOr,
  workingHours as workingHoursCell,
} from "@/domain/worklog-report";
import {
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  Select,
  TableSkeleton,
} from "@/app/_components/ui";
import { IconDownload, IconFilter } from "@/app/_components/icons";
import { useToast } from "@/app/_components/interactive";
import { formatDayAs, formatDayShort } from "@/app/_lib/format";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";
import {
  ManagerSheet,
  totalHours,
  type ManagerPeriod,
  type ManagerPerson,
  type SheetSort,
} from "@/app/_components/ManagerSheet";
import { rollUp } from "@/domain/rollup";
import { type Activity } from "@/app/_components/workload";

/* ── Shapes ───────────────────────────────────────────────────────────────── */

type Row = {
  instructorId: string;
  name: string;
  employeeCode: string | null;
  /** The Broad Category assigned to them. What the sheet's column prints. */
  category: { code: string; label: string } | null;
  notes: Record<string, string>;
  /** What each office day was about, decided server-side — see `ManagerSheet`. */
  subjectByDate: Record<string, { code: string; label: string; carriedFrom: string | null } | null>;
  activities: Array<Activity & { date: string }>;
};

type Approval = {
  id: string;
  workDate: string;
  submittedAt: string;
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  bullets: string[];
};

type Worklog = {
  approvals: Approval[];
  period: { from: string; to: string };
  timezone: string | null;
  rosterTotal: number;
  summary: { instructors: number };
  instructors: Row[];
};

type ActivityTypeOption = { code: string; label: string };

type View = "day" | "week" | "month";

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

function monthGrid(iso: string): { from: string; to: string } {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  // Whole weeks: a week cut off at the 1st is not comparable to the one beside it.
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}

function todayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
}

const shortDate = formatDayShort;

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function ManagerWorklogPage() {
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState<string>(todayIso());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  /* Name first, because a roster is usually read looking for somebody. Total
   * hours is the other question — who is light, who is buried — and the header
   * cycles through descending, ascending and back to name. */
  const [sort, setSort] = useState<SheetSort>("name");
  const toast = useToast();

  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") {
      const monday = mondayOf(anchor);
      return { from: monday, to: addDays(monday, 6) };
    }
    return monthGrid(anchor);
  }, [view, anchor]);

  /* The SEARCH goes to the server, because it decides which instructors are in
   * the answer at all and therefore what "showing 3 of 28" counts. */
  const query = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (search.trim()) p.set("search", search.trim());
    return p.toString();
  }, [range, search]);

  const load = useCallback(
    () => apiGet<Worklog>(`/api/manager/worklog?${query}`, "Could not load the worklog."),
    [query],
  );
  const { data, error, loading, reload } = useLoad(load, `worklog:${query}`);

  const typesLoad = useCallback(
    () =>
      apiGet<{ activityTypes: ActivityTypeOption[] }>(
        "/api/activity-types",
        "Could not load activity types.",
      ),
    [],
  );
  const types = useLoad(typesLoad, "worklog-types");

  const [universityId, setUniversityId] = useState<string | null>(null);
  const meLoad = useCallback(async () => {
    const me = await fetchMe();
    setUniversityId(me.user.universityId ?? null);
    return me.user.universityId ?? null;
  }, []);
  useLoad(meLoad, "worklog-university");

  const filtersOn = Boolean(search.trim() || category);

  /* ── The rows under each name ────────────────────────────────────────────
   * Day gives one row per person, Week seven, Month the weeks the month
   * touches — the same shape the instructor reads about themselves. */
  const periods: ManagerPeriod[] = useMemo(() => {
    const today = todayIso();

    if (view === "month") {
      const out: ManagerPeriod[] = [];
      for (let start = range.from, i = 1; start <= range.to; start = addDays(start, 7), i++) {
        const dates = Array.from({ length: 7 }, (_, d) => addDays(start, d));
        out.push({
          dates,
          label: `${shortDate(start)} – ${shortDate(addDays(start, 6))}`,
          sublabel: `Week ${i}`,
          isCurrent: dates.includes(today),
        });
      }
      // Left to right like a calendar, unlike the instructor's sheet where the
      // newest period is the one they came to check.
      return out;
    }

    const span =
      view === "day" ? [range.from] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i));

    return span
      .map((date) => ({
        dates: [date],
        label: formatDayAs(date, { day: "numeric", month: "short" }),
        sublabel: formatDayAs(date, { weekday: "long" }),
        isCurrent: date === today,
      }))
      .sort((a, b) => a.dates[0]!.localeCompare(b.dates[0]!));
  }, [view, range.from, range.to]);

  const people: ManagerPerson[] = useMemo(() => {
    const rows = (data?.instructors ?? []).map((r) => ({
        instructorId: r.instructorId,
        name: r.name,
        employeeCode: r.employeeCode,
        // The assigned Broad Category. The column prints this and nothing else.
        category: r.category ?? null,
        notes: r.notes ?? {},
        subjectByDate: r.subjectByDate ?? {},
        activitiesByDate: r.activities
          // The category filter narrows ENTRIES rather than people, so it is
          // applied here: an instructor with nothing matching still appears,
          // with an empty row, rather than vanishing from the roster.
          .filter((a) => !category || a.activityType.code === category)
          .reduce<Record<string, Activity[]>>((acc, a) => {
            (acc[a.date] ??= []).push(a);
            return acc;
        }, {}),
    }));

    if (sort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name));

    // Sorted on the SAME figure the last column shows — ordering by one number
    // while displaying another is how a list stops making sense.
    return rows.sort((a, b) =>
      sort === "total-desc"
        ? totalHours(b, periods) - totalHours(a, periods)
        : totalHours(a, periods) - totalHours(b, periods),
    );
  }, [data, category, sort, periods]);

  const step = (direction: -1 | 1) => {
    if (view === "day") return setAnchor(addDays(anchor, direction));
    if (view === "week") return setAnchor(addDays(mondayOf(anchor), direction * 7));
    const d = new Date(`${anchor}T00:00:00.000Z`);
    d.setUTCMonth(d.getUTCMonth() + direction, 1);
    setAnchor(d.toISOString().slice(0, 10));
  };

  const periodLabel =
    view === "day"
      ? formatDayAs(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : view === "week"
        ? `${shortDate(range.from)} – ${shortDate(range.to)}`
        : formatDayAs(anchor, { month: "long", year: "numeric" });

  /** Exactly what is on screen, as a spreadsheet. */
  const exportCsv = () => {
    if (people.length === 0) {
      toast("danger", "There is nothing to export.");
      return;
    }
    const rows: string[][] = [
      [
        "Employee Name",
        "Employee ID",
        "Period",
        "Instructor Category",
        "Subjects Covered",
        "Deliverable",
        "Deliverable Quantity",
        "Working Hours",
        "Remarks",
      ],
    ];
    for (const person of people) {
      for (const period of periods) {
        const acts = period.dates.flatMap((d) => person.activitiesByDate[d] ?? []);
        const { lines, hours, remarks } = rollUp(acts);
        /* No subject derivation here any more.
         *
         * This used to collect the distinct subjects the period's days were
         * judged to be about, so that the export matched the screen. Both now
         * print the category assigned to the person, which the client requires
         * to be preserved rather than guessed — so there is nothing to derive
         * and nothing for the two to disagree about. */
        const note = period.dates.length === 1 ? (person.notes[period.dates[0]!] ?? "") : "";
        /* Written by the same functions the sheet on screen uses, so the
         * export and the screenshot cannot say different things — and by the
         * same ones the instructor's own report and the monthly tracker use, so
         * neither can the three reports. */
        const cells = lines.map((l) => ({
          name: l.label,
          minutes: Math.round(l.hours * 60),
          quantity: l.quantity,
        }));
        rows.push([
          suppliedOr(person.name),
          suppliedOr(person.employeeCode),
          `${period.label} (${period.sublabel})`,
          broadCategoryCell(person.category),
          // What the period actually touched, from the entries themselves.
          subjectsCell(acts.map((a) => a.broadCategory?.label)),
          deliverableCell(cells),
          quantityCell(cells.filter((_, i) => lines[i]!.countable)),
          workingHoursCell(Math.round(hours * 60)),
          note || remarksCell(remarks),
        ]);
      }
    }
    // Quoted defensively: a remark is free text and will eventually contain a
    // comma, a quote or a newline, and a CSV that breaks on one is worse than
    // no CSV at all.
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `worklog-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Worklog"
        description="Review and filter instructor activity across your roster."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <IconFilter size={16} />
              Filters
              {filtersOn ? (
                <span className="ml-1 rounded-chip bg-primary-subtle px-1.5 text-xs text-primary-text">
                  on
                </span>
              ) : null}
            </Button>

            {/* The monthly sheet exports itself, server-side, in the client's
                own column layout. Day and week are built from what is here. */}
            {view === "month" && universityId ? (
              <ButtonLink
                external
                size="sm"
                href={`/api/universities/${universityId}/tracker?month=${anchor.slice(0, 7)}&export=csv`}
              >
                <IconDownload size={16} />
                Export
              </ButtonLink>
            ) : (
              <Button size="sm" onClick={exportCsv}>
                <IconDownload size={16} />
                Export
              </Button>
            )}
          </div>
        }
      />

      {filtersOpen ? (
        <Card>
          <div className="space-y-3 px-4 py-4">
            <SearchInput
              label="Search instructor or ID"
              value={search}
              onChange={setSearch}
              placeholder="Search instructor or ID"
            />
            <Select
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {(types.data?.activityTypes ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </Select>
            {filtersOn ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setCategory("");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-1 rounded-control border border-line p-0.5">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-[0.4rem] px-3 py-1.5 text-sm font-medium capitalize transition ${
                  view === v
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-hovered hover:text-content"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" aria-label={`Previous ${view}`} onClick={() => step(-1)}>
              ←
            </Button>
            <span className="min-w-[13rem] text-center text-sm font-semibold text-content">
              {periodLabel}
            </span>
            <Button size="sm" variant="ghost" aria-label={`Next ${view}`} onClick={() => step(1)}>
              →
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAnchor(todayIso())}>
              Today
            </Button>
          </div>
        </div>
      </Card>

      {error ? <ErrorState message="Unable to load the worklog" detail={error} /> : null}

      {(data?.approvals.length ?? 0) > 0 ? (
        <Card>
          <CardHeader
            title={`${data!.approvals.length} ${
              data!.approvals.length === 1 ? "worklog is" : "worklogs are"
            } waiting for you`}
            description="Nothing is recorded for the instructor until you decide."
          />
          <div className="divide-y divide-line">
            {data!.approvals.map((a) => (
              <ApprovalRow key={a.id} approval={a} onDecided={reload} />
            ))}
          </div>
        </Card>
      ) : null}

      {loading && !data ? <TableSkeleton cols={7} /> : null}

      {data ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            {periodLabel} — showing{" "}
            <span className="font-medium text-content">{data.summary.instructors}</span> of{" "}
            <span className="font-medium text-content">{data.rosterTotal}</span>{" "}
            {data.rosterTotal === 1 ? "instructor" : "instructors"}
          </p>

          {people.length === 0 ? (
            <Card>
              <EmptyState
                title={filtersOn ? "Nothing matches these filters" : "Nobody on your roster yet"}
                description={
                  filtersOn
                    ? "Clear a filter to widen the search."
                    : "Instructors assigned to you appear here with what they recorded."
                }
              />
            </Card>
          ) : (
            <ManagerSheet people={people} periods={periods} sort={sort} onSort={setSort} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One held worklog, with the sentences it holds and the two ways out. */
function ApprovalRow({ approval, onDecided }: { approval: Approval; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await apiSend(
        `/api/manager/worklog/${approval.id}`,
        "PATCH",
        { approve },
        "That decision could not be saved.",
      );
      toast("success", approve ? "Approved — the day is now recorded." : "Not approved.");
      onDecided();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "That decision could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-4 px-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-content">
          {approval.instructorName}
          {approval.employeeCode ? (
            <span className="tabular ml-2 text-xs text-muted">{approval.employeeCode}</span>
          ) : null}
          <span className="ml-2 text-xs text-muted">{shortDate(approval.workDate)}</span>
        </p>

        {/* Their own words. A manager cannot fairly decide a day they cannot read. */}
        <ol className="mt-2 space-y-1">
          {approval.bullets.map((line, i) => (
            <li key={i} className="flex gap-2 text-sm text-muted">
              <span className="tabular w-4 shrink-0 text-right text-subtle">{i + 1}.</span>
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide(true)}>
          {busy ? "Saving…" : "Approve"}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(false)}>
          Not approved
        </Button>
      </div>
    </div>
  );
}
