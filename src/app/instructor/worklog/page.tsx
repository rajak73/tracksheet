"use client";

/**
 * Work Log History — the instructor's own log, day by day.
 *
 * ── What this screen is ───────────────────────────────────────────────────
 * A flat table of everything they have recorded, filterable by date and
 * searchable, with one modal for writing today's entry and pencil/bin actions
 * for correcting an old one. It is built to a design the client supplied.
 *
 * ── Their own rows, always ────────────────────────────────────────────────
 * `/api/activities` pins a self-scoped caller to their own instructorId on the
 * server, so this cannot show anybody else's work whatever it asks for. The
 * Employee Name and Employee ID columns therefore repeat one person down the
 * page; they are in the client's design and are kept, because a printed sheet
 * that names who it is about is worth more than two saved columns.
 *
 * ── Where Broad Category comes from ───────────────────────────────────────
 * The form does not ask for it, and the client's position is that it should
 * not: a subject follows the work rather than being chosen from a menu. Each
 * entry carries the subject the parser read from its deliverable text, and a
 * day whose lines named no subject inherits from the last office day that did.
 * That fallback is `/day-subjects`, fetched alongside the rows.
 */

import { useCallback, useMemo, useState } from "react";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { formatHours, todayISO } from "@/app/_lib/format";
import { Dialog, useToast } from "@/app/_components/interactive";
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  IconButton,
  PageHeader,
  Pagination,
  SearchInput,
  Section,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";

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
  activityType: { code: string; label: string };
};

type DaySubject = { code: string; label: string; carriedFrom: string | null } | null;

/** The four fields the client's form asks for. */
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
  quantity: "1",
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

