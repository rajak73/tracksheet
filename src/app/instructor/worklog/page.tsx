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
 * ── There is no Broad Category column ─────────────────────────────────────
 * There was, and it held the subject the model read off each entry. It is gone
 * with the taxonomy it belonged to: the table now shows what the instructor
 * wrote, in the three boxes they wrote it in, and a column that classified that
 * text was the layer this redesign removed. What was classified is not lost —
 * it is the AI Insight column's job, at the end of the row, where a reading can
 * be checked against the raw text it read.
 */

import { Fragment, useCallback, useMemo, useState } from "react";
import { useQueryState } from "@/app/_lib/query-state";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { parseActivities } from "@/domain/worklog-activities";
import {
  DeliverableFields,
  emptyNumbers,
  lineIndexes,
  parseLines,
  type LineNumbers,
} from "@/app/_components/DeliverableFields";
import { dateIn, formatDayAs, todayISO, todayIn } from "@/app/_lib/format";
/* Only the duration formatter. `deliverableLines` and `quantityLines` printed
   the taxonomy's reading of a day — merged names and summed counts — and there
   is no reading on this screen any more; the three text columns print what is
   in the three boxes. Both still serve the manager's sheet. */
import { workingHours as workingHoursCell } from "@/domain/worklog-report";
import { addDays, weekOf } from "@/domain/periods";
import { buildDayRow, type DayRow } from "@/domain/worklog-day-rows";
import { Dialog, useToast } from "@/app/_components/interactive";
import { EmptyState, ErrorState, TableSkeleton } from "@/app/_components/ui";
import { DayInsightCell } from "@/app/_components/DayInsightCell";

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

/**
 * One day, exactly as the four boxes hold it.
 *
 * There is no activity type, deliverable type or broad category any more, and
 * nothing here is derived: `deliverable` and `deliverableQuantity` are what
 * somebody typed and are rendered verbatim.
 */
type Row = {
  id: string;
  logDate: string;
  deliverable: string;
  deliverableQuantity: string | null;
  /**
   * The rows as authored, when the day has them. Null on a legacy day.
   *
   * Without this the edit dialog has nothing to reopen from and falls back to
   * the newline-joined text derived from the rows — which is how a day written
   * as three activities came back as one box.
   */
  activities?: unknown;
  workingMinutes: number;
  remarks: string | null;
  status?: string;
  /** `MIGRATED` means the text was rebuilt from the old taxonomy's labels. */
  source: "NATIVE" | "MIGRATED";
};

/** What the AI Insight cell knows, read from the cache and never generated. */
type DayInsight =
  | { state: "READY"; summary: string; generatedAt: string }
  | { state: "PENDING" }
  | { state: "FAILED" };

type Draft = {
  date: string;
  /** The day's work, one activity per bullet. */
  deliverable: string;
  /**
   * Quantity, Hr and Min for each bullet, keyed by LINE index.
   *
   * By line rather than by position in the filtered list, so a blank line in the
   * middle cannot shift every number below it onto the wrong activity — which is
   * the failure this form exists to prevent, arriving through the back door.
   */
  numbers: Record<number, LineNumbers>;
  remarks: string;
};

/* The date defaults to the UNIVERSITY's today — the only day the server will
 * accept a worklog for. Passed in rather than read here, because a module-level
 * helper cannot know whose university it is. */
/** A day's text as bullets. Only the marker is added; no word is changed. */
function bulleted(text: string): string {
  if (text.trim() === "") return "";
  return text
    .split("\n")
    .map((l) => (l.trim() === "" ? l : /^\s*[•\-*]\s/.test(l) ? l : `• ${l.trim()}`))
    .join("\n");
}

/**
 * The numbers an edit reopens with.
 *
 * An authored day returns exactly what was typed against each bullet. A legacy
 * day has no per-activity numbers to return — its quantity box was one string
 * for the whole day and its total was typed independently — so the fields open
 * blank rather than being filled with a split nobody stated. That is the same
 * refusal to guess that the form itself is for.
 */
