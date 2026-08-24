"use client";

/**
 * Work Log History — built to the design the client supplied.
 *
 * ── Why this is hand-built rather than assembled from the kit ─────────────
 * The shared `Section`, `FilterBar` and `Pagination` express this app's own
 * conventions, and the client's design differs from them in specific ways they
 * asked for: underlined tabs rather than a segmented control, outlined square
 * row actions, and a page-numbered pager. The markup here follows the design;
 * the tokens are still the app's, so it stays a page of this product rather
 * than a transplant.
 *
 * ── Their own rows, always ────────────────────────────────────────────────
 * `/api/activities` pins a self-scoped caller to their own instructorId on the
 * server, so this cannot show anybody else's work whatever it asks for. Employee
 * Name and Employee ID are dropped from the table for exactly that reason: this
 * is one instructor's own screen, and a column naming who it is about is only
 * useful where a page can show more than one person — the manager and admin
 * sheets keep both columns because they genuinely mix rows across a roster.
 *
 * ── Where Broad Category comes from ───────────────────────────────────────
 * The form does not ask for it, deliberately: a subject should follow the work
 * rather than be chosen from a menu. Each entry carries the subject the model
 * read from its deliverable text, and the column lists the distinct ones the
 * day touched.
 *
 * A day whose lines named no subject at all shows an em dash. It does NOT
 * inherit from the last office day — the carry-forward exists server-side and
 * this screen does not ask for it, so what you see here is only what was
 * actually written down.
 */

import { Fragment, useCallback, useMemo, useState } from "react";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { formatHours, todayIn, todayISO } from "@/app/_lib/format";
import {
  broadCategoryCell,
  deliverableCell,
  quantityCell,
  UNSTATED,
  workingHours as workingHoursCell,
} from "@/domain/worklog-report";
import {
  addDays,
  buildPeriodRow,
  weekOf,
  type PeriodRow,
  type RowActivity,
} from "@/domain/worklog-rows";
import { splitEntries } from "@/domain/worklog-entry-lines";
import { Dialog, useToast } from "@/app/_components/interactive";
import { EmptyState, ErrorState, TableSkeleton } from "@/app/_components/ui";

/** Rows on a page of the report. A ROW is a day, a week or a month. */
const PAGE_SIZE = 10;

/**
 * Entries fetched for the window before the report is built from them.
 *
 * ── Why the report cannot be paginated by entry ───────────────────────────
 * It was, and the client's "one row per Employee + Date" quietly failed. The
 * table asks for ten ACTIVITIES at a time and then groups them into days, so a
 * day written in eleven entries straddled a page boundary and produced a group
 * on each — and because every printed figure comes from the day SUMMARY rather
 * than from the entries on the page, both rows showed the whole day's
 * deliverables, quantity and hours. A busy day was reportable twice at full
 * value, and reconciling the column would have found the hours doubled.
 *
 * So the window's entries are fetched together and the DAYS are paginated. The
 * window is already bounded by the date filters above it — a month of one
 * person's work — and the API's own ceiling is 200, which is what this is.
 */
const ENTRY_FETCH_LIMIT = 200;

type Row = {
  id: string;
  workDate: string;
  startTime: string;
  status?: string;
  activityType: { code: string; label: string };
  durationHours: number;
  remarks: string | null;
  quantity: number | null;
  rawText: string | null;
  /** The subject read out of THIS entry's wording. This IS the report column. */
  broadCategory: { code: string; label: string } | null;
  deliverableType: { code: string; label: string; isCountable: boolean } | null;
};

type Draft = {
  date: string;
  deliverable: string;
  quantity: string;
  workingHours: string;
  remarks: string;
};

/* The date defaults to the UNIVERSITY's today — the only day the server will
 * accept a worklog for. Passed in rather than read here, because a module-level
 * helper cannot know whose university it is. */
const emptyDraft = (today?: string): Draft => ({
  date: today ?? todayISO(),
  deliverable: "",
  quantity: "",
  workingHours: "",
  remarks: "",
});

const firstOfMonth = (zone?: string | null) => `${todayIn(zone).slice(0, 7)}-01`;

/**
 * What the screen says while a paragraph is being read, and afterwards.
 *
 * Null until a paragraph is sent. The states after that are the submission's
 * own, so the screen and the database never disagree about where a day is —
 * `processingState` is computed on the server from one field, and this only
 * chooses the words for it.
 */
type ReadingState =
  | null
  /** Fetching today's own submission back, for "Edit Today's Log" — not a
   *  submit in progress, so it gets its own copy rather than borrowing
   *  "sending"'s. */
  | { phase: "loading" }
  | { phase: "sending" }
  | { phase: "reading" }
  | { phase: "done"; activities: number }
  | { phase: "review"; notes: string[]; activities: number }
  | { phase: "slow" }
  | { phase: "failed"; message: string; submissionId: string | null };

