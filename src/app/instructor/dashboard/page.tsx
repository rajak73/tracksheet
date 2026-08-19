"use client";

/**
 * The instructor's dashboard: one page, a day and a week view of their own work.
 *
 * ── One page, two views, one dataset ──────────────────────────────────────
 * Day and Week are not two screens. Both read the SAME week of activities that
 * was fetched once, so switching is instant and the two can never disagree
 * about a day's total. Moving to another week is the only thing that fetches.
 *
 * ── The university's clock, not the browser's ─────────────────────────────
 * "Today", the day a card belongs to, and the position of every card are all
 * computed in the UNIVERSITY's timezone. An instructor travelling, or working
 * from another country, sees their institution's day — which is the day their
 * utilisation is measured against. The editor submits the wall-clock fields the
 * person typed and lets the server resolve them, so a browser zone never
 * reaches the database.
 *
 * ── Nothing is written without two deliberate acts ────────────────────────
 * The drawer validates, then a confirmation states exactly what will be
 * created, changed and removed, and only then does anything go to the server.
 * A bulk edit of a day's timesheet is not something to do by accident.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ErrorState,
  Section,
  Skeleton,
  TableSkeleton,
} from "@/app/_components/ui";
import { ConfirmDialog, useToast } from "@/app/_components/interactive";
import { SuccessDialog } from "@/app/_components/AccountDialogs";
import {
  formatDuration,
  type Activity,
  type ActivityTypeOption,
} from "@/app/_components/workload";
import { type Submission } from "@/app/_lib/worklog-types";
import { InstructorSheet, type SheetPeriod } from "@/app/_components/InstructorSheet";
import { WorklogNotices } from "@/app/_components/WorklogNotices";
import { PeriodPicker, type View } from "@/app/_components/PeriodPicker";
import { DailyRoutineBox } from "@/app/_components/DailyRoutineBox";
import { pingNotifications } from "@/app/_components/NotificationBell";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDayAs, formatDayLong, formatDayShort } from "@/app/_lib/format";

/* ── Dates, in the tenant's zone ──────────────────────────────────────────── */

/** Today's calendar date as the university reads it. */
function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* How the page watches a background parse: every four seconds, for at most
 * three minutes. Long enough to cover the provider's slow path — a measured
 * run needed seventy seconds of retries — and bounded so a stranded submission
 * does not leave a tab polling all afternoon. */
const PARSE_POLL_MS = 4_000;
const PARSE_POLLS = 45;

/** Monday of the ISO week containing `iso`, matching the rest of the product. */
/** Where the chosen view is remembered between visits. */
const VIEW_KEY = "tracksheet:instructor:view";

/** First and last day of the calendar month `iso` falls in. */
function monthBounds(iso: string): { from: string; to: string } {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return {
    from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
  };
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return addDays(iso, -(((d.getUTCDay() + 6) % 7)));
}



const longDate = formatDayLong;
const shortDate = formatDayShort;
const monthLabel = (iso: string) => formatDayAs(iso, { month: "long", year: "numeric" });

/* ── Page state ───────────────────────────────────────────────────────────── */

type Context = {
  instructorId: string;
  /** What they teach — Technical, English, Aptitude, Mathematics. */
  broadCategory: { code: string; label: string } | null;
  /** Needed for the monthly sheet, which is addressed by university. */
  universityId: string;
  employeeCode: string | null;
  timezone: string;
  universityName: string;
};

