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
import { useQueryState } from "@/app/_lib/query-state";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { dateIn, formatHours, todayIn, todayISO } from "@/app/_lib/format";
import {
  broadCategoryCell,
  deliverableLines,
  quantityLines,
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
import { AiInsightCell, type CellInsight } from "@/app/_components/AiInsightCell";

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

/**
 * The range Day Wise opens on: exactly one page of days, ending today.
 *
 * It used to be the first of the month to today, which on the 28th asked for
 * twenty-eight rows and then paginated them ten at a time — so the calendar
 * above the table described a period the table was never showing all of, and
 * the first thing anybody had to do was page. Sizing the default range to the
 * page means what the two date fields say is what is on screen.
 *
 * Widening the range by hand still works and still paginates; this is only
 * where it starts.
 */
const defaultDayRange = (zone?: string | null) => {
  const end = todayIn(zone);
  return { from: addDays(end, -(PAGE_SIZE - 1)), to: end };
};

/** Monday and Sunday of the week a date falls in, as the two filters read them. */
const weekRange = (date: string) => {
  const days = weekOf(date);
  return { from: days[0]!, to: days.at(-1)! };
};

/**
 * One page of WEEKS, ending with the week in progress.
 *
 * Weekly used to open on a single week and lay it out as its seven days, which
 * made it Day Wise with a narrower window rather than a different reading. It
 * now works the way Day Wise does — this week at the top, the weeks before it
 * underneath — so the two views differ in the UNIT they accumulate into, which
 * is the only reason to have both.
 */
const defaultWeekRange = (zone?: string | null, count = PAGE_SIZE) => {
  const current = weekOf(todayIn(zone));
  return { from: addDays(current[0]!, -7 * (count - 1)), to: current.at(-1)! };
};

/** "18 – 24 Aug 2026", from the Monday of a week. */
const weekLabel = (monday: string) => {
  const days = weekOf(monday);
  return `${longDate(days[0]!).slice(0, 6)} – ${longDate(days.at(-1)!)}`;
};

/**
 * What the screen says while a paragraph is being read, and afterwards.
 *
 * Null until a paragraph is sent. The states after that are the submission's
 * own, so the screen and the database never disagree about where a day is —
 * `processingState` is computed on the server from one field, and this only
 * chooses the words for it.
 */



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

/**
 * The sheet's columns.
 *
 * Actions is the last one and Date Wise's alone — a week row is an
 * accumulation of up to seven days with nothing for a pencil to open, so in
 * Weekly the column is not emptied, it is not there. An empty column with a
 * heading over it reads as a feature that is broken rather than one that does
 * not apply.
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
  /* Last, after the actions, on purpose. The reader reaches it having already
     seen the hours and deliverables it is describing — which is the only order
     in which a summary can be checked rather than just believed. */
  "AI Insight",
];