type SubmissionView = {
  id: string;
  processingState: "PENDING" | "PROCESSING" | "COMPLETED" | "REVIEW_REQUIRED" | "FAILED";
  parseError: string | null;
  reviewNotes: Array<{ kind: string; message: string }> | null;
  rejections: Array<{ rawText: string; reason: string }> | null;
  rawBullets: string[];
  inputMode: "BULLETS" | "NARRATIVE";
  activities: Array<{ id: string }>;
};

/**
 * How long the dialog waits for a reading before it lets the instructor go.
 *
 * A parse may legitimately run for nearly six minutes when the provider is
 * retrying — `MAX_PARSE_MS` — and nobody should be held at a dialog for that.
 * So the wait here is only as long as a reading normally takes; past it the
 * work carries on server-side and the instructor is told where to find it. The
 * text is already saved either way, which is what makes leaving safe.
 */
const READING_PATIENCE_MS = 45_000;
const READING_POLL_MS = 1_500;

/** `2024-05-10` → `Friday`. Names the day a row is about, beside its date. */
function weekdayOf(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  });
}

/** `2024-05-10` → `10 May 2024`, the format the client's design uses. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).toLocaleString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  return `${String(d).padStart(2, "0")} ${month} ${y}`;
}



/**
 * One row of the table is one DAY, not one entry.
 *
 * An instructor writes up a day in as many lines as the day had, and the
 * client's sheet has one line per day. Two rows for one date would ask the
 * reader to add them up themselves.
 */

