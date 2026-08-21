"use client";

/**
 * Work Log History — built to the design the client supplied.
 *
 * ── Why this is hand-built rather than assembled from the kit ─────────────
 * The shared `Section`, `FilterBar` and `Pagination` express this app's own
 * conventions, and the client's design differs from them in specific ways they
 * asked for: underlined tabs rather than a segmented control, a dismissible
 * banner beside the title rather than above it, outlined square row actions,
 * and a page-numbered pager. The markup here follows the design; the tokens are
 * still the app's, so it stays a page of this product rather than a transplant.
 *
 * ── Their own rows, always ────────────────────────────────────────────────
 * `/api/activities` pins a self-scoped caller to their own instructorId on the
 * server, so this cannot show anybody else's work whatever it asks for. Employee
 * Name and Employee ID therefore repeat one person down the page; they are in
 * the client's design and are kept, because a sheet that names who it is about
 * is worth more than two saved columns.
 *
 * ── Where Broad Category comes from ───────────────────────────────────────
 * The form does not ask for it, deliberately: a subject should follow the work
 * rather than be chosen from a menu. Each entry carries the subject read from
 * its deliverable text, and a day whose lines named none inherits from the last
 * office day that did.
 */

import { Fragment, useCallback, useMemo, useState } from "react";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { formatCompactDuration, formatHours, todayISO } from "@/app/_lib/format";
import { Dialog, useToast } from "@/app/_components/interactive";
import { EmptyState, ErrorState, TableSkeleton } from "@/app/_components/ui";

const PAGE_SIZE = 10;

type Row = {
  id: string;
  workDate: string;
  durationHours: number;
  remarks: string | null;
  quantity: number | null;
  rawText: string | null;
  instructorName: string;
  employeeCode: string | null;
  broadCategory: { code: string; label: string } | null;
  deliverableType: { code: string; label: string } | null;
};

type DaySubject = { code: string; label: string; carriedFrom: string | null } | null;

type Draft = {
  date: string;
  deliverable: string;
  quantity: string;
  workingHours: string;
  remarks: string;
};

const emptyDraft = (): Draft => ({
  date: todayISO(),
  deliverable: "",
  quantity: "",
  workingHours: "",
  remarks: "",
});

const firstOfMonth = () => `${todayISO().slice(0, 7)}-01`;

/** `2024-05-10` → `10 May 2024`, the format the client's design uses. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).toLocaleString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  return `${String(d).padStart(2, "0")} ${month} ${y}`;
}

/** `2026-08` → `August 2026`, the key the monthly view groups on. */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const name = new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  return `${name} ${y}`;
}

/** Monday of the ISO week a date falls in — the key the weekly view groups on. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Hours as somebody may type them.
 *
 * The field asks for a number, and people write time the way they say it. All
 * of these mean the same eight and a half hours: `8.5`, `8h 30m`, `8:30`,
 * `8h30`. Refusing three of the four would be pedantry — the field's job is to
 * find out how long something took.
 */
export function parseHours(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  // `8:30`, `8h 30m`, `8h30`, `8 h 30`
  const split = text.match(/^(\d+)\s*(?::|h)\s*(\d{1,2})\s*m?$/);
  if (split) {
    const h = Number(split[1]);
    const m = Number(split[2]);
    if (m > 59) return null;
    return h + m / 60;
  }

  // `8h`
  const whole = text.match(/^(\d+(?:\.\d+)?)\s*h?$/);
  if (whole) return Number(whole[1]);

  return null;
}

/**
 * One row of the table is one DAY, not one entry.
 *
 * An instructor writes up a day in as many lines as the day had, and the
 * client's sheet has one line per day. Two rows for one date would ask the
 * reader to add them up themselves.
 */
type Group = {
  key: string;
  label: string;
  dates: string[];
  entries: Row[];
};

/**
 * A day as the report reads it: names from the model, figures from the record.
 *
 * `/worklog/summary` returns one of these per day that has work on it. It
 * carries no employee data by design — the name, the id and the category on the
 * row come from the entries themselves, so a summary can never disagree with
 * the database about who it describes.
 */