function numbersFromDay(day?: Row | null): Record<number, LineNumbers> {
  const rows = parseActivities(day?.activities);
  if (!rows) return {};
  const out: Record<number, LineNumbers> = {};
  rows.forEach((r, i) => {
    out[i] = {
      quantity: r.quantity === null ? "" : String(r.quantity),
      hr: String(Math.floor(r.minutes / 60)),
      min: String(r.minutes % 60),
    };
  });
  return out;
}

/** The rows on the wire: each bullet with the numbers written beside it. */
function toActivities(draft: Draft) {
  const indexes = lineIndexes(draft.deliverable);
  return parseLines(draft.deliverable).map((description, position) => {
    const n = draft.numbers[indexes[position]!] ?? emptyNumbers();
    return {
      description,
      /* Blank stays blank. A meeting has no count, and 0 would claim zero of
         something happened. */
      quantity: n.quantity.trim() === "" ? null : Number(n.quantity),
      hr: n.hr.trim() === "" ? 0 : Number(n.hr),
      min: n.min.trim() === "" ? 0 : Number(n.min),
    };
  });
}

/**
 * A stored deliverable as its activities, one per line.
 *
 * Split on NEWLINES only. Commas are content — "Project evaluation, PR code
 * reviews, and 1:1 doubt resolution" is one activity — so splitting on them
 * would invent entries nobody wrote, which is the guessing this whole surface
 * exists to remove.
 */
function activityLines(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter((l) => l !== "");
  return lines.length > 0 ? lines : [text];
}

/**
 * A stored quantity as its entries, one per line.
 *
 * Here commas ARE the separator, because this column is written by the form as
 * `join(", ")` over one number per activity. A legacy box holding prose — "2
 * classes taken, 1 doubt session" — splits into two readable pieces, which is
 * the closest honest reading of a string that was always a list.
 */
