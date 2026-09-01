/**
 * The weekly workload tracker — the sheet this product replaces.
 *
 * The client's process is a spreadsheet: employee identity on the left, then a
 * repeating block per week running right across the page. This module produces
 * that shape from data that already exists, so the screen a manager already
 * knows how to read is the screen this renders.
 *
 * ── TWO hour figures, never one ────────────────────────────────────────────
 * `deliverableHours` is time recorded against a NAMED deliverable — an entry
 * whose `deliverableTypeId` is set. `totalWorkingHours` is what the analytics
 * engine reports as recorded time for the same instructor and window.
 *
 * They are DIFFERENT questions and they are deliberately never added, merged,
 * or reconciled: an instructor can record 40 hours of work while only 12 of
 * them name a deliverable. Utilisation, capacity, missing data and every other
 * business metric continue to come from the engine alone — deliverable hours
 * are reporting detail and must never feed a metric.
 *
 * Neither is Working Hours, which is a third figure again: the hours the
 * client's sheet counts, decided per entry by `countsAsWorkingHours`.
 *
 * ── One source of truth ────────────────────────────────────────────────────
 * Nothing here recomputes workload maths. `totalWorkingHours` and the category
 * split are read straight off `computeAnalytics`, so this report cannot drift
 * from the instructor, manager and admin dashboards that read the same engine.
 *
 * ── Former staff ───────────────────────────────────────────────────────────
 * A report for August must include someone who left in September. The engine
 * is asked with `includeInactive: true`, and inactive instructors are then kept
 * only where they actually have data in the window — so history is complete
 * without deactivated staff cluttering a current-week view they had no part in.
 */

import {
  remarksCell,
  suppliedOr,
  workingHours as workingHoursCell,
} from "@/domain/worklog-report";
import { prisma } from "@/server/db";
import { computeAnalytics, type InstructorBreakdown } from "@/server/analytics/engine";
import { csvCell } from "@/server/reports/generator";
import { cellState, cellText } from "@/domain/tracker-cell";
import type { UniversityConfig } from "@/server/universities/config";
import { computeDayWindows } from "@/server/time/schedule-windows";
import { toDateOnly } from "@/server/time/workday";

export type TrackerWeek = {
  /** 1-based, as the sheet numbers them. */
  index: number;
  /** ISO Monday — the real query bound. */
  from: string;
  /** ISO Sunday — the real query bound. */
  to: string;
  /** First working day in the bucket, for display. Null if none are working. */
  labelFrom: string | null;
  /** Last working day in the bucket, for display. */
  labelTo: string | null;
  /** True when this bucket contains today, in the UNIVERSITY's timezone. */
  isCurrent: boolean;
};

export type TrackerDeliverable = {
  title: string;
  /** `null` when the instructor never said how many. The client's `?`. */
  quantity: number | null;
  hours: number;
  /** Whether a count of this means anything — see `DeliverableType`. */
  countable: boolean;
  /* Exact minutes, alongside the rounded hours.
   *
   * `hours` is what the grid's numeric columns and every existing consumer
   * read; `minutes` is what the client's "1h 45m" is written from. Two fields
   * rather than one because rounding hours to two places and multiplying back
   * loses up to half a minute an entry, and the Deliverable cell is the column
   * somebody reconciles against a timetable. */
  minutes: number;
  /** When the earliest of these started. Absent for planned-deliverable work. */
  firstAt?: number;
};

export type TrackerCell = {
  /**
   * How many days in this week carry a worklog row.
   *
   * The figure that tells "filed nothing" from "filed zero hours" — the two
   * empty states a manager acts on differently. See `cellState`.
   */
  daysLogged: number;
  /** Recorded hours for the week. Zero is a figure, not an absence. */
  totalWorkingHours: number;
  /** Individual remarks, newest last. Never concatenated into one blob. */
  remarks: string[];
};

export type TrackerRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  isActive: boolean;
  /* `category` and `categories` are gone. They were the ActivityType carrying
     the most hours, and every type the period touched — a classification of
     somebody's work into a fixed list, derived rather than stored but a
     classification all the same. */
  cells: Record<number, TrackerCell>;
  totals: {
    daysLogged: number;
    totalWorkingHours: number;
    capacityHours: number;
    utilizationPct: number | null;
  };
};

export type TrackerResult = {
  universityId: string;
  universityName: string;
  timezone: string;
  from: string;
  to: string;
  /* Today in the UNIVERSITY's zone. Carried on the result rather than read from
     a clock at render time, so the grid and the CSV agree about which weeks are
     still ahead — a cell that is blank on screen and dashed in the export is
     the disagreement this prevents. */
  today: string;
  weeks: TrackerWeek[];
  rows: TrackerRow[];
  totals: {
    instructors: number;
    formerInstructors: number;
    /** Instructor-days carrying a worklog across the whole grid. */
    daysLogged: number;
    totalWorkingHours: number;
    capacityHours: number;
    utilizationPct: number | null;
  };
};

/* ── Week construction ──────────────────────────────────────────────────── */

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `iso`. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun … 6=Sat
  return addDays(iso, -offset);
}