type DaySummary = {
  date: string;
  deliverables: Array<{
    name: string;
    durationMinutes: number;
    quantity: number;
    quantityLabel: string;
  }>;
  remarks: string[];
  totalMinutes: number;
  source: "ai" | "fallback";
};

/**
 * What a row prints, from the summaries of the days it covers.
 *
 * A week or a month merges its days by activity name — twelve lectures across a
 * week are one line reading "Live Classes - 24h", not twelve. Merging happens
 * here rather than on the server because the same day summaries answer all
 * three views, and asking for them again per grouping would be three round
 * trips for one set of facts.
 */
function present(dates: string[], summaries: Record<string, DaySummary | undefined>) {
  const merged = new Map<string, { name: string; minutes: number; quantity: number; label: string }>();
  const remarks = new Set<string>();
  let totalMinutes = 0;
  let anyFallback = false;
  let found = false;

  for (const date of dates) {
    const day = summaries[date];
    if (!day) continue;
    found = true;
    if (day.source === "fallback") anyFallback = true;
    totalMinutes += day.totalMinutes;
    for (const r of day.remarks) remarks.add(r);

    for (const d of day.deliverables) {
      const at = merged.get(d.name);
      if (at) {
        at.minutes += d.durationMinutes;
        at.quantity += d.quantity;
      } else {
        merged.set(d.name, {
          name: d.name,
          minutes: d.durationMinutes,
          quantity: d.quantity,
          label: d.quantityLabel,
        });
      }
    }
  }

  // Heaviest first: the biggest commitment should not need a second glance.
  const lines = [...merged.values()].sort((a, z) => z.minutes - a.minutes);

  return {
    found,
    anyFallback,
    totalMinutes,
    // "Live Classes - 2h, Lesson Preparation - 1h 30m"
    deliverable: lines.length
      ? lines.map((l) => `${l.name} - ${formatCompactDuration(l.minutes)}`).join(", ")
      : "—",
    // "2 Classes, 1 Lesson Plan" — parallel to the line above, same order.
    quantity: lines.some((l) => l.quantity > 0)
      ? lines
          .filter((l) => l.quantity > 0)
          .map((l) => `${l.quantity} ${l.label}`)
          .join(", ")
      : "—",
    remarks: remarks.size ? [...remarks].join(", ") : "—",
  };
}

const COLUMNS = [
  "Date",
  "Employee Name",
  "Employee ID",
  "Broad Category",
  "Deliverable",
  "Deliverable Quantity",
  "Working Hours",
  "Remarks",
  "Actions",
];

