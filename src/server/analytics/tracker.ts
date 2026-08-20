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

import { countsAsWorkingHours, DID_NOT_HAPPEN } from "@/domain/working-hours";
import { prisma } from "@/server/db";
import { computeAnalytics, type InstructorBreakdown } from "@/server/analytics/engine";
import { csvCell } from "@/server/reports/generator";
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
  quantity: number;
  hours: number;
  /** Whether a count of this means anything — see `DeliverableType`. */
  countable: boolean;
};

export type TrackerCell = {
  deliverables: TrackerDeliverable[];
  /** Countable deliverable units recorded in this cell. */
  quantity: number;
  /** Hours on entries that name a deliverable. Reporting detail only. */
  deliverableHours: number;
  /** Engine recorded hours. The metric everything else already agrees with. */
  totalWorkingHours: number;
  /** Engine hours per ActivityType code — the Broad Category split. */
  hoursByCategory: Record<string, number>;
  /** Individual remarks, newest last. Never concatenated into one blob. */
  remarks: string[];
};

export type TrackerRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  isActive: boolean;
  /**
   * The instructor's dominant Broad Category across the whole period — the
   * ActivityType code carrying the most recorded hours. The sheet has one
   * category per employee row; this derives it rather than inventing a field.
   * Null when nothing was recorded.
   */
  /* ── Two different "categories", deliberately kept apart ─────────────────
   * `broadCategory` is what this instructor TEACHES — Technical, Mathematics,
   * English — set by an admin and stable across months. It is the column the
   * client's sheet prints, and it must not move when somebody has a quiet week.
   *
   * `category` below is the dominant ACTIVITY category they actually spent the
   * period on, derived from their hours. It answers a different question and
   * legitimately changes month to month, which is exactly why it cannot be the
   * one in the report.
   */
  broadCategory: { code: string; label: string } | null;
  category: string | null;
  /** Every category they touched, so the dominant label never hides the rest. */
  categories: string[];
  cells: Record<number, TrackerCell>;
  totals: {
    quantity: number;
    deliverableHours: number;
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
  weeks: TrackerWeek[];
  rows: TrackerRow[];
  totals: {
    instructors: number;
    formerInstructors: number;
    quantity: number;
    deliverableHours: number;
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

/* ── Build ──────────────────────────────────────────────────────────────── */

const round = (n: number) => Number(n.toFixed(2));

function dominantCategory(hours: Record<string, number>): string | null {
  let best: string | null = null;
  let bestHours = 0;
  for (const [code, h] of Object.entries(hours)) {
    if (h > bestHours) {
      best = code;
      bestHours = h;
    }
  }
  return best;
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
  const head1 = ["Employee Name", "Employee ID", "Broad Category", "Status"];
  const head2 = ["", "", "", ""];

  for (const week of tracker.weeks) {
    const span = `${week.labelFrom ?? week.from} to ${week.labelTo ?? week.to}`;
    /* Four columns a week, exactly the ones the client's own sheet has and the
     * ones the grid renders. "Deliverable Hours" used to sit between quantity
     * and working hours; it was time against a NAMED piece of work, counted or
     * not, which is a fifth different hours figure nobody asked the sheet for —
     * and having it beside Working Hours invited exactly the subtraction the
     * two are not related by. The export and the screen now have the same
     * columns, so a screenshot and a spreadsheet cannot disagree. */
    head1.push(`Week ${week.index} [${span}]`, "", "", "");
    head2.push("Deliverable", "Deliverable Quantity", "Working Hours", "Remarks");
  }

  const lines = [head1.map(csvCell).join(","), head2.map(csvCell).join(",")];

  for (const row of tracker.rows) {
    const cells: Array<string | number | null> = [
      row.instructorName,
      row.employeeCode,
      // What they TEACH, matching the column on screen. The derived activity
      // category used to go here, so the exported sheet and the rendered one
      // disagreed about what "Broad Category" meant.
      row.broadCategory ? `Instructor – ${row.broadCategory.label}` : "",
      row.isActive ? "Active" : "Former",
    ];
    for (const week of tracker.weeks) {
      const cell = row.cells[week.index];
      const deliverables = [...(cell?.deliverables ?? [])].sort((a, b) => b.hours - a.hours);
      cells.push(
        // Same strings the grid shows, so a screenshot and the CSV agree.
        deliverables.map((d) => `${d.title} – ${d.hours}h`).join("; "),
        deliverables
          .filter((d) => d.countable && d.quantity > 0)
          .map((d) => `${d.quantity} ${d.quantity === 1 || d.title.endsWith("s") ? d.title : `${d.title}s`}`)
          .join(", "),
        // Working Hours as the report means it: the time spent with students.
        round(deliverables.reduce((n, d) => n + (d.countable ? d.hours : 0), 0)),
        cell?.remarks.join(", ") ?? "",
      );
    }
    lines.push(cells.map(csvCell).join(","));
  }

  return lines.join("\n");
}

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
  const weeks = labelWeeks(weeksBetween(from, to, today), config);
  const spanFrom = weeks[0]!.from;
  const spanTo = weeks[weeks.length - 1]!.to;

  // The engine is the single source of truth for recorded hours, capacity and
  // utilisation. One call PER WEEK — O(weeks), never O(instructors); each call
  // returns every instructor at once, so there is no per-instructor fan-out.
  // Run concurrently: the weeks are independent.
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

  /* ── Two sources, and only one of them is Working Hours ─────────────────
   * `DeliverableLog` used to be summed into these cells as though it were the
   * same thing as an activity, with a hard-coded `countable: true`. That was
   * wrong twice over. `/instructor/activity-tracker` POSTs an activity AND a
   * deliverable log for one piece of work, so two hours reported four; and a
   * `Deliverable` is a planned item with a free-text category and no
   * `isCountable` at all, so planned course material counted as time in front
   * of students.
   *
   * Removing it outright was wrong too, and the test suite is what said so:
   * hours logged through the deliverables screen alone — progress against a
   * plan, with no accompanying activity — exist in no other table, so they
   * simply vanished from the report. That is the same defect as the twelve and
   * three quarter hours of unclassified teaching, arrived at from the other
   * direction.
   *
   * So both are read, and countability is what separates them. A DeliverableLog
   * contributes to `deliverableHours` — the reporting-detail figure, which is
   * explicitly NOT Working Hours — and is marked not-countable, so it can never
   * reach the student-facing total. The hours stay visible; they stop being
   * counted as something they are not.
   */
  const deliverableLogs = await prisma.deliverableLog.findMany({
    where: {
      universityId: config.id,
      ...(instructorId ? { instructorId } : {}),
      ...("managerId" in args ? { instructor: { managerId: args.managerId } } : {}),
      workDate: { gte: toDateOnly(spanFrom), lte: toDateOnly(spanTo) },
    },
    orderBy: { workDate: "asc" },
    select: {
      instructorId: true,
      workDate: true,
      quantityCompleted: true,
      hoursSpent: true,
      remarks: true,
      deliverable: { select: { title: true } },
    },
  });

  /* ── Where a "deliverable" comes from ─────────────────────────────────────
   * Two things in this product are called a deliverable, and the report has to
   * read BOTH or it under-reports:
   *
   *   DeliverableLog    progress logged against a planned deliverable. The
   *                     older mechanism, still reachable through its own route.
   *   ActivityLog       the deliverable type an entry was classified under,
   *                     with its quantity and its clock duration. This is what
   *                     the daily worklog writes, and therefore where the
   *                     evidence actually is.
   *
   * Reading only the first left every cell of the client's monthly sheet empty,
   * because nothing in the current product writes to it. They are merged by
   * title, so a deliverable recorded both ways counts once.
   */
  const activityDeliverables = await prisma.activityLog.findMany({
    where: {
      universityId: config.id,
      ...("instructorId" in args ? { instructorId: args.instructorId } : {}),
      ...("managerId" in args ? { instructor: { managerId: args.managerId } } : {}),
      workDate: { gte: toDateOnly(spanFrom), lte: toDateOnly(spanTo) },
      /* A class that was MISSED, or a day EXCUSED as leave, is not time spent
       * with students — the engine has always excluded both from its own
       * totals, and a sheet that counts them puts an instructor in a room they
       * were never in. LATE stays: it happened, just not on time. */
      status: { notIn: [...DID_NOT_HAPPEN] },
      /* No `deliverableTypeId: { not: null }` here, deliberately.
       *
       * It used to be, and it silently emptied the report of real teaching.
       * Countability falls back to the CATEGORY when an entry carries no
       * deliverable — a lecture is time with students whether or not the
       * parser managed to name one — but the fallback cannot fire for a row
       * this query never returns. On the dev data that was three lectures and
       * twelve and three quarter hours missing from the client's own sheet,
       * with nothing on screen to suggest anything was absent.
       *
       * Everything comes back now, and `countsAsWorkingHours` below decides.
       * `deliverableHours` still only counts entries that HAVE a deliverable —
       * that figure means "time attached to a named piece of work", and it
       * would stop meaning that if unnamed hours were added to it. */
    },
    orderBy: { workDate: "asc" },
    select: {
      instructorId: true,
      workDate: true,
      quantity: true,
      startTime: true,
      endTime: true,
      remarks: true,
      activityType: { select: { code: true, label: true } },
      deliverableType: { select: { label: true, isCountable: true } },
    },
  });

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
        broadCategory: null,
        category: null,
        categories: [],
        cells: {},
        totals: {
          quantity: 0,
          deliverableHours: 0,
          totalWorkingHours: 0,
          capacityHours: 0,
          utilizationPct: null,
        },
      };
      rows.set(b.instructorId, row);
    }
    return row;
  };

  const categoryHours: Map<string, Record<string, number>> = new Map();

  weeks.forEach((week, i) => {
    for (const b of weekly[i]!.instructors) {
      const row = ensureRow(b);
      const cell = (row.cells[week.index] ??= {
        deliverables: [],
        quantity: 0,
        deliverableHours: 0,
        totalWorkingHours: 0,
        hoursByCategory: {},
        remarks: [],
      });
      cell.totalWorkingHours = b.productiveHours;
      cell.hoursByCategory = b.hoursByActivityType;

      row.totals.totalWorkingHours = round(row.totals.totalWorkingHours + b.productiveHours);
      row.totals.capacityHours = round(row.totals.capacityHours + b.capacityHours);

      const agg = categoryHours.get(b.instructorId) ?? {};
      for (const [code, h] of Object.entries(b.hoursByActivityType)) {
        agg[code] = round((agg[code] ?? 0) + h);
      }
      categoryHours.set(b.instructorId, agg);
    }
  });

  for (const log of deliverableLogs) {
    const workDate = log.workDate.toISOString().slice(0, 10);
    const week = weeks.find((w) => workDate >= w.from && workDate <= w.to);
    const row = rows.get(log.instructorId);
    if (!week || !row) continue;

    const cell = (row.cells[week.index] ??= {
      deliverables: [],
      quantity: 0,
      deliverableHours: 0,
      totalWorkingHours: 0,
      hoursByCategory: {},
      remarks: [],
    });

    /* `countable: false`, always. A planned deliverable carries no
     * `isCountable` to consult, and the honest reading of an unknown is "not
     * time with students" — the figure this protects is the one the client
     * reads. The hours are still reported, on their own muted line. */
    let entry = cell.deliverables.find((d) => d.title === log.deliverable.title && !d.countable);
    if (!entry) {
      entry = { title: log.deliverable.title, quantity: 0, hours: 0, countable: false };
      cell.deliverables.push(entry);
    }
    entry.quantity += log.quantityCompleted;
    entry.hours = round(entry.hours + log.hoursSpent);

    cell.deliverableHours = round(cell.deliverableHours + log.hoursSpent);
    row.totals.deliverableHours = round(row.totals.deliverableHours + log.hoursSpent);

    const remark = log.remarks?.trim();
    if (remark && !cell.remarks.includes(remark)) cell.remarks.push(remark);
  }

  for (const log of activityDeliverables) {
    const workDate = log.workDate.toISOString().slice(0, 10);
    const week = weeks.find((w) => workDate >= w.from && workDate <= w.to);
    const row = rows.get(log.instructorId);
    // No `!log.deliverableType` gate either: that was the same exclusion a
    // second time, and it would have kept the query fix from doing anything.
    if (!week || !row) continue;

    const cell = (row.cells[week.index] ??= {
      deliverables: [],
      quantity: 0,
      deliverableHours: 0,
      totalWorkingHours: 0,
      hoursByCategory: {},
      remarks: [],
    });

    // Hours from the clock range, never a stored duration: the same rule the
    // rest of the product follows, so a report can never disagree with the row.
    const hours = round((log.endTime.getTime() - log.startTime.getTime()) / 3_600_000);

    /* ── Grouped by CATEGORY, not by the deliverable underneath it ──────────
     * The client's sheet reads "Live Classes – 24h; Lesson Prep – 8h; Doubt
     * Sessions – 6h; Meetings/Reports – 4h": about five lines a week, at the
     * level of Lecture, Content Development, Student Support, Meeting. Grouping
     * by the forty-four specific deliverables produced fifteen lines of finer
     * detail than the report is written in — "Meetings/Reports" is a category,
     * not a deliverable.
     *
     * Countability still comes from the DELIVERABLE, because that is where the
     * distinction lives: an Exam category line counts its evaluations and not
     * its question-paper preparation — which is why countability is part of
     * what makes a line here, not a flag set on one afterwards. A category
     * holding both kinds becomes two entries, the counted one and the muted
     * one.
     *
     * As a flag it was wrong: every activity in the category piled its hours
     * onto a single entry, and one countable deliverable anywhere in it turned
     * the whole entry — preparation included — into Working Hours. The error
     * grew with the size of the group, so the same entries totalled differently
     * by day, by week and by month. Splitting the entry keeps each hour with
     * its own deliverable's answer.
     */
    const title = log.activityType.label;
    const countable = countsAsWorkingHours(
      log.activityType.code,
      log.deliverableType ? log.deliverableType.isCountable : null,
    );

    let entry = cell.deliverables.find((d) => d.title === title && d.countable === countable);
    if (!entry) {
      entry = { title, quantity: 0, hours: 0, countable };
      cell.deliverables.push(entry);
    }
    entry.hours = round(entry.hours + hours);

    /* Quantity counts ONLY what a count means something for, at every level.
     * The per-entry figure already did; the cell and row totals did not, so the
     * "Qty" beside a cell could disagree with the named quantities inside it. */
    if (countable) {
      entry.quantity += log.quantity;
      cell.quantity += log.quantity;
    }

    /* Deliverable hours is time against a NAMED piece of work, so an entry with
     * no deliverable contributes none of it — while still counting toward
     * Working Hours above, via its category. The two figures answer different
     * questions and the report says so. */
    if (log.deliverableType) {
      cell.deliverableHours = round(cell.deliverableHours + hours);
    }
    // De-duplicated: four lectures on the same topic would otherwise print the
    // same remark four times in one cell.
    const remark = log.remarks?.trim();
    if (remark && !cell.remarks.includes(remark)) cell.remarks.push(remark);

    if (countable) row.totals.quantity += log.quantity;
    if (log.deliverableType) {
      row.totals.deliverableHours = round(row.totals.deliverableHours + hours);
    }
  }

  /* ── What each instructor teaches ─────────────────────────────────────────
   * Read once for the whole grid rather than joined onto every row: it is a
   * property of the person, so it does not vary by week and does not belong in
   * the per-week engine pass.
   */
  const categories = await prisma.instructor.findMany({
    where: { id: { in: [...rows.keys()] } },
    select: { id: true, category: { select: { code: true, label: true } } },
  });
  for (const instructor of categories) {
    const row = rows.get(instructor.id);
    if (row) row.broadCategory = instructor.category ?? null;
  }

  // Former staff appear only where they actually have something to report.
  // Active staff always appear, so "recorded nothing this week" stays visible.
  const hasData = (row: TrackerRow) =>
    row.totals.totalWorkingHours > 0 ||
    row.totals.quantity > 0 ||
    row.totals.deliverableHours > 0;

  const visible = [...rows.values()].filter((row) => row.isActive || hasData(row));

  for (const row of visible) {
    const agg = categoryHours.get(row.instructorId) ?? {};
    row.category = dominantCategory(agg);
    row.categories = Object.keys(agg).sort((a, b) => (agg[b] ?? 0) - (agg[a] ?? 0));
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
    weeks,
    rows: visible,
    totals: {
      instructors: visible.length,
      formerInstructors: visible.filter((r) => !r.isActive).length,
      quantity: visible.reduce((s, r) => s + r.totals.quantity, 0),
      deliverableHours: round(visible.reduce((s, r) => s + r.totals.deliverableHours, 0)),
      totalWorkingHours,
      capacityHours,
      utilizationPct: capacityHours > 0 ? round((totalWorkingHours / capacityHours) * 100) : null,
    },
  };
}