/**
 * Every ISO week OVERLAPPING the span, not merely those fully inside it.
 *
 * A month almost never starts on a Monday, so a "weeks in May" list that
 * dropped the partial first week would silently hide work logged on the 1st.
 */
export function weeksBetween(from: string, to: string, today: string): TrackerWeek[] {
  const weeks: TrackerWeek[] = [];
  let cursor = mondayOf(from);
  let index = 1;
  while (cursor <= to) {
    const end = addDays(cursor, 6);
    weeks.push({
      index,
      from: cursor,
      to: end,
      labelFrom: null,
      labelTo: null,
      isCurrent: today >= cursor && today <= end,
    });
    cursor = addDays(cursor, 7);
    index += 1;
  }
  return weeks;
}

/** Narrows each week's label to the tenant's own working days. */
function labelWeeks(weeks: TrackerWeek[], config: UniversityConfig): TrackerWeek[] {
  return weeks.map((week) => {
    const working: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(week.from, i);
      if (computeDayWindows(config, date).isWorkingDay) working.push(date);
    }
    return {
      ...week,
      labelFrom: working[0] ?? null,
      labelTo: working[working.length - 1] ?? null,
    };
  });
}

/** Calendar bounds of a `YYYY-MM`, as ISO dates. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}


/**
 * The tracker as CSV, in the client's own week-block layout.
 *
 * Identity columns first, then a repeating four-column block per week — the
 * shape of the sheet this replaces, so an export drops straight into the
 * process people already run. Both hour figures are their own column and are
 * never summed, exactly as on screen.
 *
 * Escaping is delegated to `csvCell`, the same function the workload report
 * uses, so formula-injection neutralisation and RFC-4180 quoting cannot drift
 * between the two exports.
 */
export function formatTrackerAsCsv(tracker: TrackerResult): string {
  const head1 = ["Employee Name", "Employee ID", "Status"];
  const head2 = ["", "", ""];

  for (const week of tracker.weeks) {
    const span = `${week.labelFrom ?? week.from} to ${week.labelTo ?? week.to}`;
    /* Four columns a week, exactly the ones the client's own sheet has and the
     * ones the grid renders. "Deliverable Hours" used to sit between quantity
     * and working hours; it was time against a NAMED piece of work, counted or
     * not, which is a fifth different hours figure nobody asked the sheet for —
     * and having it beside Working Hours invited exactly the subtraction the
     * two are not related by. The export and the screen now have the same
     * columns, so a screenshot and a spreadsheet cannot disagree. */
    head1.push(`Week ${week.index} [${span}]`, "", "", "", "");
    head2.push("Broad Category", "Deliverable", "Deliverable Quantity", "Working Hours", "Remarks");
  }

  const lines = [head1.map(csvCell).join(","), head2.map(csvCell).join(",")];

  for (const row of tracker.rows) {
    const cells: Array<string | number | null> = [
      // Preserved exactly, or said to be missing. Never blank, never guessed.
      suppliedOr(row.instructorName),
      suppliedOr(row.employeeCode),
      row.isActive ? "Active" : "Former",
    ];
    for (const week of tracker.weeks) {
      const cell = row.cells[week.index];
      /* The three empty states, decided once and used by both surfaces. A
         screenshot and a spreadsheet disagreeing about an empty cell is exactly
         what one shared function prevents — see `cellState`. */
      const state = cellState({
        weekStart: week.from,
        today: tracker.today,
        daysLogged: cell?.daysLogged ?? 0,
        totalMinutes: Math.round((cell?.totalWorkingHours ?? 0) * 60),
      });
      cells.push(
        // "05h 15m" — the client specified the format to the character.
        cellText(state, workingHoursCell(Math.round((cell?.totalWorkingHours ?? 0) * 60))),
        state === "future" ? "" : (cell?.daysLogged ?? 0),
        remarksCell(cell?.remarks ?? []),
      );
    }
    lines.push(cells.map(csvCell).join(","));
  }

  return lines.join("\n");
}

const round = (n: number) => Number(n.toFixed(2));