export default function WorkLogHistoryPage() {
  const toast = useToast();

  // Day Wise by default, as the client requires.
  const [view, setView] = useState<"date" | "week" | "month">("date");
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayISO);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [bannerOpen, setBannerOpen] = useState(true);
  /** The day whose individual entries are open, when it was written in several. */
  const [expanded, setExpanded] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const me = useLoad(
    useCallback(
      () =>
        apiGet<{ user: { instructorId: string | null } }>(
          "/api/auth/me",
          "Could not load your account.",
        ),
      [],
    ),
    "me",
  );
  const instructorId = me.data?.user.instructorId ?? null;

  const query = `from=${from}&to=${to}&page=${page}&limit=${PAGE_SIZE}${
    search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""
  }`;

  const logs = useLoad(
    useCallback(
      () =>
        apiGet<{ activities: Row[]; page: number; limit: number; total: number; hasMore: boolean }>(
          `/api/activities?${query}`,
          "Could not load your work logs.",
        ),
      [query],
    ),
    `worklogs:${query}`,
  );

  const subjects = useLoad(
    useCallback(async () => {
      if (!instructorId) return {} as Record<string, DaySubject>;
      const res = await apiGet<{ subjectByDate: Record<string, DaySubject> }>(
        `/api/instructors/${instructorId}/day-subjects?from=${from}&to=${to}`,
        "Could not load what your days were about.",
      );
      return res.subjectByDate;
    }, [instructorId, from, to]),
    `worklog-subjects:${instructorId ?? "-"}:${from}:${to}`,
  );

  const rows = useMemo(() => logs.data?.activities ?? [], [logs.data]);

  /* The reading of each day: professional activity names, comma-separated, with
   * every figure summed on the server from the activities themselves. Fetched
   * for the same window as the rows, and cached there — a second look at the
   * same report does not ask the model again. */
  const summaries = useLoad(
    useCallback(async () => {
      if (!instructorId) return {} as Record<string, DaySummary>;
      const res = await apiGet<{ days: Record<string, DaySummary> }>(
        `/api/instructors/${instructorId}/worklog/summary?from=${from}&to=${to}`,
        "Could not summarise your work logs.",
      );
      return res.days;
    }, [instructorId, from, to]),
    `worklog-summary:${instructorId ?? "-"}:${from}:${to}`,
  );
  const today = todayISO();
  const todaysRows = rows.filter((r) => r.workDate.slice(0, 10) === today);

  /* One row per DAY in Date Wise, per WEEK in Weekly.
   *
   * The client's sheet has a line per day with the deliverables read across it,
   * not a line per deliverable — two rows carrying one date would ask the
   * reader to add the hours up themselves. */
  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, { dates: Set<string>; entries: Row[] }>();
    for (const row of rows) {
      const date = row.workDate.slice(0, 10);
      const key = view === "date" ? date : view === "week" ? weekStart(date) : date.slice(0, 7);
      const bucket = byKey.get(key) ?? { dates: new Set<string>(), entries: [] };
      bucket.dates.add(date);
      bucket.entries.push(row);
      byKey.set(key, bucket);
    }
    return [...byKey.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, b]) => ({
        key,
        label:
          view === "date"
            ? longDate(key)
            : view === "week"
              ? `Week of ${longDate(key)}`
              : monthLabel(key),
        dates: [...b.dates].sort(),
        entries: b.entries,
      }));
  }, [rows, view]);

  function broadCategoryOf(row: Row): string {
    return (
      row.broadCategory?.label ??
      subjects.data?.[row.workDate.slice(0, 10)]?.label ??
      "Not yet determined"
    );
  }

  function openNew() {
    setEditing(null);
    setDraft(emptyDraft());
    setFormError(null);
    setOpen(true);
  }

  function openEdit(row: Row) {
    setEditing(row);
    setDraft({
      date: row.workDate.slice(0, 10),
      deliverable: row.rawText ?? row.deliverableType?.label ?? "",
      quantity: String(row.quantity ?? ""),
      // Loaded back the way the table prints it, so an edit does not silently
      // turn "8h 30m" into "8.5" in front of the person correcting it.
      workingHours: formatHours(row.durationHours).replace(/^0/, ""),
      remarks: row.remarks ?? "",
    });
    setFormError(null);
    setOpen(true);
  }

  async function submit() {
    if (!instructorId) return;
    const workingHours = parseHours(draft.workingHours);
    const quantity = draft.quantity.trim() === "" ? 0 : Number(draft.quantity);

    if (!draft.deliverable.trim()) return setFormError("Enter what you worked on.");
    if (workingHours === null || workingHours <= 0) {
      return setFormError("Enter how long it took — 8, 8.5, or 8h 30m.");
    }
    if (workingHours > 24) {
      return setFormError("A single entry cannot be longer than a day.");
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return setFormError("Deliverable quantity must be a whole number.");
    }

    setSaving(true);
    setFormError(null);
    try {
      await apiSend(
        editing
          ? `/api/instructors/${instructorId}/worklog/entry/${editing.id}`
          : `/api/instructors/${instructorId}/worklog/entry`,
        editing ? "PATCH" : "POST",
        {
          date: draft.date,
          deliverable: draft.deliverable.trim(),
          quantity,
          workingHours,
          remarks: draft.remarks.trim() || null,
        },
        editing ? "Could not save that change." : "Could not submit your work log.",
      );
      toast("success", editing ? "Entry updated." : "Work log submitted.");
      setOpen(false);
      setBannerOpen(true);
      logs.reload();
      subjects.reload();
      summaries.reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Row) {
    if (!instructorId) return;
    try {
      await apiSend(
        `/api/instructors/${instructorId}/activities/${row.id}`,
        "DELETE",
        undefined,
        "Could not remove that entry.",
      );
      toast("success", "Entry removed.");
      logs.reload();
      subjects.reload();
      summaries.reload();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not remove that entry.");
    }
  }

  const total = logs.data?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
      {/* ── Title, banner, and the way in ─────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-content">Work Log History</h1>
          <p className="mt-1 text-sm text-muted">View and manage your submitted work logs</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {todaysRows.length > 0 && bannerOpen ? (
            <div className="flex items-start gap-3 rounded-card border border-success/25 bg-success-subtle px-4 py-3">
              <CheckCircle />
              <p className="text-sm">
                <span className="block font-semibold text-success-text">Great job!</span>
                <span className="block text-content">
                  Your work log for today has been submitted successfully.
                </span>
              </p>
              <button
                type="button"
                onClick={() => setBannerOpen(false)}
                aria-label="Dismiss"
                className="-mr-1 shrink-0 rounded-control p-1 text-muted transition-colors hover:bg-hovered hover:text-content"
              >
                <Cross />
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={openNew}
            className="inline-flex shrink-0 items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover"
          >
            <Plus />
            Today&rsquo;s Work Log
          </button>
        </div>
      </div>

      {/* ── Date Wise / Weekly ────────────────────────────────────────── */}
      <div className="mt-6 flex justify-end border-b border-line">
        {(["date", "week", "month"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`-mb-px border-b-2 px-5 pb-3 text-sm font-semibold transition-colors ${
              view === v
                ? "border-primary text-primary-text"
                : "border-transparent text-muted hover:text-content"
            }`}
          >
            {v === "date" ? "Day Wise" : v === "week" ? "Week Wise" : "Month Wise"}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2.5 rounded-card border border-info/20 bg-info-subtle px-4 py-3 text-sm text-info-text">
        <Info />
        <p>
          {view === "date"
            ? "You are viewing your work logs day wise. Week and month views are also available in this section."
            : view === "week"
              ? "The same days, added up a week at a time. Activities of the same kind are merged into one line."
              : "The same days, added up a month at a time. Switch to Day Wise for the day-by-day list."}
        </p>
      </div>

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-content">From Date</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="h-11 w-44 rounded-control border border-line bg-surface px-3 text-sm text-content"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-content">To Date</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="h-11 w-44 rounded-control border border-line bg-surface px-3 text-sm text-content"
          />
        </label>

        <label className="block min-w-[16rem] flex-1">
          <span className="sr-only-text">Search work logs</span>
          <span className="relative mt-6 flex items-center">
            <span aria-hidden className="absolute left-3 text-muted">
              <Magnifier />
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by deliverable, remarks..."
              className="h-11 w-full rounded-control border border-line bg-surface pl-10 pr-3 text-sm text-content"
            />
          </span>
        </label>

        <button
          type="button"
          onClick={() => {
            setFrom(firstOfMonth());
            setTo(today);
            setSearch("");
            setPage(1);
          }}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-control border border-primary/40 px-4 text-sm font-semibold text-primary-text transition-colors hover:bg-primary-subtle"
        >
          <Reset />
          Reset Filters
        </button>
      </div>

      {/* ── The log ───────────────────────────────────────────────────── */}
      <div className="mt-5">
        {logs.error ? (
          <ErrorState message={logs.error} onRetry={logs.reload} />
        ) : logs.loading ? (
          <TableSkeleton rows={PAGE_SIZE} cols={COLUMNS.length} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing recorded in this period"
            description="Change the dates, or write up today with the button above."
          />
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-[68rem] border-collapse text-sm">
              <caption className="sr-only-text">
                Your work logs, newest first, in the columns the monthly report uses.
              </caption>
              <thead>
                <tr className="bg-sunken">
                  {COLUMNS.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="border-b border-line px-4 py-3.5 text-left text-sm font-semibold text-content"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const cells = present(group.dates, summaries.data ?? {});
                  const many = group.entries.length > 1;
                  const isOpen = expanded === group.key;
                  const first = group.entries[0]!;
                  const subjects = [
                    ...new Set(group.entries.map((e) => broadCategoryOf(e))),
                  ].join(", ");

                  return (
                    <Fragment key={group.key}>
                      <tr className="border-b border-line-subtle">
                        <td className="px-4 py-4 text-content">{group.label}</td>
                        <td className="px-4 py-4 text-content">{first.instructorName}</td>
                        <td className="tabular px-4 py-4 text-content">
                          {first.employeeCode ?? "—"}
                        </td>
                        <td className="px-4 py-4 text-content">{subjects}</td>
                        <td className="px-4 py-4 text-content">{cells.deliverable}</td>
                        <td className="tabular px-4 py-4 text-content">{cells.quantity}</td>
                        <td className="tabular px-4 py-4 font-medium text-content">
                          {formatHours(cells.totalMinutes / 60)}
                        </td>
                        <td className="px-4 py-4 text-content">{cells.remarks}</td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-2">
                            {many ? (
                              /* What the row was made FROM. The row itself is
                                 the reading of the day; this is the record it
                                 was read from, which is what somebody checking
                                 a figure actually wants to see. */
                              <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : group.key)}
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Hide" : "Show"} what ${group.label} was made of — ${group.entries.length} entries as recorded`}
                                className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-hovered hover:text-content"
                              >
                                {group.entries.length} entries
                                <Chevron open={isOpen} />
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEdit(first)}
                                  aria-label={`Edit the entry from ${group.label}`}
                                  title="Edit"
                                  className="inline-flex size-9 items-center justify-center rounded-control border border-primary/40 text-primary-text transition-colors hover:bg-primary-subtle"
                                >
                                  <Pencil />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void remove(first)}
                                  aria-label={`Remove the entry from ${group.label}`}
                                  title="Remove"
                                  className="inline-flex size-9 items-center justify-center rounded-control border border-danger/40 text-danger-text transition-colors hover:bg-danger-subtle"
                                >
                                  <Bin />
                                </button>
                              </>
                            )}
                          </span>
                        </td>
                      </tr>

                      {many && isOpen
                        ? group.entries.map((e) => (
                            <tr key={e.id} className="border-b border-line-subtle bg-sunken/50">
                              <td className="px-4 py-3 text-sm text-muted">
                                {view === "week" ? longDate(e.workDate.slice(0, 10)) : ""}
                              </td>
                              <td colSpan={3} />
                              <td className="px-4 py-3 text-sm text-content">
                                {e.rawText ?? e.deliverableType?.label ?? "—"}
                              </td>
                              <td className="tabular px-4 py-3 text-sm text-content">
                                {e.quantity ?? "—"}
                              </td>
                              <td className="tabular px-4 py-3 text-sm text-content">
                                {formatHours(e.durationHours)}
                              </td>
                              <td className="px-4 py-3 text-sm text-content">{e.remarks ?? "—"}</td>
                              <td className="px-4 py-3">
                                <span className="inline-flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openEdit(e)}
                                    aria-label={`Edit "${e.rawText ?? "this entry"}"`}
                                    title="Edit"
                                    className="inline-flex size-8 items-center justify-center rounded-control border border-primary/40 text-primary-text transition-colors hover:bg-primary-subtle"
                                  >
                                    <Pencil />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void remove(e)}
                                    aria-label={`Remove "${e.rawText ?? "this entry"}"`}
                                    title="Remove"
                                    className="inline-flex size-8 items-center justify-center rounded-control border border-danger/40 text-danger-text transition-colors hover:bg-danger-subtle"
                                  >
                                    <Bin />
                                  </button>
                                </span>
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Count and pager ───────────────────────────────────────────── */}
      {rows.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Showing {firstShown} to {lastShown} of {total} entries
          </p>
          <Pager page={page} lastPage={lastPage} onPage={setPage} />
        </div>
      ) : null}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        icon={<Clipboard />}
        dividers={false}
        size="lg"
        title={editing ? "Edit work log" : "Today's Work Log"}
        description={
          editing
            ? `Correcting the entry from ${longDate(draft.date)}.`
            : "Add your deliverables and working details for today."
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              className="rounded-control border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-content transition-colors hover:bg-hovered disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Submit Work Log"}
              {saving ? null : <Send />}
            </button>
          </>
        }
      >
        <div className="grid gap-5 py-1">
          {formError ? (
            <p className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
              {formError}
            </p>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">Deliverable</span>
            <textarea
              rows={3}
              value={draft.deliverable}
              onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })}
              placeholder="Enter deliverable"
              className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-content"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">
              Deliverable Quantity
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              placeholder="Enter deliverable quantity"
              className="h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-content"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">Working Hours</span>
            <input
              type="text"
              inputMode="decimal"
              value={draft.workingHours}
              onChange={(e) => setDraft({ ...draft, workingHours: e.target.value })}
              placeholder="Enter working hours (e.g., 8)"
              className="h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-content"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">Remarks</span>
            <textarea
              rows={3}
              value={draft.remarks}
              onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
              placeholder="Enter remarks (optional)"
              className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-content"
            />
          </label>
        </div>
      </Dialog>
    </div>
  );
}