const COLUMNS = [
  "Date",
  /* One column. It holds what they DID — the subject read off each entry —
   * which is what the client asked Broad Category to mean. */
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
  const [view, setView] = useState<"date" | "week">("date");
  /* Neither view carries an anchor of its own any more. Day Wise reads the two
   * date filters; Week Wise reads the week the From filter falls in. They used
   * to have one each, stepped by arrows above the filters — with those gone
   * there is nothing left to move an anchor, and one that cannot move is just a
   * second, stale source of truth beside the filters. */
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  /** The day whose individual entries are open, when it was written in several. */
  const [expanded, setExpanded] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  /** True while the dialog holds today's own narrative for correction, rather
   *  than a blank one — distinct from `editing`, which is the single-entry
   *  manual-fields correction, not the whole day's. */
  const [editingToday, setEditingToday] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* How the day is being written.
   *
   * `write` is the whole day in one box, in their own words, and the reader
   * finds the activities in it. `fields` is one activity filled in by hand, and
   * is what an EDIT always uses — correcting one row is not rewriting the day. */
  const [entryMode, setEntryMode] = useState<"write" | "fields">("write");
  const [narrative, setNarrative] = useState("");
  /** Where the reading has got to, once a paragraph has been sent. */
  const [reading, setReading] = useState<ReadingState>(null);

  const me = useLoad(
    useCallback(
      () =>
        apiGet<{ user: { instructorId: string | null }; timezone: string | null }>(
          "/api/auth/me",
          "Could not load your account.",
        ),
      [],
    ),
    "me",
  );
  const instructorId = me.data?.user.instructorId ?? null;
  /* "Today" means the university's today, because that is the only one the
   * server will accept a worklog for. See `todayIn`. */
  const zone = me.data?.timezone ?? null;
  const today = todayIn(zone);

  // What the filters actually resolve to right now.
  const fromAt = from ?? firstOfMonth(zone);
  const toAt = to ?? today;
  /* Week Wise shows the week CONTAINING the From date, rather than carrying a
   * separate anchor of its own. It used to have one, stepped by a pair of
   * arrows above the filters; with those gone the anchor had nothing to move
   * it, so it would have pinned Week Wise to the current week forever. Deriving
   * it from a filter the reader can actually see keeps the two agreeing. */
  const weekAt = fromAt;


  /* No `page` here, deliberately — see `ENTRY_FETCH_LIMIT`. The window's
   * entries come back together and the report paginates the days it groups them
   * into, so a day can never appear on two pages at once. */
  /* Which window to fetch.
   *
   * Day Wise is a feed and uses both date filters. Week Wise widens the From
   * filter to the whole week it falls in, so a week always shows seven days
   * rather than the ragged slice the filters happen to describe. */
  const [windowFrom, windowTo] = useMemo<[string, string]>(() => {
    if (view === "week") {
      const week = weekOf(weekAt);
      return [week[0]!, week.at(-1)!];
    }
    return [fromAt, toAt];
  }, [view, weekAt, fromAt, toAt]);

  const query = `from=${windowFrom}&to=${windowTo}&limit=${ENTRY_FETCH_LIMIT}${
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

  /* The day-subject fetch that used to live here is still gone.
   *
   * It answered "what was this day about", carrying a subject forward onto days
   * whose own lines named none. Broad Category has since gone back to meaning
   * the inferred subject, so that fetch would be renderable again — but this
   * column lists what each day actually recorded, and a day that named no
   * subject reads as an em dash rather than borrowing last Tuesday's.
   *
   * The endpoint is untouched — `/api/instructors/:id/day-subjects` still
   * answers and the per-entry subject is still read and stored. This screen
   * simply does not ask. */

  const rows = useMemo(() => logs.data?.activities ?? [], [logs.data]);

  /* Is today inside the range being looked at?
   *
   * The two facts below are read from the LOADED WINDOW, which is the only
   * honest thing to read them from and also why the button is gated on this
   * one. Browsing April says nothing about whether today has been written up
   * — so a button that answered from April's rows would have shown
   * "+ Add Today's Worklog" to somebody who had already submitted, and
   * opened a BLANK box that replaces the day on save. Out of range, the page
   * does not know, so it does not offer. */
  const todayInView = windowFrom <= today && today <= windowTo;

  /* Drives the primary button's two states. Read from the SAME rows the
   * table renders — not a second fetch — so the button can never claim a
   * state the table underneath it disagrees with. Only meaningful while
   * `todayInView`, which is what gates the button that reads it. */
  const hasSubmittedToday = useMemo(
    () => rows.some((r) => r.workDate.slice(0, 10) === today),
    [rows, today],
  );

  /* The reading of each day: professional activity names, comma-separated, with
   * every figure summed on the server from the activities themselves. Fetched
   * for the same window as the rows, and cached there — a second look at the
   * same report does not ask the model again. */
  /* The day-summary fetch that used to live here is gone.
   *
   * ── It was calling Gemini on every view, for nothing ───────────────────
   * The rows are built by `buildPeriodRow` now, from the stored activities.
   * This request was left behind when that replaced `present()`, and nothing
   * has read its result since — but `/worklog/summary` asks the model to name
   * and summarise any day it has not cached, so opening the screen, changing
   * the window, or editing an entry each paid for a model call whose answer was
   * discarded.
   *
   * That is the rule this codebase is built on, broken by an oversight rather
   * than a decision: a number on a screen is arithmetic over stored rows, and
   * VIEWING never calls the model. The endpoint still exists and still works;
   * nothing on this page asks it anything. */
  /* The notes an instructor wrote about whole DAYS, as opposed to the remarks
   * on each entry. The Remarks column prefers these — see `remarksFor`. */
  const dayNotes = useLoad(
    useCallback(async () => {
      if (!instructorId) return {} as Record<string, string>;
      const res = await apiGet<{ notes: Record<string, string> }>(
        `/api/instructors/${instructorId}/worklog/notes?from=${windowFrom}&to=${windowTo}`,
        "Could not load your day notes.",
      );
      return res.notes ?? {};
    }, [instructorId, windowFrom, windowTo]),
    `worklog-notes:${instructorId ?? "-"}:${windowFrom}:${windowTo}`,
  );
  /* One row per DAY in Date Wise, per WEEK in Weekly.
   *
   * The client's sheet has a line per day with the deliverables read across it,
   * not a line per deliverable — two rows carrying one date would ask the
   * reader to add the hours up themselves. */
  /**
   * The rows of whichever view is showing.
   *
   * ── Three shapes, one builder ──────────────────────────────────────────
   *   Day     one row per DAY, newest first, today labelled as today.
   *   Week    one row per DAY of the week, Monday first — a calendar reads
   *           forwards — with a week total beneath.
   *   Month   one row per WEEK, the week in progress first, prior weeks
   *           below, with a month total beneath.
   *
   * Week and Month used to be one row EACH: a week collapsed to a single line
   * and a month to another. That is a summary, not the sheet the client asked
   * for, and it made "which day did nobody file?" unanswerable from the screen
   * that exists to answer it.
   *
   * Every row comes from `buildPeriodRow`, which the manager's sheet calls too,
   * so a Tech "Live Class" and a Maths one merge identically for both roles.
   */
  const groups = useMemo<PeriodRow[]>(() => {
    const activities: RowActivity[] = rows.map((r) => ({
      workDate: r.workDate.slice(0, 10),
      durationHours: r.durationHours,
      remarks: r.remarks,
      status: r.status,
      startTime: r.startTime,
      activityType: r.activityType,
      deliverableType: r.deliverableType,
      broadCategory: r.broadCategory,
      quantity: r.quantity,
    }));
    const notes = dayNotes.data ?? {};
    const build = (key: string, label: string, sublabel: string | undefined, dates: string[]) =>
      buildPeriodRow({ key, label, sublabel, dates, activities, dayNotes: notes, today });

    if (view === "week") {
      // Calendar order. A week is read forwards, whatever Day Wise does.
      return weekOf(weekAt).map((date) =>
        build(date, date === today ? `Today — ${longDate(date)}` : longDate(date), weekdayOf(date), [date]),
      );
    }

    /* Day Wise: every day that has something, newest first, and every day
     * between them that has not — a silently skipped day is a day nobody can
     * see was skipped. */
    const days = [...new Set(activities.map((a) => a.workDate))].sort();
    const newest = days.at(-1);
    const oldest = days[0] ?? today;
    const span: string[] = [];
    for (let d = newest && newest > today ? newest : today; d >= oldest; d = addDays(d, -1)) {
      span.push(d);
    }
    return span.map((date) =>
      build(date, date === today ? `Today — ${longDate(date)}` : longDate(date), weekdayOf(date), [date]),
    );
  }, [rows, view, today, weekAt, dayNotes.data]);


  function openNew() {
    setEditing(null);
    setEditingToday(false);
    setDraft(emptyDraft(today));
    setNarrative("");
    setEntryMode("write");
    setReading(null);
    setFormError(null);
    setOpen(true);
  }

  function openEdit(row: Row) {
    setEditing(row);
    setEditingToday(false);
    // One row is being corrected, not the day rewritten, so the fields are the
    // only sensible shape for it.
    setEntryMode("fields");
    setReading(null);
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

  /**
   * "Edit Today's Log" — the whole day, read back and reopened for
   * correction, not a blank box.
   *
   * Loads today's own narrative and seeds it into the same write box
   * `openNew()` uses. Submitting from here is not a special path: it is the
   * ordinary POST to `/worklog` for today's date, which `submitWorklog`
   * already treats as replacing the day rather than appending to it — see
   * the service's own comment on that. Nothing here needs to know it is an
   * edit; the server already does.
   *
   * A day recorded through the manual-fields form has no `WorklogSubmission`
   * to read back — `rawBullets` belongs to the narrative path only. That
   * case opens blank rather than failing outright: writing a fresh narrative
   * still records the day, it is only the pre-fill that has nothing to work
   * from.
   */
  async function openEditToday() {
    if (!instructorId) return;
    setEditing(null);
    setEditingToday(true);
    setDraft(emptyDraft(today));
    setNarrative("");
    setEntryMode("write");
    setFormError(null);
    setOpen(true);
    setReading({ phase: "loading" });
    try {
      const res = await apiGet<{ submissions: SubmissionView[] }>(
        `/api/instructors/${instructorId}/worklog?date=${today}`,
        "Could not load today's worklog.",
      );
      const latest = res.submissions.at(-1);
      setNarrative(latest?.rawBullets?.join("\n") ?? "");
    } catch {
      // Opened already; a failed read-back leaves a blank box to write into
      // rather than blocking the edit entirely.
    } finally {
      setReading(null);
    }
  }

  /**
   * Sends the day as written, then watches for the reading to land.
   *
   * The POST answers as soon as the text is SAVED, not when it has been
   * understood — that ordering is what makes a provider outage cost a reading
   * rather than somebody's typing. So this polls afterwards, and every state it
   * can end in is one the instructor can act on.
   */
  async function submitNarrative() {
    if (!instructorId) return;
    const text = narrative.trim();
    if (!text) return setFormError("Write what you did today.");

    setSaving(true);
    setFormError(null);
    setReading({ phase: "sending" });

    try {
      await apiSend(
        `/api/instructors/${instructorId}/worklog`,
        "POST",
        { workDate: draft.date, text },
        "Could not submit your work log.",
      );
    } catch (e) {
      setReading(null);
      setSaving(false);
      return setFormError(e instanceof Error ? e.message : "Something went wrong.");
    }

    setReading({ phase: "reading" });

    const startedAt = Date.now();
    while (Date.now() - startedAt < READING_PATIENCE_MS) {
      await new Promise((r) => setTimeout(r, READING_POLL_MS));

      let live: SubmissionView | undefined;
      try {
        const res = await apiGet<{ submissions: SubmissionView[] }>(
          `/api/instructors/${instructorId}/worklog?date=${draft.date}`,
          "Could not check on your work log.",
        );
        live = res.submissions.at(-1);
      } catch {
        // A failed poll is not a failed submission. The text is saved; keep
        // asking, and the patience window below ends it either way.
        continue;
      }
      if (!live) continue;

      if (live.processingState === "COMPLETED") {
        setReading({ phase: "done", activities: live.activities.length });
        /* The inline box says the same thing, but only while this dialog
         * stays open — this is what confirms it once it's closed. `submit()`,
         * the manual-entry path, already does this; this path is the AI one
         * and had gone through the whole read-back-and-confirm cycle with
         * nothing outside the dialog to show for it. */
        toast(
          "success",
          `${live.activities.length} ${live.activities.length === 1 ? "activity" : "activities"} recorded.`,
        );
        break;
      }
      if (live.processingState === "REVIEW_REQUIRED") {
        setReading({
          phase: "review",
          notes: (live.reviewNotes ?? []).map((n) => n.message),
          activities: live.activities.length,
        });
        break;
      }
      if (live.processingState === "FAILED") {
        setReading({
          phase: "failed",
          message:
            live.parseError ??
            "We could not organise this worklog automatically. Your words are safe.",
          submissionId: live.id,
        });
        break;
      }
    }

    setSaving(false);
    setReading((current) => (current?.phase === "reading" ? { phase: "slow" } : current));
    logs.reload();
  }

  /** Asks for the same text to be read again. Nothing is retyped. */
  async function retryReading(submissionId: string) {
    if (!instructorId) return;
    setSaving(true);
    setReading({ phase: "reading" });
    try {
      await apiSend(
        `/api/instructors/${instructorId}/worklog/${submissionId}/reparse`,
        "POST",
        undefined,
        "Could not try again just yet.",
      );
    } catch (e) {
      setReading({
        phase: "failed",
        message: e instanceof Error ? e.message : "Could not try again just yet.",
        submissionId,
      });
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!instructorId) return;

    /* Checked here only so the instructor is told before the round trip. The
     * server runs the SAME function on the same strings and its answer is what
     * is written — where a list gets cut decides which quantity lands on which
     * deliverable, and that is not a decision to make in a browser and trust. */
    if (!split.ok) return setFormError(split.reason);

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
          deliverable: draft.deliverable,
          quantity: draft.quantity,
          workingHours: draft.workingHours,
          remarks: draft.remarks,
        },
        editing ? "Could not save that change." : "Could not submit your work log.",
      );
      toast(
        "success",
        editing
          ? "Entry updated."
          : split.entries.length === 1
            ? "Work log submitted."
            : `${split.entries.length} entries recorded.`,
      );
      setOpen(false);
      logs.reload();
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
        } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not remove that entry.");
    }
  }

  /** The paragraph box, rather than the four fields. Never while editing a row. */
  const writingItOut = entryMode === "write" && !editing;

  /* What the four boxes currently describe, read by the same function the
   * server will use. One source for the preview, the error and the write.
   *
   * Not memoised: it is string splitting over four short fields, and the React
   * compiler refuses to optimise a component whose manual memoisation it cannot
   * preserve — costing far more than this recomputes. */
  const split = splitEntries({
    deliverable: draft.deliverable,
    quantity: draft.quantity,
    workingHours: draft.workingHours,
    remarks: draft.remarks,
  });

  /* Counted in ROWS, which is what the table shows and what the client's sheet
   * means by a row: one per date, week or month. It used to count entries,
   * which meant "Showing 1 to 10 of 34 entries" under a table of four days. */
  const total = groups.length;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);
  const visibleGroups = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* The window held more entries than were fetched, so some days are missing
   * from the report entirely. Said out loud rather than left to be noticed: a
   * silently short report is the one failure mode a reader cannot detect. */
  const truncated = (logs.data?.total ?? 0) > rows.length;

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
      {/* ── Title and the way in ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-content">Work Log History</h1>
          <p className="mt-1 text-sm text-muted">View and manage your submitted work logs</p>
        </div>

        {/* Submission feedback is the toast `submit()` fires — see below —
            not a persistent banner here. A banner gated on "today has a row"
            reappeared on every reload for as long as that stayed true, which
            read as congratulating a page load rather than an action.

            Two states, read from `hasSubmittedToday` — the same rows the
            table below renders, so this button and that table can never
            disagree about whether today has anything written yet. Distinct
            styling rather than just a different label: a glance should tell
            which state this is, not just a read.

            Shown only while today is in the range on screen. An instructor
            records today and nothing else, so a control for it sitting above
            a table of last April was offering the one day that table does not
            contain — and, worse, guessing its state from rows that could not
            answer. See `todayInView`. */}
        {!todayInView ? null : hasSubmittedToday ? (
          <button
            type="button"
            onClick={() => void openEditToday()}
            className="inline-flex shrink-0 items-center gap-2 rounded-control border border-success/40 bg-success-subtle px-4 py-2.5 text-sm font-semibold text-success-text shadow-card transition-colors hover:bg-success/10"
          >
            <Pencil />
            Edit Today&rsquo;s Log
          </button>
        ) : (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex shrink-0 items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover"
          >
            <Plus />
            Add Today&rsquo;s Worklog
          </button>
        )}
      </div>

      {/* ── Date Wise / Weekly ──────────────────────────────────────────
        * A segmented control of solid blue pills, matching the client's
        * reference: the selected view is filled, the rest are quiet. This was
        * an underlined tab strip, which read as navigation between pages
        * rather than as one control with three settings. */}
      <div className="mt-6 flex justify-end">
        <div className="inline-flex gap-1 rounded-control border border-line bg-surface p-1">
          {(["date", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                /* A view change is a change of question, and the answer to a
                   new question starts at now — so both views reset the filters
                   to today rather than carrying a date the reader chose while
                   asking something else. */
                setView(v);
                setPage(1);
                setExpanded(null);
                if (v === "week") {
                  // The week containing today, which is what `weekAt` reads.
                  setFrom(today);
                  setTo(today);
                } else {
                  setFrom(firstOfMonth(zone));
                  setTo(today);
                }
              }}
              aria-pressed={view === v}
              className={`rounded-[calc(var(--radius-control)-2px)] px-5 py-2 text-sm font-semibold transition-colors ${
                view === v
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-primary-subtle hover:text-primary-text"
              }`}
            >
              {v === "date" ? "Day Wise" : "Week Wise"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────
        * One row: each label sits BESIDE its input rather than above it, which
        * is what the client's design shows and what lets the whole bar fit on
        * a single line. Stacked labels made the row two lines tall and forced
        * the search box to carry a `mt-6` purely to line its own baseline up
        * with fields whose labels it did not share.
        *
        * `flex-wrap` stays. At a phone's width four controls cannot share a
        * line whatever the labels do, and wrapping is the only alternative to
        * the page itself scrolling sideways. */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-sm font-medium text-content">From Date</span>
          <input
            type="date"
            value={fromAt}
            max={toAt}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="h-11 w-40 rounded-control border border-line bg-surface px-3 text-sm text-content"
          />
        </label>

        <label className="flex items-center gap-2">
          <span className="shrink-0 text-sm font-medium text-content">To Date</span>
          <input
            type="date"
            value={toAt}
            min={fromAt}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="h-11 w-40 rounded-control border border-line bg-surface px-3 text-sm text-content"
          />
        </label>

        <label className="relative flex min-w-[14rem] flex-1 items-center">
          <span className="sr-only-text">Search work logs</span>
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
        </label>

        <button
          type="button"
          onClick={() => {
            setFrom(firstOfMonth(zone));
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
                <tr className="bg-primary-subtle">
                  {COLUMNS.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="border-b border-line px-4 py-3.5 text-left text-sm font-semibold text-primary-text"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => {
                  const entries = rows.filter((r) =>
                    group.dates.includes(r.workDate.slice(0, 10)),
                  );
                  const isOpen = expanded === group.key;
                  const first = entries[0];
                  const isToday = group.dates.includes(today);

                  /* ── Nothing recorded, and the two reasons are different ──
                   * A day that has passed with nothing on it is somebody not
                   * having filed. A day that has not happened is nobody having
                   * failed at anything. One row saying "—" for both is how a
                   * week half in the future reads as half a week of misses. */
                  if (group.state !== "recorded") {
                    const future = group.state === "future";
                    return (
                      <tr
                        key={group.key}
                        className={`border-b border-line-subtle ${future ? "" : "bg-warning-subtle/30"}`}
                      >
                        <td className="px-4 py-4 text-content">
                          {group.label}
                          {group.sublabel ? (
                            <span className="ml-2 text-xs text-muted">{group.sublabel}</span>
                          ) : null}
                        </td>
                        <td
                          colSpan={5}
                          className={`px-4 py-4 ${future ? "text-subtle" : "font-medium text-warning-text"}`}
                        >
                          {future ? "Not yet reached" : "No worklog submitted"}
                        </td>
                        <td className="px-4 py-4" />
                      </tr>
                    );
                  }

                  return (
                    <Fragment key={group.key}>
                      <tr
                        className={`border-b border-line-subtle ${isToday ? "bg-primary-subtle/25" : ""}`}
                      >
                        <td className="px-4 py-4 text-content">
                          {group.label}
                          {group.sublabel ? (
                            <span className="ml-2 text-xs text-muted">{group.sublabel}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-content">
                          {broadCategoryCell(group.subjects)}
                        </td>
                        <td className="px-4 py-4 text-content">{deliverableCell(group.lines)}</td>
                        <td className="tabular px-4 py-4 text-content">
                          {quantityCell(group.lines)}
                        </td>
                        <td className="tabular px-4 py-4 font-medium text-content">
                          {workingHoursCell(group.totalMinutes)}
                        </td>
                        <td className="px-4 py-4 text-content">{group.remarks || "—"}</td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-2">
                            {entries.length > 1 || view !== "date" ? (
                              /* What the row was made FROM. The row is the
                                 reading of the period; this is the record it
                                 was read from, which is what somebody checking
                                 a figure actually wants to see. */
                              <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : group.key)}
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Hide" : "Show"} what ${group.label} was made of — ${entries.length} entries as recorded`}
                                className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-hovered hover:text-content"
                              >
                                {entries.length} {entries.length === 1 ? "entry" : "entries"}
                                <Chevron open={isOpen} />
                              </button>
                            ) : first && isToday ? (
                              /* Today only. An instructor records the day they
                                 are in — the server refuses anything else, so
                                 offering a pencil on last Tuesday was offering
                                 a button whose only outcome was a refusal. */
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
                            ) : null}
                          </span>
                        </td>
                      </tr>

                      {isOpen
                        ? entries.map((e) => (
                            <tr key={e.id} className="border-b border-line-subtle bg-sunken/50">
                              <td className="px-4 py-3 text-sm text-muted">
                                {view === "date" ? "" : longDate(e.workDate.slice(0, 10))}
                              </td>
                              {/* Skips only Broad Category to land on Deliverable —
                                  this entry's own row doesn't carry a subject of its
                                  own to show here. */}
                              <td colSpan={1} />
                              <td className="px-4 py-3 text-sm text-content">
                                {e.rawText ?? e.deliverableType?.label ?? "—"}
                              </td>
                              <td className="tabular px-4 py-3 text-sm text-content">
                                {e.quantity ?? UNSTATED}
                              </td>
                              <td className="tabular px-4 py-3 text-sm text-content">
                                {formatHours(e.durationHours)}
                              </td>
                              <td className="px-4 py-3 text-sm text-content">{e.remarks ?? "—"}</td>
                              <td className="px-4 py-3">
                                {/* Per ENTRY, not per row: an expanded week can
                                    hold entries from seven different days, and
                                    only the ones on today are the instructor's
                                    to change. */}
                                {e.workDate.slice(0, 10) === today ? (
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
                                ) : null}
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}

                {/* ── The period total ───────────────────────────────────
                  * A week's rows are days and a month's are weeks, so neither
                  * table adds up to anything on its own. This is the line the
                  * client reconciles against. */}
                {view !== "date" && groups.some((g) => g.state === "recorded") ? (
                  <tr className="border-t-2 border-line bg-sunken font-semibold">
                    <td className="px-4 py-3.5 text-content">
                      Week total
                    </td>
                    {/* Skips Broad Category, Deliverable and Quantity to land the
                        total under Working Hours, then Remarks and Actions. */}
                    <td colSpan={3} />
                    <td className="tabular px-4 py-3.5 text-content">
                      {workingHoursCell(groups.reduce((n, g) => n + g.totalMinutes, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Count and pager ───────────────────────────────────────────── */}
      {truncated ? (
        <p className="mt-4 rounded-control border border-warning/30 bg-warning-subtle px-3.5 py-2.5 text-sm text-warning-text">
          This range holds more entries than can be shown at once. Narrow the dates to see all of
          it — some days are missing from the table below.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Showing {firstShown} to {lastShown} of {total} rows
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
        title={editing ? "Edit work log" : editingToday ? "Edit Today's Worklog" : "Today's Work Log"}
        description={
          editing
            ? `Correcting the entry from ${longDate(draft.date)}.`
            : writingItOut
              ? "Write your day however you like. It will be organised into the report for you."
              : "Add your deliverables and working details for today."
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              /* Never disabled while a reading is in flight. The text is
                 already saved, so leaving costs nothing, and holding somebody
                 at a dialog for work that continues without them is the thing
                 §18 asks us not to do. */
              className="rounded-control border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-content transition-colors hover:bg-hovered disabled:opacity-50"
            >
              {writingItOut && reading ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={() =>
                writingItOut
                  ? reading && reading.phase !== "sending" && reading.phase !== "reading"
                    ? setOpen(false)
                    : void submitNarrative()
                  : void submit()
              }
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {saving
                ? reading?.phase === "reading"
                  ? "Organising…"
                  : "Saving…"
                : writingItOut && reading
                  ? "Done"
                  : editing
                    ? "Save changes"
                    : "Submit Work Log"}
              {saving || (writingItOut && reading) ? null : <Send />}
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

          {/* ── How they would rather write it ──────────────────────────────
              Two ways of saying the same thing, and neither is a lesser one:
              a paragraph is faster when the day was busy, the fields are surer
              when it was one thing. Editing offers neither choice — see
              `writingItOut`. */}
          {editing ? null : (
            <div
              role="group"
              aria-label="How to write your work log"
              className="inline-flex w-fit rounded-control border border-line bg-sunken p-1"
            >
              {(
                [
                  ["write", "Write it out"],
                  ["fields", "Fill in fields"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setEntryMode(value);
                    setFormError(null);
                    setReading(null);
                  }}
                  aria-pressed={entryMode === value}
                  className={
                    "rounded-[calc(var(--radius-control)-2px)] px-3.5 py-1.5 text-sm font-semibold transition-colors " +
                    (entryMode === value
                      ? "bg-surface text-content shadow-card"
                      : "text-muted hover:text-content")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {writingItOut ? (
            <NarrativeEntry
              date={draft.date}
              onDate={(date) => setDraft({ ...draft, date })}
              value={narrative}
              onChange={setNarrative}
              reading={reading}
              today={today}
              onRetry={(id) => void retryReading(id)}
            />
          ) : (
            <>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">
              Deliverable
              <span className="ml-2 font-normal text-muted">
                one per line, or separated by commas
              </span>
            </span>
            <textarea
              rows={3}
              value={draft.deliverable}
              onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })}
              placeholder={"Live class on binary trees\nDoubt session\nChecked assignments"}
              className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-content"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">
              Deliverable Quantity
              <span className="ml-2 font-normal text-muted">
                leave empty if you did not count them
              </span>
            </span>
            <textarea
              rows={3}
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              placeholder={"1\n1\n12   — or leave empty"}
              className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-content"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">
              Working Hours
              <span className="ml-2 font-normal text-muted">
                one for each deliverable, in the same order
              </span>
            </span>
            <textarea
              rows={3}
              value={draft.workingHours}
              onChange={(e) => setDraft({ ...draft, workingHours: e.target.value })}
              placeholder={"2h\n45m\n1h"}
              className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-content"
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

          {/* ── What will actually be recorded ─────────────────────────────
            * Built by the same function the server will run, so the preview
            * cannot promise something different from what is written.
            *
            * It is also the only defence against the one mistake no counting
            * rule catches: three deliverables and three durations that line up
            * in COUNT but not in meaning. A reader can see "Doubt session —
            * 2h" and know the hours went to the wrong line; nothing in the
            * arithmetic can. */}
          {draft.deliverable.trim() || draft.workingHours.trim() ? (
            <div className="rounded-control border border-line bg-sunken px-3.5 py-3">
              {split.ok ? (
                <>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {split.entries.length === 1
                      ? "This will be recorded as"
                      : `${split.entries.length} entries will be recorded`}
                  </p>
                  <ul className="grid gap-1">
                    {split.entries.map((entry, i) => (
                      <li key={i} className="text-sm text-content">
                        <span className="tabular text-muted">{formatHours(entry.workingHours)}</span>
                        {"  "}
                        {entry.deliverable}
                        {entry.quantity !== null ? (
                          <span className="text-muted"> · {entry.quantity}</span>
                        ) : (
                          <span
                            className="text-muted"
                            title="No count given — the report will show ? unless this is a class, meeting or session, which counts as one"
                          >
                            {" "}
                            · not counted
                          </span>
                        )}
                        {entry.remarks ? (
                          <span className="text-muted"> · {entry.remarks}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {split.entries.length > 1 ? (
                    <p className="mt-2 text-xs text-muted">
                      Placed one after another from the start of your working day.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-warning-text">{split.reason}</p>
              )}
            </div>
          ) : null}
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}

/**
 * The day in one box, and what became of it.
 *
 * ── Why the states are spelled out ────────────────────────────────────────
 * The reading takes a few seconds and happens after the request that saved the
 * text has already answered. A screen that says nothing during that is a screen
 * that looks broken, and one that says "saved!" and shows an empty day is
 * worse. So every state a submission can be in has words here, and the two that
 * matter most say the same thing in different ways: your words are safe.
 */
function NarrativeEntry({
  date,
  onDate,
  today,
  value,
  onChange,
  reading,
  onRetry,
}: {
  date: string;
  onDate: (date: string) => void;
  value: string;
  onChange: (value: string) => void;
  reading: ReadingState;
  onRetry: (submissionId: string) => void;
  /** The latest day that may be written up — the UNIVERSITY's today. */
  today: string;
}) {
  const busy =
    reading?.phase === "sending" || reading?.phase === "reading" || reading?.phase === "loading";

  return (
    <div className="grid gap-5">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-content">Date</span>
        {/* Pinned to today, both ends. `max` alone let a past date be picked and
            then refused on submit — a date field that offers a day the server
            will not take is a field that exists to waste somebody's typing. */}
        <input
          type="date"
          value={date}
          min={today}
          max={today}
          onChange={(e) => onDate(e.target.value)}
          disabled={busy || reading !== null}
          className="h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-content disabled:opacity-60"
        />
        <span className="mt-1.5 block text-xs text-muted">
          You record today. Ask your manager to record an earlier day.
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-content">
          What did you do today?
        </span>
        <textarea
          rows={7}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy || reading !== null}
          placeholder={
            "9 AM to 11 AM took DSA lecture on binary trees for section A, " +
            "11:15 to 12 doubt clearing session, 1 to 2 checked 12 assignments, " +
            "3:15 to 4 prepared slides for next week"
          }
          className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed text-content disabled:opacity-60"
        />
        <span className="mt-1.5 block text-xs text-muted">
          Write it however you like — one line or ten. Include the times you started and
          finished each thing, and any counts (&ldquo;12 assignments&rdquo;). Nothing is
          filled in for you if you leave it out.
        </span>
      </label>

      {reading === null ? null : (
        <div
          role="status"
          aria-live="polite"
          className={
            "rounded-control border px-3.5 py-3 text-sm " +
            (reading.phase === "failed"
              ? "border-danger/30 bg-danger-subtle text-danger-text"
              : reading.phase === "review"
                ? "border-warning/30 bg-warning-subtle text-warning-text"
                : reading.phase === "done"
                  ? "border-success/30 bg-success-subtle text-success-text"
                  : "border-line bg-sunken text-muted")
          }
        >
          {reading.phase === "loading" ? (
            <span className="inline-flex items-center gap-2">
              <Spinner />
              Loading today&rsquo;s entry…
            </span>
          ) : reading.phase === "sending" ? (
            <span>Saving your worklog…</span>
          ) : reading.phase === "reading" ? (
            <span className="inline-flex items-center gap-2">
              <Spinner />
              Analysing and organising your worklog…
            </span>
          ) : reading.phase === "done" ? (
            <span>
              Worklog organised successfully — {reading.activities}{" "}
              {reading.activities === 1 ? "activity" : "activities"} recorded. It is in the
              table behind this box.
            </span>
          ) : reading.phase === "review" ? (
            <div className="grid gap-1.5">
              <span className="font-semibold">
                We organised your worklog, but some details need your review.
              </span>
              <ul className="grid gap-1 pl-4">
                {reading.notes.map((note) => (
                  <li key={note} className="list-disc text-[13px]">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : reading.phase === "slow" ? (
            <span>
              Still organising. Your worklog is saved — close this box and it will appear in
              the table shortly. You will get a notification when it is ready.
            </span>
          ) : (
            <div className="grid gap-2">
              <span>{reading.message}</span>
              {reading.submissionId ? (
                <button
                  type="button"
                  onClick={() => onRetry(reading.submissionId!)}
                  className="w-fit rounded-control border border-danger/40 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-danger/10"
                >
                  Try reading it again
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 animate-spin motion-reduce:animate-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
    </svg>
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
function Plus() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4">
      <path d="M10 4.5v11M4.5 10h11" {...stroke} strokeWidth={2} />
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