/** Monday of the ISO week a date falls in — the key the weekly view groups on. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export default function WorkLogHistoryPage() {
  const toast = useToast();

  const [view, setView] = useState<"date" | "week">("date");
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayISO);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const me = useLoad(
    useCallback(
      () =>
        apiGet<{ user: { instructorId: string | null; name: string } }>(
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

  /* The day-level subject, for rows whose own line named none. Fetched for the
   * same window so the Broad Category column is answerable on every row. */
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

  /* Memoised because the weekly grouping below depends on it, and a fresh []
   * on every render would regroup the table on every keystroke in the search
   * box. */
  const rows = useMemo(() => logs.data?.activities ?? [], [logs.data]);
  const today = todayISO();
  const todaysRows = rows.filter((r) => r.workDate.slice(0, 10) === today);

  /** The client's design groups the same rows by week when asked. */
  const grouped = useMemo(() => {
    if (view === "date") return null;
    const byWeek = new Map<string, Row[]>();
    for (const row of rows) {
      const key = weekStart(row.workDate.slice(0, 10));
      byWeek.set(key, [...(byWeek.get(key) ?? []), row]);
    }
    return [...byWeek.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows, view]);

  function broadCategoryOf(row: Row): string {
    const own = row.broadCategory?.label;
    if (own) return own;
    const carried = subjects.data?.[row.workDate.slice(0, 10)]?.label;
    return carried ?? "Not yet determined";
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
      quantity: String(row.quantity ?? 1),
      workingHours: String(row.durationHours),
      remarks: row.remarks ?? "",
    });
    setFormError(null);
    setOpen(true);
  }

  async function submit() {
    if (!instructorId) return;
    const hours = Number(draft.workingHours);
    const quantity = Number(draft.quantity);

    if (!draft.deliverable.trim()) return setFormError("Say what you worked on.");
    if (!Number.isFinite(hours) || hours <= 0) {
      return setFormError("Working hours must be a number greater than zero.");
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return setFormError("Deliverable quantity must be a whole number.");
    }

    setSaving(true);
    setFormError(null);
    try {
      const body = {
        date: draft.date,
        deliverable: draft.deliverable.trim(),
        quantity,
        workingHours: hours,
        remarks: draft.remarks.trim() || null,
      };
      await apiSend(
        editing
          ? `/api/instructors/${instructorId}/worklog/entry/${editing.id}`
          : `/api/instructors/${instructorId}/worklog/entry`,
        editing ? "PATCH" : "POST",
        body,
        editing ? "Could not save that change." : "Could not submit your work log.",
      );
      toast("success", editing ? "Entry updated." : "Work log submitted.");
      setOpen(false);
      logs.reload();
      subjects.reload();
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
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not remove that entry.");
    }
  }

  const COLUMNS = [
    { key: "date", label: "Date" },
    { key: "name", label: "Employee Name" },
    { key: "code", label: "Employee ID" },
    { key: "broad", label: "Broad Category" },
    { key: "deliverable", label: "Deliverable" },
    { key: "quantity", label: "Deliverable Quantity", align: "right" as const },
    { key: "hours", label: "Working Hours", align: "right" as const },
    { key: "remarks", label: "Remarks" },
    { key: "actions", label: "Actions" },
  ];

  const isFiltered = from !== firstOfMonth() || to !== today || search.trim() !== "";

  return (
    <>
      <PageHeader
        title="Work Log History"
        description="View and manage submitted work logs"
        actions={<Button onClick={openNew}>Add today&rsquo;s log</Button>}
      />

      {/* The client's design puts a confirmation at the top of the page once the
          day is written up, with the way to correct it beside the reassurance. */}
      {todaysRows.length > 0 ? (
        <Alert
          tone="success"
          title="Great job!"
          actions={
            <Button variant="secondary" onClick={() => openEdit(todaysRows[0]!)}>
              Edit today&rsquo;s log
            </Button>
          }
        >
          Your work log for today has been submitted successfully.
        </Alert>
      ) : null}

      <Section
        title="Work Log History"
        actions={
          <div className="inline-flex rounded-control border border-line p-0.5">
            {(["date", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === v
                    ? "bg-primary text-on-primary"
                    : "text-muted hover:bg-hovered hover:text-content"
                }`}
              >
                {v === "date" ? "Date Wise" : "Weekly"}
              </button>
            ))}
          </div>
        }
      >
        <Alert tone="info">
          {view === "date"
            ? "You are viewing your work logs date wise. Weekly view is also available in this section."
            : "The same entries, grouped by the week they fall in. Switch back to Date Wise for the day-by-day list."}
        </Alert>

        <FilterBar
          isFiltered={isFiltered}
          onClear={() => {
            setFrom(firstOfMonth());
            setTo(today);
            setSearch("");
            setPage(1);
          }}
        >
          <Field label="From Date">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-control border border-line bg-surface px-3 text-sm text-content"
            />
          </Field>
          <Field label="To Date">
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-control border border-line bg-surface px-3 text-sm text-content"
            />
          </Field>
          <SearchInput
            label="Search work logs"
            value={search}
            onChange={(next) => {
              setSearch(next);
              setPage(1);
            }}
            placeholder="Search by deliverable, remarks…"
            className="min-w-[18rem] flex-1"
          />
        </FilterBar>

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
          <>
            <TableWrap>
              <Table caption="Your work logs, newest first, in the columns the monthly report uses.">
                <THead columns={COLUMNS} />
                <TBody>
                  {(view === "date" ? [["", rows] as const] : (grouped ?? [])).flatMap(
                    ([weekKey, weekRows]) => [
                      ...(view === "week"
                        ? [
                            <TR key={`w-${weekKey}`}>
                              <TD colSpan={COLUMNS.length} strong>
                                Week of {longDate(weekKey)} — {weekRows.length}{" "}
                                {weekRows.length === 1 ? "entry" : "entries"} ·{" "}
                                {formatHours(weekRows.reduce((n, r) => n + r.durationHours, 0))}
                              </TD>
                            </TR>,
                          ]
                        : []),
                      ...weekRows.map((row) => (
                        <TR key={row.id}>
                          <TD>{longDate(row.workDate.slice(0, 10))}</TD>
                          <TD>{row.instructorName}</TD>
                          <TD>{row.employeeCode ?? "—"}</TD>
                          <TD>{broadCategoryOf(row)}</TD>
                          <TD>{row.rawText ?? row.deliverableType?.label ?? "—"}</TD>
                          <TD align="right">{row.quantity ?? "—"}</TD>
                          <TD align="right">{formatHours(row.durationHours)}</TD>
                          <TD>{row.remarks ?? "—"}</TD>
                          <TD>
                            <span className="inline-flex gap-1">
                              <IconButton
                                label={`Edit the entry from ${longDate(row.workDate.slice(0, 10))}`}
                                onClick={() => openEdit(row)}
                                className="text-primary-text hover:bg-primary-subtle"
                              >
                                <PencilIcon />
                              </IconButton>
                              <IconButton
                                label={`Remove the entry from ${longDate(row.workDate.slice(0, 10))}`}
                                onClick={() => void remove(row)}
                                className="text-danger-text hover:bg-danger-subtle"
                              >
                                <BinIcon />
                              </IconButton>
                            </span>
                          </TD>
                        </TR>
                      )),
                    ],
                  )}
                </TBody>
              </Table>
            </TableWrap>

            <Pagination
              page={logs.data?.page ?? page}
              limit={logs.data?.limit ?? PAGE_SIZE}
              total={logs.data?.total ?? rows.length}
              hasMore={logs.data?.hasMore ?? false}
              onPageChange={setPage}
            />
          </>
        )}
      </Section>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit work log" : "Today's Work Log"}
        description={
          editing
            ? `Correcting the entry from ${longDate(draft.date)}.`
            : "What you produced, how much of it, and how long it took."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Submit Work Log"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <Field label="Deliverable" required>
            <textarea
              rows={3}
              value={draft.deliverable}
              onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })}
              placeholder="Enter deliverable details…"
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-content"
            />
          </Field>

          <Field
            label="Deliverable Quantity"
            hint="How many of it. Zero is a real answer for work with no unit."
          >
            <input
              type="number"
              min={0}
              step={1}
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              placeholder="Enter quantity or output details…"
              className="h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-content"
            />
          </Field>

          <Field label="Working Hours" required>
            <input
              type="number"
              min={0}
              step={0.25}
              value={draft.workingHours}
              onChange={(e) => setDraft({ ...draft, workingHours: e.target.value })}
              placeholder="Enter total working hours (e.g., 8.5)"
              className="h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-content"
            />
          </Field>

          <Field label="Remarks">
            <textarea
              rows={2}
              value={draft.remarks}
              onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
              placeholder="Enter any additional remarks…"
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-content"
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path
        d="M13.5 3.5a2.12 2.12 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BinIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path
        d="M4 6h12M8 6V4h4v2m-6 0 .7 9.1a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