export default function InstructorDashboardPage() {
  const toast = useToast();

  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("day");
  /* Restored after the first paint, never during it: reading storage while
   * rendering would make the server's HTML and the browser's disagree, and
   * React would throw the tree away. `restored` keeps the writer below from
   * saving the default over the real value before it has been read. */
  const [restored, setRestored] = useState(false);

  const [entryOpen, setEntryOpen] = useState(false);
  /* Plain text, one activity per line.
   *
   * This was a list of separate inputs with their own numbering and their own
   * per-line warnings. Writing up a day is writing, not filling in a form: the
   * numbering was the box's idea rather than the instructor's, and a warning
   * under every line they had not finished typing made the box argue with them
   * while they used it. Lines are split out on submit — the API has always
   * taken a list, and it still does. */
  const [routine, setRoutine] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  /* ── Identity and taxonomy, once ───────────────────────────────────────── */

  const loadContext = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.instructorId) {
      /* Almost always the same thing: somebody signed in as a manager or an
       * admin and opened an instructor's page. Naming the account and the role
       * turns a dead end into an instruction — "unable to load" on its own
       * sends people looking for a fault that is not there. */
      throw new Error(
        `You are signed in as ${me.user.email} (${me.user.role.toLowerCase()}), and this page ` +
          `shows one instructor their own work. Sign in with an instructor account to see it.`,
      );
    }

    const [{ instructor }, { activityTypes }] = await Promise.all([
      apiGet<{
        instructor: {
          employeeCode: string | null;
          category: { code: string; label: string } | null;
          university: { id: string; name: string; timezone: string };
        };
      }>(`/api/instructors/${me.user.instructorId}`, "Could not load your profile."),
      apiGet<{ activityTypes: ActivityTypeOption[] }>(
        "/api/activity-types",
        "Could not load activity types.",
      ),
    ]);

    return {
      context: {
        instructorId: me.user.instructorId,
        broadCategory: instructor.category,
        universityId: instructor.university.id,
        employeeCode: instructor.employeeCode,
        timezone: instructor.university.timezone,
        universityName: instructor.university.name,
      } satisfies Context,
      // Derived types are produced by the working-hours engine, not typed by a
      // person, so offering them here would let someone hand-write a record the
      // system is supposed to derive.
      types: activityTypes.filter((t) => !t.isDerivedFromWorkingHours),
    };
  }, []);

  const bootstrap = useLoad(loadContext, "instructor-dashboard-context");
  const context = bootstrap.data?.context ?? null;

  /* ── The view survives a refresh ─────────────────────────────────────────
   * Somebody reading their month and pressing reload was put back on Day, and
   * had to find their way again — the page forgot what they were doing for no
   * reason other than that state lived only in memory.
   *
   * The DATE is deliberately not restored. It is almost always today, and
   * coming back tomorrow to yesterday's date — with a box that refuses to be
   * written because it is not today — is worse than starting where the work is.
   */
  useEffect(() => {
    // Scheduled rather than set here: setting state synchronously inside an
    // effect makes this render cascade into another before the first has been
    // painted, which is what the compiler's purity rule is about.
    const restore = setTimeout(() => {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "day" || saved === "week" || saved === "month") setView(saved);
      setRestored(true);
    }, 0);
    return () => clearTimeout(restore);
  }, []);

  useEffect(() => {
    if (restored) window.localStorage.setItem(VIEW_KEY, view);
  }, [restored, view]);

  const today = context ? todayInZone(context.timezone) : null;
  // Derived during render rather than seeded by an effect: until a day has been
  // chosen, the day IS today, and there is nothing to synchronise.
  const activeDate = selected ?? today;

  /* ── The rows of the sheet ───────────────────────────────────────────────
   * Day is one date, Week is seven, Month is the weeks the month touches. The
   * same table renders all three, so a column cannot mean one thing in a week
   * and something else in a month — and the instructor's own month is not a
   * different report, it is this one with wider rows.
   */
  const sheetPeriods: SheetPeriod[] = useMemo(() => {
    if (!activeDate) return [];

    if (view === "month") {
      const bounds = monthBounds(activeDate);
      const out: SheetPeriod[] = [];
      for (let start = mondayOf(bounds.from), i = 1; start <= bounds.to; start = addDays(start, 7), i++) {
        const dates = Array.from({ length: 7 }, (_, d) => addDays(start, d));
        out.push({
          dates,
          label: `${shortDate(start)} – ${shortDate(addDays(start, 6))}`,
          sublabel: `Week ${i}`,
          isCurrent: Boolean(today && dates.includes(today)),
          // A week is never writable: only today can be written, and that is a
          // day. Offering it here would be offering a refusal.
          writableDate: null,
        });
      }
      return out.reverse();
    }

    const dates =
      view === "day"
        ? [activeDate]
        : Array.from({ length: 7 }, (_, i) => addDays(mondayOf(activeDate), i));

    return dates
      .map((date) => ({
        dates: [date],
        label: formatDayAs(date, { day: "numeric", month: "short" }),
        sublabel: formatDayAs(date, { weekday: "long" }),
        isCurrent: date === today,
        writableDate: date === today ? date : null,
      }))
      .sort((a, b) => b.dates[0]!.localeCompare(a.dates[0]!));
  }, [view, activeDate, today]);


  /* ── The visible week's activities ─────────────────────────────────────── */

  /* The range follows the VIEW, not the week strip: a month view that fetched
   * seven days would render four empty week rows and one real one. */
  const from = sheetPeriods[sheetPeriods.length - 1]?.dates[0] ?? null;
  const to = sheetPeriods[0]?.dates.at(-1) ?? null;

  const loadRange = useCallback(async () => {
    if (!from || !to) return [] as Activity[];
    // Self-scoped by the endpoint: no instructor id is sent, and one could not
    // widen it if it were.
    const res = await apiGet<{ activities: Activity[] }>(
      `/api/activities?from=${from}&to=${to}&limit=200`,
      "Could not load your workload.",
    );
    return res.activities;
  }, [from, to]);

  const workload = useLoad(loadRange, `instructor-range:${from ?? "-"}:${to ?? "-"}`);

  /* The instructor's own note per day. A separate read from the activities,
   * because it is a different KIND of fact: the activities say what happened,
   * this says how it went, and only a person can write it. */
  const loadNotes = useCallback(async () => {
    if (!context || !from || !to) return {} as Record<string, string>;
    const res = await apiGet<{ notes: Record<string, string> }>(
      `/api/instructors/${context.instructorId}/worklog/notes?from=${from}&to=${to}`,
      "Could not load your remarks.",
    );
    return res.notes;
  }, [context, from, to]);
  const dayNotes = useLoad(loadNotes, `instructor-notes:${from ?? "-"}:${to ?? "-"}`);

  const saveNote = async (date: string, note: string) => {
    if (!context) return;
    setSaving(true);
    try {
      await apiSend(
        `/api/instructors/${context.instructorId}/worklog/notes`,
        "PATCH",
        { workDate: date, note },
        "That remark could not be saved.",
      );
      await dayNotes.reload();
    } catch {
      // Reported through the bell, like every other refusal on this page.
      pingNotifications();
    } finally {
      setSaving(false);
    }
  };
  const activities = useMemo(() => workload.data ?? [], [workload.data]);
  const error = bootstrap.error ?? workload.error;
  const loading = bootstrap.loading || workload.loading;

  /** Grouped by the day the UNIVERSITY says each activity falls on. */
  const byDate = useMemo(() => {
    const out: Record<string, Activity[]> = {};
    if (!context) return out;
    for (const a of activities) {
      const date = a.workDate.slice(0, 10);
      (out[date] ??= []).push(a);
    }
    return out;
  }, [activities, context]);

  const selectedActivities = useMemo(
    () => (activeDate ? (byDate[activeDate] ?? []) : []),
    [byDate, activeDate],
  );
  const selectedHours = selectedActivities.reduce((n, a) => n + a.durationHours, 0);

  const todayActivities = today ? (byDate[today] ?? []) : [];
  const todayHours = todayActivities.reduce((n, a) => n + a.durationHours, 0);
  const todayAdded = todayActivities.length > 0;

  /* ── The editor ────────────────────────────────────────────────────────── */

  /* ── The day's submissions, for the review view ─────────────────────────── */

  const loadSubmissions = useCallback(async () => {
    if (!context || !activeDate) return { submissions: [] as Submission[] };
    return apiGet<{ submissions: Submission[] }>(
      `/api/instructors/${context.instructorId}/worklog?date=${activeDate}`,
      "Could not load what you submitted.",
    );
  }, [context, activeDate]);

  const review = useLoad(loadSubmissions, `worklog:${context?.instructorId ?? "-"}:${activeDate ?? "-"}`);

  const submissions = useMemo(() => review.data?.submissions ?? [], [review.data]);

  /* Their own sentences for this day, oldest submission first. Read from the
   * submissions rather than from the rows, because a line the reader could not
   * turn into a row is still something they wrote. */
  const writtenToday = useMemo(
    () => submissions.flatMap((s) => s.rawBullets),
    [submissions],
  );

  /* Blank lines are what pressing Enter twice leaves behind. They are not
   * activities and were never meant to be submitted as empty ones. */
  const routineLines = useMemo(
    () => routine.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
    [routine],
  );

  /* ── Watching a parse finish ────────────────────────────────────────────
   * Parsing runs in the background so that submitting returns at once, which
   * leaves the page holding a status that is already out of date the moment
   * it is drawn. Without this the instructor sees "still reading" until they
   * navigate away and back — the work finished and nobody told the screen.
   *
   * It polls only while something is actually PENDING, and gives up after a
   * few minutes: a submission stranded by a restart will not be resolved by
   * asking about it forever, and the review view offers to re-read it instead.
   */
  const pending = submissions.some((s) => s.status === "PENDING");
  const reloadReview = review.reload;
  const reloadWorkload = workload.reload;
  const wasPending = useRef(false);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    let asked = 0;
    const timer = setInterval(() => {
      if (!live) return;
      if (++asked > PARSE_POLLS) {
        clearInterval(timer);
        return;
      }
      void reloadReview();
    }, PARSE_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pending, activeDate, reloadReview]);

  /* Parsing does not only change the submission — it WRITES the activities, so
   * the day's total, the timeline and the week sheet are all out of date the
   * moment it finishes. Reloading them is tied to the parse settling rather
   * than to the poll, because the rows appear once and re-fetching a week every
   * four seconds to find that out would be the wrong trade. */
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    void reloadWorkload();
  }, [pending, reloadWorkload]);


  /* ── Writing a day ──────────────────────────────────────────────────────── */

  const openEntry = () => {
    // Opening for an edit starts from what is already written, so somebody
    // fixing one line does not retype the other five.
    setRoutine(writtenToday.join("\n"));
    setEntryOpen(true);
  };


  const requestSubmit = () => {
    if (routineLines.length > 0) setConfirming(true);
  };

  const submit = async () => {
    if (!context || !activeDate) return;
    setSaving(true);
    try {
      // Only "there is nothing here" stops a submission on this side now.
      // Everything the reader refuses is reported through the bell.
      // Only "there is nothing here" stops a submission on this side. Anything
      // the reader refuses is reported through the bell.
      if (routineLines.length === 0) return;
      await apiSend(
        `/api/instructors/${context.instructorId}/worklog`,
        "POST",
        { workDate: activeDate, bullets: routineLines },
        "Your worklog could not be submitted.",
      );
      setConfirming(false);
      setEntryOpen(false);
      // Reading happens behind this. The instructor is told their words are
      // saved, which is what just became true, and the sheet fills in when the
      // parse finishes — the page polls for it, so there is nothing to switch
      // to and nothing to come back for.
      await review.reload();
      setSuccess("Your worklog has been submitted. It is being read now.");
    } catch {
      /* Deliberately silent on the page.
       *
       * The server records every refusal as a notification before it answers,
       * so the reason is in the bell — where it survives the drawer closing,
       * the tab being switched, and the instructor coming back an hour later
       * to ask whether their day went in. A red panel here would say the same
       * thing in the one place it cannot be re-read.
       *
       * The bell is asked to look immediately rather than waiting for its
       * poll, so the answer is there by the time somebody reaches for it. */
      pingNotifications();
    } finally {
      setSaving(false);
    }
  };

  /** Correcting what the parser decided. Also records that it was reviewed. */

  const reparse = async (submissionId: string) => {
    if (!context) return;
    setSaving(true);
    try {
      await apiSend(
        `/api/instructors/${context.instructorId}/worklog/${submissionId}/reparse`,
        "POST",
        {},
        "Could not try again just now.",
      );
      toast("success", "Reading your worklog again.");
      await review.reload();
    } catch {
      pingNotifications();
    } finally {
      setSaving(false);
    }
  };

  /** Removing a single activity from its card menu, with its own confirmation. */
  const deleteOne = async () => {
    if (!context || !deleting) return;
    setDeletingBusy(true);
    try {
      await apiSend(
        `/api/instructors/${context.instructorId}/activities/${deleting.id}`,
        "DELETE",
        undefined,
        "That activity could not be removed.",
      );
      await workload.reload();
      setDeleting(null);
      toast("success", "Activity removed.");
    } catch {
      pingNotifications();
    } finally {
      setDeletingBusy(false);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────── */

  if (error && !context) {
    return (
      <div className="space-y-5">
        <ErrorState message="This dashboard is for an instructor" detail={error} />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Where the day gets written ────────────────────────────────────── */}
      {context ? (
        <DailyRoutineBox
          dateLabel={activeDate ? longDate(activeDate) : ""}
          editing={entryOpen}
          routine={routine}
          written={writtenToday}
          hours={todayHours}
          activities={todayActivities.length}
          added={todayAdded}
          busy={saving}
          canWrite={activeDate === today}
          onRoutine={setRoutine}
          onEdit={openEntry}
          onCancel={() => setEntryOpen(false)}
          onSubmit={requestSubmit}
        />
      ) : null}

      {/* ── One control for what you are looking at ──────────────────────── */}
      {activeDate ? (
        <PeriodPicker
          view={view}
          onView={setView}
          selected={activeDate}
          onSelect={setSelected}
          today={today}
        />
      ) : (
        /* A placeholder rather than nothing. `activeDate` is null until the
           instructor's timezone has loaded — the day has to be THEIR day, not
           the browser's — and rendering nothing in the meantime made the
           control look absent rather than pending. */
        <Skeleton className="h-64 w-full rounded-card" />
      )}

      {error && context ? <Alert tone="danger">{error}</Alert> : null}

      {/* ── The views ─────────────────────────────────────────────────────── */}
      {!context || (loading && activities.length === 0) ? (
        <TableSkeleton cols={4} />
      ) : (
        <Section
          title={
            !activeDate
              ? "Your work"
              : view === "day"
                ? longDate(activeDate)
                : view === "week"
                  ? `Week: ${shortDate(mondayOf(activeDate))} – ${shortDate(addDays(mondayOf(activeDate), 6))}`
                  : monthLabel(activeDate)
          }
          description={
            view === "month"
              ? "Week by week, newest first. The rows are the weeks this month touches."
              : view === "day"
              ? `${formatDuration(selectedHours)} · ${selectedActivities.length} ${
                  selectedActivities.length === 1 ? "activity" : "activities"
                }`
              : "Newest day first. The date column and the headings stay put while you scroll."
          }
        >
          {/* Anything the reader could not turn into rows — a parse still
              running, a line with no time — is reported above the sheet rather
              than inside it, because it is about the SUBMISSION and the sheet
              is about what was recorded. */}
          {view === "day" ? (
            <WorklogNotices
              submissions={submissions}
              busy={saving}
              onReparse={reparse}
            />
          ) : null}

          <InstructorSheet
            periods={sheetPeriods}
            activitiesByDate={byDate}
            notes={dayNotes.data ?? {}}
            busy={saving}
            onAdd={() => openEntry()}
            onNote={saveNote}
          />
        </Section>
      )}


      {/* The writing surface is the box at the top of the page now. The panel
          that used to slide in over everything is gone: it covered the sheet
          somebody might want to read while writing, and it made the page&apos;s
          most important action the one you had to go and open. */}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={submit}
        pending={saving}
        title="Submit this worklog?"
        description={`${routineLines.length} ${
          routineLines.length === 1 ? "activity" : "activities"
        } for ${activeDate ? longDate(activeDate) : "this day"}. Your words are saved straight away and read just afterwards.`}
        confirmLabel="Submit workload"
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={deleteOne}
        pending={deletingBusy}
        title="Remove this activity?"
        description={
          deleting
            ? `${deleting.activityType.label} (${formatDuration(deleting.durationHours)}) will be removed from this day. The change is recorded in the audit trail.`
            : ""
        }
        confirmLabel="Remove activity"
        destructive
      />

      <SuccessDialog
        open={success !== null}
        title="Worklog submitted successfully!"
        description={success ?? ""}
        onClose={() => setSuccess(null)}
      />
    </div>
  );
}

/** The Day/Week switch, rendered wherever the current view is titled. */