function quantityParts(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

const emptyDraft = (today?: string): Draft => ({
  date: today ?? todayISO(),
  deliverable: "",
  numbers: {},
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
  /**
   * Whether this dialog was opened on a day that ALREADY has a worklog.
   *
   * It no longer decides anything about the write. A save is an upsert on
   * (instructor, date), so correcting a day and writing it for the first time
   * are the same request and the server needs no flag to tell them apart —
   * which is what killed the duplicate-day bug this flag used to carry: it was
   * `editingToday`, so the pencil on last Tuesday appended a second copy of the
   * day instead of replacing it. There is now one row per day and no second
   * copy to make.
   *
   * What it still decides is the wording: whether the dialog says Edit and the
   * toast says updated, or they say the day is being written for the first
   * time. That is worth getting right and is all this is for.
   */
  const [editingDay, setEditingDay] = useState(false);
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
   * The stored reading for a row, when the row is one day.
   *
   * A WEEK row gets null, and that is not a gap. The map holds DAY readings;
   * printing one of them against a row covering seven days would present a
   * summary of Tuesday as a summary of the week. The week's own reading is
   * asked for from the cell, at WEEK scope, by somebody who wants it.
   */
  const insightFor = (dates: string[]): DayInsight | null => {
    if (dates.length !== 1) return null;
    return logs.data?.insights?.[dates[0]!] ?? null;
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
          days: Row[];
          /** Keyed `YYYY-MM-DD`. A date absent from it has no worklog row. */
          insights?: Record<string, DayInsight>;
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

  /* The day-subject fetch that used to live here is gone for good now.
   *
   * It answered "what was this day about" by carrying an inferred subject
   * forward onto days whose own lines named none. There is no column left for
   * it to fill. `/api/instructors/:id/day-subjects` still answers — it is not
   * this commit's to remove — but nothing on this screen asks it. */

  const rows = useMemo(() => logs.data?.days ?? [], [logs.data]);

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
    () => rows.some((r) => r.logDate === today),
    [rows, today],
  );

  /* The reading of each day: professional activity names, comma-separated, with
   * every figure summed on the server from the activities themselves. Fetched
   * for the same window as the rows, and cached there — a second look at the
   * same report does not ask the model again. */
  /* The day-summary fetch that used to live here is gone.
   *
   * ── It was calling Gemini on every view, for nothing ───────────────────
   * The rows are built by `buildDayRow` now, from the stored days.
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
   * Every row comes from `buildDayRow`. The manager's sheet is still on
   * `buildPeriodRow` and its taxonomy until the analytics commit; the two
   * builders sit side by side deliberately and the old one is deleted then.
   */
  const groups = useMemo<DayRow[]>(() => {
    /* The rows ARE the days. There is nothing to adapt: `/api/activities`
       returns `WorklogEntry` rows and `buildDayRow` takes them as they are.
       This used to build a list of synthetic single-activity `RowActivity`
       objects so the manager's accumulator could be reused — a shim that
       existed only while the two screens shared one builder. */
    const notes = dayNotes.data ?? {};
    const build = (key: string, label: string, sublabel: string | undefined, dates: string[]) =>
      buildDayRow({ key, label, sublabel, dates, days: rows, dayNotes: notes, today });

    if (view === "week") {
      /* One row per WEEK, newest first — the week in progress at the top and
         the weeks before it under, which is the order Day Wise reads days in.
         Each row accumulates its seven days: `buildDayRow` keeps every day it
         is handed and sums their hours, so a week is one row carrying up to
         seven days rather than seven rows. */
      const earliest = weekOf(fromAt)[0]!;
      const weeks: DayRow[] = [];
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
    const days = [...new Set(rows.map((r) => r.logDate))].sort();
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
    setEditingDay(false);
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
    /* Any existing day, not just today. See `editingDay`. */
    setEditingDay(true);
    setFormError(null);

    /* The day's own four fields, back in the four boxes that wrote them.
     *
     * Read from `rows` — already on screen — rather than fetched. One row per
     * day means the boxes are the row: no lists to join, nothing to keep
     * index-aligned, and no way for a blank quantity to shift every hour after
     * it onto the wrong deliverable, which is what the old shape risked. */
    const day = rows.find((r) => r.logDate === date);
    setDraft({
      date,
      /* Verbatim, both ways: what was stored goes back into the box exactly as
         it was stored, because an edit must not tidy somebody's own writing.
         Bullets are added to a day that has none so the list reads as a list,
         which changes how it LOOKS and not a character of what it says. */
      deliverable: bulleted(day?.deliverable ?? ""),
      numbers: numbersFromDay(day),
      remarks: day?.remarks ?? "",
    });
    setOpen(true);
  }



  async function submit() {
    if (!instructorId) return;

    /* Checked here only so the instructor is told before the round trip. The
     * server checks the same two things on the same strings and its answer is
     * what is written; this is a courtesy, not the rule. */
    if (parseLines(draft.deliverable).length === 0) {
      return setFormError("Say what you worked on.");
    }

    setSaving(true);
    setFormError(null);
    try {
      /* One request, whether this day is new or being corrected: the route
         upserts on (instructor, date). There is no `replace` flag to send —
         the route still accepts one and ignores it, for anything mid-flight
         during the rollout. */
      await apiSend(
        `/api/instructors/${instructorId}/worklog/entry`,
        "POST",
        {
          date: draft.date,
          /* One activity per row, each carrying its own numbers. The server
             adds the minutes up and derives the sheet's two text columns from
             them — a total it computes cannot be one the activities do not
             support. */
          activities: toActivities(draft),
          remarks: draft.remarks,
        },
        editingDay ? "Could not save that change." : "Could not submit your work log.",
      );
      /* One sentence about the DAY. It used to count rows — "2 entries
       * recorded." — which answers a question nobody asked at the moment they
       * press Submit: they want to know the day went in. */
      const correcting = editingDay;
      /* Names the DAY, not "today". The box writes any past day now, and
         telling somebody their log "for today" was saved while they were
         correcting last Tuesday is the one confusion this screen is arranged
         to prevent. */
      const forDay =
        draft.date === today
          ? "for today"
          : `for ${formatDayAs(draft.date, { day: "numeric", month: "short" })}`;
      toast(
        "success",
        correcting
          ? `Your work log ${forDay} has been updated successfully.`
          : `Your work log ${forDay} has been submitted successfully.`,
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
  /**
   * Removes a whole day, in one call.
   *
   * This used to loop the day's rows, calling the per-activity endpoint once
   * each, and ask "remove all 4 entries?". That loop had a failure mode the new
   * model deletes outright: if three calls succeeded and the fourth failed, the
   * day was left half-removed with nothing recording that it had happened.
   *
   * There is one row, so there is one call, and it is idempotent — deleting a
   * day that is not there succeeds, because the caller asked for it to be absent
   * and it is. The confirmation says what is actually being removed rather than
   * counting entries that no longer exist as separate things.
   */
  async function removeDay(label: string, date: string) {
    if (!instructorId) return;
    if (!window.confirm(`Delete this day's worklog? (${label})`)) return;

    try {
      await apiSend(
        `/api/instructors/${instructorId}/worklog/entry?date=${date}`,
        "DELETE",
        undefined,
        "Could not remove that day.",
      );
      toast("success", `The worklog for ${label} has been removed.`);
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not remove that day.");
    } finally {
      // Whatever happened, the table is refetched: a failed delete must not
      // leave a row on screen that is no longer in the database, or the reverse.
      logs.reload();
    }
  }

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
                          colSpan={4}
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
                          {/* Nothing was recorded, so there is nothing to read.
                              An "Analyse" button here would offer to summarise
                              an empty day. */}
                          <span className="text-subtle">—</span>
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
                          {/* ── The instructor's own words ──────────────────
                              What was TYPED. Any reading of it lives in the AI
                              Insight column at the end of the row, which is
                              where a reading belongs — this column is the data.

                              Numbered, one activity per line. The number is not
                              a category — it is a POSITION, and it is there so
                              the Quantity column beside this one can be read
                              across: line two here is line two there. A day
                              written as one paragraph still prints as one line
                              and gets no number, because there is nothing to
                              line it up with. */}
                          <div className="space-y-1">
                            {group.days.map((d) => (
                              <div key={d.id} className="space-y-0.5">
                                {activityLines(d.deliverable).map((line, i, all) => (
                                  <p key={i} className="flex gap-2 whitespace-pre-wrap">
                                    {all.length > 1 ? (
                                      <span className="tabular shrink-0 text-subtle">{i + 1}.</span>
                                    ) : null}
                                    <span>{line}</span>
                                  </p>
                                ))}
                              </div>
                            ))}
                          </div>
                          {/* ── Where the words came from ──────────────────
                              Nearly three days in four were reconstructed by
                              the collapse out of the old taxonomy's labels, so
                              this is the COMMON case, not an exception. It is
                              one quiet line for that reason: no badge, no
                              colour, no icon. A note that appears on three rows
                              in four and shouts is a note people stop reading.

                              It is not decoration either. Without it somebody
                              asks in six months why an instructor apparently
                              wrote "Live Class Delivery" — phrasing no
                              instructor uses — and nothing in the data answers.
                              Saving the day makes it theirs and this goes. */}
                          {group.hasMigrated ? (
                            <p className="mt-1 text-xs text-subtle">
                              Reconstructed from the previous system
                            </p>
                          ) : null}
                        </td>
                        <td className="border-r border-line last:border-r-0 tabular border-b border-line-subtle px-3 py-2 align-top leading-snug text-content">
                          {/* ── The Quantity box, verbatim, always ──────────
                              Never parsed for display. "gfddgh", "half day" and
                              "2 classes + 1 doubt" print as themselves; the
                              column shows what is in the box, and a box nobody
                              filled shows a dash.

                              It printed the taxonomy's reading before — "1
                              Class" where somebody wrote "2 classes taken" — a
                              row that restates your work in its own vocabulary
                              and so cannot be checked against it.

                              Down the page rather than across it, one entry per
                              line, so it reads beside the activity it belongs
                              to. "1, 2, 1" on a single line is the two-box
                              pairing printed back: the reader has to count along
                              both columns to see which number is whose. */}
                          <div className="space-y-1">
                            {group.days.map((d) => {
                              const parts = quantityParts(d.deliverableQuantity);
                              return (
                                <div key={d.id} className="space-y-0.5">
                                  {parts.length === 0 ? (
                                    <p className="text-subtle">—</p>
                                  ) : (
                                    parts.map((q, i) => <p key={i}>{q}</p>)
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td className="border-r border-line last:border-r-0 tabular border-b border-line-subtle px-3 py-2 align-top leading-snug font-medium text-content">
                          {/* Formatted once from the stored decimal, so every
                              screen prints the same figure from the same
                              number rather than re-parsing a string.

                              A day with no hours shows a dash, NOT "0h 00m".
                              The column is not nullable — it defaults to zero —
                              so zero is the only way "nobody said" can reach
                              here, and printing it as a duration would state a
                              measurement that was never taken. */}
                          <div className="space-y-1">
                            {group.days.map((d) => (
                              <p key={d.id}>
                                {d.workingMinutes > 0 ? (
                                  workingHoursCell(d.workingMinutes)
                                ) : (
                                  <span className="text-subtle">—</span>
                                )}
                              </p>
                            ))}
                          </div>
                          {/* The week's own total, under its days. A Date Wise
                              row is one day and is already its own total. */}
                          {group.days.length > 1 ? (
                            <span className="mt-1 block border-t border-line-subtle pt-1 text-xs font-normal text-muted">
                              {workingHoursCell(group.totalMinutes)} total
                            </span>
                          ) : null}
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
                                {/* Only where the row IS the day it would
                                    delete. A WEEK row covers up to seven, and
                                    a button labelled "remove the work log for
                                    week of 3 Aug" that removed Monday would be
                                    silent data loss. Edit already sends a week
                                    row to Date Wise; Remove is reached the
                                    same way, on the day's own row. */}
                                {group.dates.length === 1 ? (
                                  <button
                                    type="button"
                                    onClick={() => void removeDay(group.label, group.dates[0]!)}
                                    aria-label={`Remove the work log for ${group.label}`}
                                    title="Remove"
                                    className="inline-flex size-9 items-center justify-center rounded-control border border-danger/40 text-danger-text transition-colors hover:bg-danger-subtle"
                                  >
                                    <Bin />
                                  </button>
                                ) : null}
                              </>
                            )}
                          </span>
                        </td>
                        )}
                        <td className="border-r border-line last:border-r-0 border-b border-line-subtle px-3 py-2 align-top leading-snug">
                          <DayInsightCell
                            instructorId={instructorId}
                            scope={group.dates.length === 1 ? "DAY" : "WEEK"}
                            from={group.dates[0]!}
                            to={group.dates[group.dates.length - 1]!}
                            initial={insightFor(group.dates)}
                          />
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
                    {/* Skips Deliverable and Quantity to land the total under
                        Working Hours, then Remarks. This row is Weekly's alone,
                        and Weekly has no Actions column — so the trailing
                        spacer is one cell, not two. */}
                    <td colSpan={2} className="border-r border-line last:border-r-0 sticky bottom-0 z-10 border-t-2 border-line bg-sunken" />
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
          editingDay
            ? draft.date === today
              ? "Edit Today's Work Log"
              : "Edit Work Log"
            : draft.date === today
              ? "Today's Work Log"
              : "Work Log"
        }
        /* The date is stated whenever it is not today. A box that says "for
           today" while writing last Tuesday is the one mistake this whole
           screen is arranged to prevent. */
        description={
          editingDay
            ? `Correcting the work log for ${longDate(draft.date)}.`
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
              {saving ? "Saving…" : editingDay ? "Update Work Log" : "Submit Work Log"}
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
          {/* ── Written once, numbered beside itself ──────────────────────
              There were two free boxes: what you did, and how many, joined by
              NOTHING but position. Half the days in the database show what that
              produces — "1, 1, 12, 1, 4, 1, 1, 1, 6" beside a list of nine
              descriptions, and one day with five descriptions against four
              numbers, so even counting them off fails.

              The client's sheet still has both columns, so the form still has
              both. What it no longer has is the guessing: the activities are
              written once as bullets, and the Quantity section shows those same
              bullets back with a number beside each. The pairing is stated by
              the person who did the work, and nobody types their activities
              twice. */}
          <DeliverableFields
            deliverable={draft.deliverable}
            numbers={draft.numbers}
            onDeliverableChange={(deliverable) => setDraft({ ...draft, deliverable })}
            onNumbersChange={(numbers) => setDraft({ ...draft, numbers })}
          />

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
            * lines did not pair up. There are no lines to pair now — the four
            * boxes are the four fields of one row — so there is nothing left
            * for a preview to show that the boxes do not already say. */}
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