/** Which severity outranks which, for a row that covers more than one day. */
const SEVERITY_ORDER: Record<CellInsight["severity"], number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export default function WorkLogHistoryPage() {
  const toast = useToast();


  /* Which view, which dates, which search, which page — in the URL, so a
   * refresh comes back to the same screen instead of dropping the reader on
   * today's Day Wise. Day Wise is still the default; it is just no longer the
   * only thing a reload can produce. See `useQueryState`.
   *
   * Neither view carries an anchor of its own. Day Wise reads the two date
   * filters; Week Wise reads the week the From filter falls in. They used to
   * have one each, stepped by arrows above the filters — with those gone there
   * is nothing left to move an anchor, and one that cannot move is just a
   * second, stale source of truth beside the filters. */
  const [q, setQ] = useQueryState({ view: "date", from: "", to: "", search: "", page: "1" });
  const view = q.view === "week" ? "week" : "date";
  const from = q.from || null;
  const to = q.to || null;
  const search = q.search;
  const page = Math.max(1, Number(q.page) || 1);

  const setPage = (n: number) => setQ({ page: String(n) });
  /** The day whose individual entries are open, when it was written in several. */

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
   * is what an EDIT always uses — correcting one row is not rewriting the day.
   *
   * `fields` is also the DEFAULT. Writing it out is the more capable path and
   * was the default for that reason, but it costs a provider round trip before
   * anything is recorded, and the columns it fills are the ones these four
   * boxes ask for outright. Somebody opening this box to record a day they
   * already know the shape of should not have to wait for a model to read it
   * back to them. Writing it out is one click away and unchanged. */

  const me = useLoad(
    useCallback(
      () =>
        apiGet<{
          user: { instructorId: string | null };
          timezone: string | null;
          recordsFrom: string | null;
        }>("/api/auth/me", "Could not load your account."),
      [],
    ),
    "me",
  );
  const instructorId = me.data?.user.instructorId ?? null;
  /* "Today" means the university's today, because that is the only one the
   * server will accept a worklog for. See `todayIn`. */
  const zone = me.data?.timezone ?? null;
  const today = todayIn(zone);

  /**
   * The stored reading for a row.
   *
   * A Date row is one day and takes that day's. A WEEK row covers up to seven,
   * and takes the MOST SEVERE of them rather than the newest or an average: a
   * week holding one critical day is a week worth opening, and any other rule
   * hides exactly the row somebody needed to see.
   *
   * Returns null freely. A day recorded a moment ago has not been analysed yet
   * — analysis happens after the write — and the column prints an em dash for
   * it, which is true.
   */
  const insightFor = (dates: string[]): CellInsight | null => {
    if (!instructorId) return null;
    const found = logs.data?.insights;
    if (!found) return null;

    let worst: CellInsight | null = null;
    for (const date of dates) {
      const hit = found[`${instructorId}:${date}`];
      if (!hit) continue;
      if (!worst || SEVERITY_ORDER[hit.severity] > SEVERITY_ORDER[worst.severity]) worst = hit;
    }
    return worst;
  };

  /* The earliest day there could be anything to look at: the day this
   * instructor's record was created, read in the university's own zone.
   *
   * Both date fields are floored at it. A range starting before somebody
   * existed can only ever come back empty — which is exactly what looked like
   * a bug: the filter said the 1st, the table started on the 17th, and nothing
   * on screen explained that the 16 days between were days this person did not
   * yet have. The picker refusing them says it plainly. */
  const recordsFrom = me.data?.recordsFrom ? dateIn(new Date(me.data.recordsFrom), zone) : null;
  /** Clamps any date to the range that can actually hold data. */
  const inRange = (date: string) =>
    recordsFrom && date < recordsFrom ? recordsFrom : date > today ? today : date;

  // What the filters actually resolve to right now.
  const fromAt = inRange(from ?? defaultDayRange(zone).from);
  const toAt = to ?? today;
  /* Weekly has no anchor of its own. It reads the same two date filters Day
   * Wise reads and simply rounds them out to whole weeks — so the filters and
   * the table always describe the same period, and there is no second source of
   * truth to drift from them. */


  /* No `page` here, deliberately — see `ENTRY_FETCH_LIMIT`. The window's
   * entries come back together and the report paginates the days it groups them
   * into, so a day can never appear on two pages at once. */
  /* Which window to fetch.
   *
   * Day Wise is a feed and uses both date filters. Week Wise widens the From
   * filter to the whole week it falls in, so a week always shows seven days
   * rather than the ragged slice the filters happen to describe. */
  const [windowFrom, windowTo] = useMemo<[string, string]>(() => {
    // Whole weeks, so a row is never a ragged slice of one.
    if (view === "week") return [weekOf(fromAt)[0]!, weekOf(toAt).at(-1)!];
    return [fromAt, toAt];
  }, [view, fromAt, toAt]);

  const query = `from=${windowFrom}&to=${windowTo}&limit=${ENTRY_FETCH_LIMIT}${
    search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""
  }`;

  const logs = useLoad(
    useCallback(
      () =>
        apiGet<{
          activities: Row[];
          /** Keyed `instructorId:YYYY-MM-DD`. Absent for a day not yet analysed. */
          insights?: Record<string, CellInsight>;
          page: number;
          limit: number;
          total: number;
          hasMore: boolean;
        }>(
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

  /* Picking either date. In Day Wise it moves that end alone; in Week Wise it
   * snaps BOTH to the week the chosen day falls in, because that is the range
   * the table is about to render either way. */
  function pickDate(value: string, end: "from" | "to") {
    if (!value) return;
    // `min`/`max` on the input are a hint the keyboard can walk straight past,
    // so the value is clamped here too rather than trusted.
    value = inRange(value);
    if (view === "week") {
      const week = weekRange(value);
      setQ({ from: week.from, to: week.to, page: "1" });
    } else {
      setQ({ [end]: value, page: "1" });
    }
  }

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
      /* One row per WEEK, newest first — the week in progress at the top and
         the weeks before it under, which is the order Day Wise reads days in.
         Each row accumulates its seven days: `buildPeriodRow` merges the
         deliverables, sums the hours and totals the quantities across whatever
         dates it is handed, so a week is one line rather than seven. */
      const earliest = weekOf(fromAt)[0]!;
      const weeks: PeriodRow[] = [];
      for (let monday = weekOf(toAt)[0]!; monday >= earliest; monday = addDays(monday, -7)) {
        const days = weekOf(monday);
        weeks.push(
          build(
            monday,
            days.includes(today) ? `This week — ${weekLabel(monday)}` : weekLabel(monday),
            undefined,
            days,
          ),
        );
      }
      return weeks;
    }

    /* Day Wise: every day in the range asked for, newest first — including
     * the ones with nothing on them, because a silently skipped day is a day
     * nobody can see was skipped.
     *
     * The floor used to be the OLDEST DAY THAT HAD AN ACTIVITY, which quietly
     * made the two date fields decorative: asking for the 1st when the first
     * entry was on the 17th produced a table starting on the 17th, and the
     * sixteen missed days in between — the exact thing this view exists to
     * surface — were the ones it left out. It reads to `fromAt` now, which the
     * picker has already floored at the day this instructor's record began, so
     * it cannot run back into days that were never theirs. */
    const days = [...new Set(activities.map((a) => a.workDate))].sort();
    const newest = days.at(-1);
    const first = days[0];
    const oldest = first && first < fromAt ? first : fromAt;
    const span: string[] = [];
    for (let d = newest && newest > today ? newest : today; d >= oldest; d = addDays(d, -1)) {
      span.push(d);
    }
    return span.map((date) =>
      build(date, date === today ? `Today — ${longDate(date)}` : longDate(date), weekdayOf(date), [date]),
    );
  }, [rows, view, today, fromAt, toAt, dayNotes.data]);


  /**
   * A blank box for a day that has happened.
   *
   * Defaults to today, which is the header button's case. A missed day is the
   * reason it takes an argument at all: editing a past row is no use when the
   * row is empty, and "I forgot Tuesday" is the whole point of being allowed to
   * write days other than this one.
   */
  function openNew(date: string = today) {
    setEditing(null);
    setEditingToday(false);
    setDraft(emptyDraft(date));
    setFormError(null);
    setOpen(true);
  }

  /**
   * "Edit Today's Log" — the whole day, read back and reopened for
   * correction, not a blank box.
   *
   * Submitting from here is not a special path: it is the ordinary POST to
   * `/worklog` for today's date, which `submitWorklog` already treats as
   * replacing the day rather than appending to it — see the service's own
   * comment on that. Nothing here needs to know it is an edit; the server
   * already does.
   */
  /** The header's button: today, which is the common case. */
  function openEditToday() {
    openEditDay(today);
  }

  /**
   * A whole day, back in the four boxes, ready to be rewritten.
   *
   * Takes the date rather than assuming today, because the Actions column now
   * offers this on every day that has happened — a day with five entries in it
   * is edited as a day, not as five separate rows.
   */
  function openEditDay(date: string) {
    if (!instructorId) return;
    setEditing(null);
    setEditingToday(date === today);
    setFormError(null);

    /* Today's own lines, back in the four boxes that wrote them.
     *
     * Read from `rows` — already on screen, already today's — rather than
     * fetched. This used to open the paragraph box and pull the day's
     * `rawBullets` back from the server, which only ever held anything for a
     * day written that way; a day filled in through these boxes has no
     * narrative to return, so the box opened empty and saving it replaced the
     * day with nothing.
     *
     * The lists stay index-aligned, empties included, because `splitEntries`
     * pairs them by position — dropping a blank quantity would shift every
     * hour after it onto the wrong deliverable. */
    const todays = rows.filter((r) => r.workDate.slice(0, 10) === date);
    setDraft({
      date,
      deliverable: todays.map((r) => r.rawText ?? r.deliverableType?.label ?? "").join("\n"),
      quantity: todays.map((r) => String(r.quantity ?? "")).join("\n"),
      // Printed the way the table prints it, so an edit does not turn
      // "8h 30m" into "8.5" in front of the person correcting it.
      workingHours: todays
        .map((r) => formatHours(r.durationHours).replace(/^0/, ""))
        .join("\n"),
      remarks: todays.map((r) => r.remarks ?? "").join("\n"),
    });
    setOpen(true);
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
          /* Rewriting the whole day, not adding to it — every line of it is
           * in the boxes, so appending would duplicate the ones left alone.
           * The server does the clearing; see `replace` on the entry route. */
          ...(editingToday ? { replace: true } : {}),
        },
        editing ? "Could not save that change." : "Could not submit your work log.",
      );
      /* One sentence about the DAY, whichever path got here and however many
       * lines it turned into. It used to count rows — "2 entries recorded." —
       * which answers a question nobody asked at the moment they press Submit:
       * they want to know the day went in, and the table behind the dialog is
       * already showing them what it became. */
      /* Correcting, by either route: one row through the pencil (`editing`)
       * or the whole day through "Edit Today's Log" (`editingToday`). Only
       * the first was checked, so rewriting the day — which REPLACES it —
       * congratulated the instructor for submitting something they had
       * already submitted. */
      const correcting = Boolean(editing || editingToday);
      toast(
        "success",
        correcting
          ? "Your work log for today has been updated successfully."
          : "Your work log for today has been submitted successfully.",
        correcting ? "Updated!" : "Great job!",
      );
      setOpen(false);
      logs.reload();
        } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Every entry on one day.
   *
   * Asked about first when there is more than one, because the button sits on a
   * row that prints a day and deleting five things from one click is not what
   * "remove" looks like it will do. Deleted one at a time — there is no
   * day-level DELETE — and the reload comes once at the end rather than after
   * each, so the table does not flicker through four intermediate states.
   */
  async function removeDay(label: string, entries: Row[]) {
    if (!instructorId || entries.length === 0) return;
    if (
      entries.length > 1 &&
      !window.confirm(`Remove all ${entries.length} entries recorded on ${label}?`)
    ) {
      return;
    }
    try {
      for (const entry of entries) {
        await apiSend(
          `/api/instructors/${instructorId}/activities/${entry.id}`,
          "DELETE",
          undefined,
          "Could not remove that entry.",
        );
      }
      toast(
        "success",
        entries.length === 1
          ? "Entry removed successfully."
          : `${entries.length} entries removed from ${label}.`,
      );
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not remove that entry.");
    } finally {
      // Whatever happened, the table is refetched: a partial delete must not
      // leave rows on screen that are no longer in the database.
      logs.reload();
    }
  }

  /** The paragraph box, rather than the four fields. Never while editing a row. */

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

  /** Weekly drops the last column — see `COLUMNS`. */
  /* Weekly has no Actions — a week row covers up to seven days and one button
     cannot say which. It KEEPS AI Insight, so this filters by name rather than
     slicing off the end, which would now take the wrong column. */
  const columns = view === "date" ? COLUMNS : COLUMNS.filter((c) => c !== "Actions");

  return (
    <div>
      {/* ── The page's own heading, outside the card ────────────────────────
          The card below carries its own, quieter heading beside the view
          switch. Two headings is what the client's design shows and they are
          not a duplicate: this one names the PAGE, that one names the table and
          the control that changes it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-primary-text">
            Work Log History
          </h1>
          <p className="mt-1 text-sm text-muted">View and manage submitted work logs</p>
        </div>

        {/* ── The day's state, right of the heading ─────────────────────
            One control, and no standing message.

            "Great job!" is a POPUP — the toast `submit()` raises, and the one
            the edit path raises after it. A banner saying the same words was
            printed on every load for as long as today stayed submitted, which
            congratulates a page load rather than an action, and put the same
            sentence on screen twice the moment the toast appeared over it.

            What stays here is the thing that is still true tomorrow morning:
            whether today needs writing, or can be corrected. */}
        {!todayInView ? null : hasSubmittedToday ? (
          <button
            type="button"
            onClick={openEditToday}
            className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-[6px] border border-success/40 bg-success-subtle px-5 text-sm font-semibold text-success-text transition-colors hover:bg-success/10"
          >
            <Pencil />
            Edit Today&rsquo;s Log
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openNew()}
            className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-[6px] bg-primary px-5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover"
          >
            <Plus />
            Today&rsquo;s Work Log
          </button>
        )}
      </div>

      {/* ── The one card ────────────────────────────────────────────────────
          Everything that reads the table lives in it: its heading, the view
          switch, the strip, the filters, the table itself and the count. One
          container, so switching Date Wise to Weekly changes what is inside it
          rather than swapping one card for another. */}
      {/* `border-line`, the real token. This said `border-line-card`, which is
          not one — so Tailwind generated no colour and `border` fell back to
          its default of `currentColor`, drawing the card's outline in the dark
          text colour. A black box around a white card, from a typo in a name
          nothing validates. */}
      <div className="mt-5 rounded-card border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
          <h2 className="text-base font-bold tracking-tight text-primary-text">Work Log History</h2>
          <div className="flex flex-wrap items-center gap-3">
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
                  /* Each view sets the calendar to the range it is about to
                     show: Week Wise to this week's Monday and Sunday, Day Wise
                     to one page of days ending today. The filters and the table
                     then describe the same period rather than the filters
                     describing one the table has never shown.

                     All four in ONE patch: `router.replace` does not update the
                     address synchronously, so four calls here would each read
                     the same URL and the last would be the only one kept. */
                  const range =
                    v === "week" ? defaultWeekRange(zone) : defaultDayRange(zone);
                  setQ({ view: v, from: range.from, to: range.to, page: "1" });
                }}
                aria-pressed={view === v}
                className={`rounded-[calc(var(--radius-control)-2px)] px-4 py-1.5 text-sm font-semibold transition-colors ${
                  view === v
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-primary-subtle hover:text-primary-text"
                }`}
              >
                {v === "date" ? "Date Wise" : "Weekly"}
              </button>
            ))}
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
          </div>
        </div>

        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-sm font-medium text-content">From Date</span>
          <input
            type="date"
            value={fromAt}
            min={recordsFrom ?? undefined}
            max={toAt}
            onChange={(e) => {
              /* In Week Wise both fields move together, to the week the picked
                 day falls in. The view shows a whole week whatever the filters
                 say, so letting them describe part of one would leave the
                 calendar disagreeing with the table underneath it. */
              pickDate(e.target.value, "from");
            }}
            className="h-11 w-40 rounded-control border border-line bg-surface px-3 text-sm text-content"
          />
        </label>

        <label className="flex items-center gap-2">
          <span className="shrink-0 text-sm font-medium text-content">To Date</span>
          <input
            type="date"
            value={toAt}
            min={view === "week" ? (recordsFrom ?? undefined) : fromAt}
            max={today}
            onChange={(e) => {
              pickDate(e.target.value, "to");
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
              setQ({ search: e.target.value, page: "1" });
            }}
            placeholder="Search by deliverable, remarks..."
            className="h-11 w-full rounded-control border border-line bg-surface pl-10 pr-3 text-sm text-content"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            // Reset means "back to this view's own default range", not
            // always Day Wise's — resetting inside Week Wise used to hand back
            // a range that was not a week.
            const range =
              view === "week" ? defaultWeekRange(zone) : defaultDayRange(zone);
            setQ({ from: range.from, to: range.to, search: "", page: "1" });
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
          <TableSkeleton rows={PAGE_SIZE} cols={columns.length} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing recorded in this period"
            description="Change the dates, or write up today with the button above."
          />
        ) : (
          <div
            /* ── The table scrolls, the page does not ─────────────────────
             * Its own scroll box with a bounded height, so the title, the view
             * switch, the filters and the column header all stay put and only
             * the rows move. This is `ManagerSheet`'s pattern, and the reason
             * it is that one: `sticky top-0` on the header cells is measured
             * against THIS box, not against the page. An earlier attempt made
             * the page scroll and pinned the header at a hand-computed offset
             * from the top bar — a number that has to be re-derived every time
             * the bar's contents change. It was already wrong when it shipped,
             * and it covered the first row.
             *
             * `border-separate` below is not cosmetic: a collapsed table drops
             * `position: sticky` on its cells, so the header would scroll away
             * with the rows. Every row divider therefore lives on the CELLS —
             * a `<tr>`'s own border does not paint under that model, and the
             * table would silently lose its lines. */
            className="max-h-[60vh] overflow-auto rounded-card border border-line"
          >
            <table className="sticky-col w-full min-w-[68rem] border-separate border-spacing-0 text-[13px]">
              <caption className="sr-only-text">
                Your work logs, newest first, in the columns the monthly report uses.
              </caption>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      /* The background belongs on the CELL, not the row: once a
                         sticky cell detaches it paints on its own, and a
                         transparent one would show the rows sliding underneath. */
                      className="border-r border-line last:border-r-0 sticky top-0 z-10 border-b border-line bg-primary-subtle px-4 py-3.5 text-left text-sm font-semibold text-primary-text"
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
                  const isToday = group.dates.includes(today);
                  /* A row the instructor cannot write to: every date it covers
                     is still ahead. A WEEK row is editable as soon as any day
                     in it has arrived, which is the same test the day rows make
                     one date at a time. */
                  const isFuture = group.dates.every((d) => d > today);

                  /* ── Nothing recorded, and the two reasons are different ──
                   * A day that has passed with nothing on it is somebody not
                   * having filed. A day that has not happened is nobody having
                   * failed at anything. One row saying "—" for both is how a
                   * week half in the future reads as half a week of misses. */
                  if (group.state !== "recorded") {
                    const future = group.state === "future";
                    return (
                      <tr key={group.key} className={future ? "" : "bg-warning-subtle/30"}>
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug text-content">
                          {group.label}
                          {group.sublabel ? (
                            <span className="ml-2 text-xs text-muted">{group.sublabel}</span>
                          ) : null}
                        </td>
                        <td
                          colSpan={5}
                          className={`border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug ${future ? "text-subtle" : "font-medium text-warning-text"}`}
                        >
                          {future ? "Not yet reached" : "No worklog submitted"}
                        </td>
                        {view !== "date" ? null : (
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug">
                          {/* Only where there is a single day to fill. A WEEK
                              row with nothing on it covers up to seven empty
                              days and one button cannot say which of them this
                              would be — those are reached by switching to Date
                              Wise, where each has a row of its own. */}
                          {!future && group.dates.length === 1 ? (
                            <button
                              type="button"
                              onClick={() => openNew(group.dates[0]!)}
                              aria-label={`Record the work log for ${group.label}`}
                              title="Record this day"
                              className="inline-flex size-9 items-center justify-center rounded-control border border-primary/40 text-primary-text transition-colors hover:bg-primary-subtle"
                            >
                              <Plus />
                            </button>
                          ) : null}
                        </td>
                        )}
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug">
                          <AiInsightCell insight={insightFor(group.dates)} />
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <Fragment key={group.key}>
                      <tr className={isToday ? "bg-primary-subtle/25" : ""}>
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug text-content">
                          {group.label}
                          {group.sublabel ? (
                            <span className="ml-2 text-xs text-muted">{group.sublabel}</span>
                          ) : null}
                        </td>
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug text-content">
                          {broadCategoryCell(group.subjects)}
                        </td>
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug text-content">
                          {/* ── The instructor's own words ──────────────────
                              What was TYPED, not what it was classified as.
                              The classification lives in the AI Insight column
                              at the end of the row, which is where a reading of
                              the data belongs — this column is the data.

                              It used to show the classified name, so a line the
                              matcher could not place read "Other / Unclassified
                              Work" and the sentence the instructor actually
                              wrote appeared nowhere on the screen. They could
                              not find their own entry.

                              `rawLines` is empty for entries written before the
                              four-field form captured raw text; those fall back
                              to the classified names, which are then the only
                              record of the line that exists.

                              One per line with a single-colour bullet — the
                              same treatment the manager's sheet uses, so the
                              two read as one report. */}
                          <ul className="space-y-1">
                            {(group.rawEntries.length > 0
                              ? group.rawEntries.map((e) => e.text)
                              : deliverableLines(group.lines)
                            ).map((d, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span
                                  aria-hidden
                                  className="mt-[0.45em] inline-block size-1.5 shrink-0 rounded-full bg-primary"
                                />
                                <span>{d}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="border-r border-line last:border-r-0 tabular border-b border-line-subtle px-3 py-2 align-top leading-snug text-content">
                          {/* ── As typed, one line per entry ────────────────
                              Aligned with the Deliverable lines beside it,
                              which is why `rawEntries` is neither merged nor
                              de-duplicated: line three here has to be the count
                              for line three there.

                              It used to print `quantityLines`, the taxonomy's
                              reading — "1 Class" where somebody wrote "2
                              classes taken". A row that restates your work in
                              its own vocabulary is one you cannot check.

                              An entry whose box was left blank shows the
                              client's `?`: nobody stated a count, which is a
                              real answer and not zero. */}
                          <ul className="space-y-1">
                            {group.rawEntries.length > 0
                              ? group.rawEntries.map((e, i) => (
                                  <li key={i}>
                                    {e.quantity ?? <span className="text-subtle">?</span>}
                                  </li>
                                ))
                              : quantityLines(group.lines).map((q, i) => <li key={i}>{q}</li>)}
                          </ul>
                        </td>
                        <td className="border-r border-line last:border-r-0 tabular border-b border-line-subtle px-3 py-2 align-top leading-snug font-medium text-content">
                          {/* As typed, one line per entry — and the measured
                              total underneath when there is more than one, so
                              the row still answers "how long altogether"
                              without that being the only thing it can say. */}
                          {group.rawEntries.length > 0 &&
                          group.rawEntries.some((e) => e.workingHours) ? (
                            <>
                              <ul className="space-y-1">
                                {group.rawEntries.map((e, i) => (
                                  <li key={i}>
                                    {e.workingHours ?? <span className="text-subtle">—</span>}
                                  </li>
                                ))}
                              </ul>
                              {group.rawEntries.length > 1 ? (
                                <span className="mt-1 block border-t border-line-subtle pt-1 text-xs font-normal text-muted">
                                  {workingHoursCell(group.totalMinutes)} total
                                </span>
                              ) : null}
                            </>
                          ) : (
                            workingHoursCell(group.totalMinutes)
                          )}
                        </td>
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug text-content">
                          {group.remarks || "—"}
                        </td>
                        {view !== "date" ? null : (
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug">
                          <span className="inline-flex items-center gap-2">
                            {/* Date Wise only. A week row is an accumulation
                                of up to seven days: there is no single day for
                                Edit to open, and Delete would clear a week from
                                one click. Both live on the day rows, which is
                                where the record actually is. */}
                            {view !== "date" || isFuture ? null : (
                              /* The same two actions in both views, and in both
                                 they act on the whole row.
                                 
                                 A WEEK row is the awkward one: it covers up to
                                 seven days, and the four boxes hold ONE date,
                                 so there is no honest form to open for it.
                                 Edit therefore takes the reader to that week in
                                 Date Wise, where each day has a row and an Edit
                                 of its own — one click, and it lands on
                                 something that can actually be edited. Delete
                                 does work on the week directly, because
                                 clearing every entry in it is a thing that CAN
                                 be expressed. */
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    view === "date"
                                      ? openEditDay(group.dates[0]!)
                                      : setQ({
                                          view: "date",
                                          from: group.dates[0]!,
                                          to: group.dates[group.dates.length - 1]!,
                                          page: "1",
                                        })
                                  }
                                  aria-label={
                                    view === "date"
                                      ? `Edit the work log for ${group.label}`
                                      : `Open ${group.label} day by day to edit it`
                                  }
                                  title={view === "date" ? "Edit" : "Edit day by day"}
                                  className="inline-flex size-9 items-center justify-center rounded-control border border-primary/40 text-primary-text transition-colors hover:bg-primary-subtle"
                                >
                                  <Pencil />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeDay(group.label, entries)}
                                  aria-label={`Remove the work log for ${group.label}`}
                                  title="Remove"
                                  className="inline-flex size-9 items-center justify-center rounded-control border border-danger/40 text-danger-text transition-colors hover:bg-danger-subtle"
                                >
                                  <Bin />
                                </button>
                              </>
                            )}
                          </span>
                        </td>
                        )}
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug">
                          <AiInsightCell insight={insightFor(group.dates)} />
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}

              </tbody>

              {/* ── The period total ───────────────────────────────────────
                * A week's rows are days and a month's are weeks, so neither
                * table adds up to anything on its own. This is the line the
                * client reconciles against.
                *
                * A `<tfoot>` rather than the body's last row, and not only
                * because that is what the element is for: the frozen-column
                * rule in globals.css repaints the first cell of every BODY row
                * so the pinned column stays opaque, and a total sitting in the
                * body would have its darker ground repainted white by it. */}
              {view !== "date" && groups.some((g) => g.state === "recorded") ? (
                <tfoot>
                  <tr
                    /* Pinned to the BOTTOM of the scroll box, for the same
                       reason the header is pinned to the top: it is the line
                       the client reconciles against, and a total that scrolls
                       out of sight has to be hunted for. Backgrounds sit on the
                       cells because a sticky cell paints on its own once it
                       detaches from the row. */
                    className="font-semibold"
                  >
                    <td className="border-r border-line last:border-r-0 sticky bottom-0 z-10 border-t-2 border-line bg-sunken px-4 py-3.5 text-content">
                      Week total
                    </td>
                    {/* Skips Broad Category, Deliverable and Quantity to land
                        the total under Working Hours, then Remarks. This row is
                        Weekly's alone, and Weekly has no Actions column — so
                        the trailing spacer is one cell, not two. */}
                    <td colSpan={3} className="border-r border-line last:border-r-0 sticky bottom-0 z-10 border-t-2 border-line bg-sunken" />
                    <td className="border-r border-line last:border-r-0 tabular sticky bottom-0 z-10 border-t-2 border-line bg-sunken px-4 py-3.5 text-content">
                      {workingHoursCell(groups.reduce((n, g) => n + g.totalMinutes, 0))}
                    </td>
                    <td className="border-r border-line last:border-r-0 sticky bottom-0 z-10 border-t-2 border-line bg-sunken" />
                    {/* Under AI Insight. A week has no single verdict to total. */}
                    <td className="border-r border-line last:border-r-0 sticky bottom-0 z-10 border-t-2 border-line bg-sunken" />
                  </tr>
                </tfoot>
              ) : null}
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
            Showing {firstShown} to {lastShown} of {total} entries
          </p>
          <Pager page={page} lastPage={lastPage} onPage={setPage} />
        </div>
      ) : null}

        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        icon={<Clipboard />}
        dividers={false}
        size="lg"
        /* Closed by the X or Cancel, and nothing else. This box is typed into,
           and a click landing beside it — or an Escape meant for the date
           picker inside it — used to throw the whole entry away silently. */
        dismissible={false}
        title={
          editing
            ? "Edit work log"
            : editingToday
              ? "Edit Today's Work Log"
              : draft.date === today
                ? "Today's Work Log"
                : "Work Log"
        }
        /* The date is stated whenever it is not today. A box that says "for
           today" while writing last Tuesday is the one mistake this whole
           screen is arranged to prevent. */
        description={
          editing
            ? `Correcting the entry from ${longDate(draft.date)}.`
            : draft.date === today
              ? "Add your deliverables and working details for today."
              : `Add your deliverables and working details for ${longDate(draft.date)}.`
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
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
              {saving ? "Saving…" : editing ? "Update Work Log" : "Submit Work Log"}
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

          {/* ── One way in, and it is the fields ───────────────────────────
              There used to be a choice here: a paragraph the parser read, or
              these four boxes. The paragraph is gone from the instructor's
              surface at the client's request — submitting and correcting both
              use the fields now, so there is nothing to choose between and no
              control asking. */}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">
              Deliverable
            </span>
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
            <textarea
              rows={2}
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              placeholder="Enter deliverable quantity"
              className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-content"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-content">
              Working Hours
            </span>
            <textarea
              rows={2}
              value={draft.workingHours}
              onChange={(e) => setDraft({ ...draft, workingHours: e.target.value })}
              placeholder="Enter working hours (e.g., 8)"
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

          {/* Nothing after Remarks.
            *
            * A preview of the entries about to be written used to sit here,
            * and a warning beside it when the deliverable lines and the hour
            * lines did not pair up. Both are gone at the client's request; the
            * box is the four fields and the buttons.

            * The pairing is still checked — `submit()` refuses on `!split.ok`
            * and puts the reason in the error line at the top of this dialog,
            * which is where every other refusal in it already appears. What is
            * lost is only the chance to see the mistake BEFORE pressing
            * Submit. */}
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