export async function buildTracker(args: {
  config: UniversityConfig;
  from: string;
  to: string;
  today: string;
  /** Present for a self-scoped caller; restricts the grid to one person. */
  instructorId?: string;
  /**
   * Restrict the grid to one manager's roster. `undefined` = the whole
   * university; `null` = instructors with no manager yet. Passed straight
   * through to the engine, which owns the instructor selection — the tracker
   * does not re-implement it.
   */
  managerId?: string | null;
}): Promise<TrackerResult> {
  const { config, from, to, today, instructorId } = args;
  /* Two queries are gone with the model they read.
   *
   * `DeliverableLog` fed planned-deliverable progress into these cells, and a
   * second `ActivityLog` pass fed the named deliverables and their categories.
   * Both existed to fill columns that no longer exist; what a cell holds now
   * comes from the one `WorklogEntry` query below. */
  const weeks = labelWeeks(weeksBetween(from, to, today), config);
  const spanFrom = weeks[0]!.from;
  const spanTo = weeks[weeks.length - 1]!.to;

  // The engine is the single source of truth for capacity and utilisation. One
  // call PER WEEK — O(weeks), never O(instructors); each returns every
  // instructor at once. Run concurrently: the weeks are independent.
  const weekly = await Promise.all(
    weeks.map((week) =>
      computeAnalytics({
        universityId: config.id,
        from: week.from,
        to: week.to,
        instructorId,
        includeInactive: true,
        ...("managerId" in args ? { managerId: args.managerId } : {}),
      }),
    ),
  );

  // Seed rows from the engine so an instructor with capacity but no deliverable
  // still appears — "logged nothing" is a reportable state, not an absent row.
  const rows = new Map<string, TrackerRow>();
  const ensureRow = (b: InstructorBreakdown): TrackerRow => {
    let row = rows.get(b.instructorId);
    if (!row) {
      row = {
        instructorId: b.instructorId,
        instructorName: b.instructorName,
        employeeCode: b.employeeCode,
        isActive: b.isActive,
        cells: {},
        totals: {
          daysLogged: 0,
          totalWorkingHours: 0,
          capacityHours: 0,
          utilizationPct: null,
        },
      };
      rows.set(b.instructorId, row);
    }
    return row;
  };

  weeks.forEach((week, i) => {
    for (const b of weekly[i]!.instructors) {
      const row = ensureRow(b);
      /* Seeded from the engine so an instructor with capacity and no worklog
         still gets a cell — "filed nothing" is a reportable state and needs
         somewhere to be reported. */
      row.cells[week.index] ??= { daysLogged: 0, totalWorkingHours: 0, remarks: [] };
      row.totals.capacityHours = round(row.totals.capacityHours + b.capacityHours);
    }
  });

  /* ── The cells themselves, from WorklogEntry ────────────────────────────
   * One query for the whole span rather than one per week: the rows carry their
   * own date and the buckets are arithmetic over it.
   *
   * A cell now holds three things — how many days carry a worklog, the hours
   * across them, and the remarks. It used to hold a list of named deliverables
   * with counts and units, an hours-by-category map and the subjects the week
   * touched, every one of which needed the taxonomy to exist.
   *
   * `daysLogged` is not decoration. It is what tells "filed nothing" from
   * "filed zero hours" — opposite facts about whether somebody did their
   * paperwork, which one hours figure cannot distinguish. See `cellState`. */
  const entries = await prisma.worklogEntry.findMany({
    where: {
      universityId: config.id,
      logDate: { gte: toDateOnly(spanFrom), lte: toDateOnly(spanTo) },
      ...(instructorId ? { instructorId } : {}),
    },
    select: { instructorId: true, logDate: true, workingHours: true, remarks: true },
  });

  for (const entry of entries) {
    const date = entry.logDate.toISOString().slice(0, 10);
    const week = weeks.find((w) => date >= w.from && date <= w.to);
    const row = rows.get(entry.instructorId);
    /* A row the engine did not produce is somebody outside this grid's scope —
       another manager's roster, or excluded by the caller. Their worklog is not
       this sheet's to show. */
    if (!week || !row) continue;

    const cell = (row.cells[week.index] ??= {
      daysLogged: 0,
      totalWorkingHours: 0,
      remarks: [],
    });

    // One row IS one instructor-day: `(instructorId, logDate)` is unique.
    cell.daysLogged += 1;
    row.totals.daysLogged += 1;

    const hours = Number(entry.workingHours);
    cell.totalWorkingHours = round(cell.totalWorkingHours + hours);
    row.totals.totalWorkingHours = round(row.totals.totalWorkingHours + hours);

    // De-duplicated: two days on one topic would print the same remark twice.
    const remark = entry.remarks?.trim();
    if (remark && !cell.remarks.includes(remark)) cell.remarks.push(remark);
  }

  // Former staff appear only where they actually have something to report.
  // Active staff always appear, so "recorded nothing this week" stays visible.
  const hasData = (row: TrackerRow) => row.totals.daysLogged > 0;

  const visible = [...rows.values()].filter((row) => row.isActive || hasData(row));

  for (const row of visible) {
    row.totals.utilizationPct =
      row.totals.capacityHours > 0
        ? round((row.totals.totalWorkingHours / row.totals.capacityHours) * 100)
        : null;
  }


  visible.sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      a.instructorName.localeCompare(b.instructorName),
  );

  const capacityHours = round(visible.reduce((s, r) => s + r.totals.capacityHours, 0));
  const totalWorkingHours = round(visible.reduce((s, r) => s + r.totals.totalWorkingHours, 0));

  return {
    universityId: config.id,
    universityName: config.name,
    timezone: config.timezone,
    from: spanFrom,
    to: spanTo,
    today,
    weeks,
    rows: visible,
    totals: {
      instructors: visible.length,
      formerInstructors: visible.filter((r) => !r.isActive).length,
      daysLogged: visible.reduce((n, r) => n + r.totals.daysLogged, 0),
      totalWorkingHours,
      capacityHours,
      utilizationPct: capacityHours > 0 ? round((totalWorkingHours / capacityHours) * 100) : null,
    },
  };
}