/**
 * The client's pager: arrows either side, numbered pages, and an ellipsis when
 * there are more than can be listed.
 */
function Pager({
  page,
  lastPage,
  onPage,
}: {
  page: number;
  lastPage: number;
  onPage: (next: number) => void;
}) {
  // First three, then an ellipsis, then the last — which is what the design
  // shows and what stays readable at any length.
  const numbers: Array<number | "gap"> = [];
  for (let n = 1; n <= Math.min(3, lastPage); n++) numbers.push(n);
  if (lastPage > 4) numbers.push("gap");
  if (lastPage > 3) numbers.push(lastPage);

  const box =
    "inline-flex h-10 min-w-10 items-center justify-center rounded-control border border-line px-3 text-sm font-medium transition-colors";

  return (
    <nav aria-label="Pages" className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="Previous page"
        className={`${box} text-muted hover:bg-hovered disabled:opacity-40`}
      >
        <ChevronLeft />
      </button>

      {numbers.map((n, i) =>
        n === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-muted">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === page ? "page" : undefined}
            className={
              n === page
                ? `${box} border-primary bg-primary text-white`
                : `${box} text-content hover:bg-hovered`
            }
          >
            {n}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => onPage(Math.min(lastPage, page + 1))}
        disabled={page >= lastPage}
        aria-label="Next page"
        className={`${box} gap-1 text-content hover:bg-hovered disabled:opacity-40`}
      >
        Next
        <ChevronRight />
      </button>
    </nav>
  );
}

/* ── Marks. Decorative: every control they sit in carries its own label. ── */

const stroke = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Clipboard() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-5">
      <rect x="4.5" y="3.5" width="11" height="14" rx="2" {...stroke} />
      <path d="M8 3.5V2.8A1.3 1.3 0 0 1 9.3 1.5h1.4A1.3 1.3 0 0 1 12 2.8v.7" {...stroke} />
      <path d="M7.5 9.5h5M7.5 12.5h3" {...stroke} />
    </svg>
  );
}
function CheckCircle() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="mt-0.5 size-5 shrink-0 text-success">
      <circle cx="10" cy="10" r="8" fill="currentColor" />
      <path d="m6.5 10.2 2.3 2.3 4.7-4.7" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Cross() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="m5.5 5.5 9 9m0-9-9 9" {...stroke} />
    </svg>
  );
}
function Plus() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="M10 4.5v11M4.5 10h11" {...stroke} strokeWidth={2} />
    </svg>
  );
}
function Info() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="mt-0.5 size-4 shrink-0">
      <circle cx="10" cy="10" r="7.5" {...stroke} />
      <path d="M10 9v4.5M10 6.6v.1" {...stroke} />
    </svg>
  );
}
function Magnifier() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <circle cx="9" cy="9" r="5.2" {...stroke} />
      <path d="m13 13 3.5 3.5" {...stroke} />
    </svg>
  );
}
function Reset() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="M4.5 10a5.5 5.5 0 1 1 1.7 4" {...stroke} />
      <path d="M4 16.5V13h3.5" {...stroke} />
    </svg>
  );
}
function Pencil() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="M13.5 3.5a2.12 2.12 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5Z" {...stroke} />
    </svg>
  );
}
function Bin() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="M4 6h12M8 6V4h4v2m-6 0 .7 9.1a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" {...stroke} />
    </svg>
  );
}
function Send() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="m17 3-7 14-2-6-6-2 15-6Z" {...stroke} />
    </svg>
  );
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 7.5 10 12.5 15 7.5" {...stroke} />
    </svg>
  );
}
function ChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="M12 4.5 7 10l5 5.5" {...stroke} />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="M8 4.5 13 10l-5 5.5" {...stroke} />
    </svg>
  );
}
