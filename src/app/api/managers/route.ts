import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { narrowManagerRow, narrowUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import {
  bandFor,
  currentWeekFor,
  instructorPerformance,
  previousWeek,
  rosterTotals,
  type PeriodBounds,
} from "@/server/analytics/roster";
import { UTILIZATION_BANDS } from "@/server/analytics/bands";


/**
 * Every manager the caller may see, with their own roster's performance.
 *
 * ── The N+1 this replaces ──────────────────────────────────────────────────
 * The admin managers page used to load every university, then request that
 * university's managers one request at a time, and each of those ran the
 * analytics engine once PER MANAGER. Cost was universities × managers engine
 * calls, paid on every page load.
 *
 * Here the work is: one manager query, one instructor query, and ONE engine
 * call per university per period — the engine already returns a per-instructor
 * breakdown, so managers are formed by grouping that result rather than by
 * asking again. Adding a manager to a university now costs nothing.
 *
 * Trend is real or absent. It compares this period against the one before it,
 * and reports `null` when the previous period has no capacity to compare
 * against — an invented trend is worse than no trend.
 */

const SORTS = {
  utilization: (a: Row, b: Row) => (b.recordedHoursPct ?? -1) - (a.recordedHoursPct ?? -1),
  workingHours: (a: Row, b: Row) => b.workingHours - a.workingHours,
  instructors: (a: Row, b: Row) => b.instructorCount - a.instructorCount,
  name: (a: Row, b: Row) => a.name.localeCompare(b.name),
} as const;

type SortKey = keyof typeof SORTS;

type Row = {
  id: string;
  name: string;
  email: string;
  employeeCode: string | null;
  isActive: boolean;
  isPrimary: boolean;
  universityId: string;
  universityName: string;
  universityCode: string;
  instructorCount: number;
  workingHours: number;
  recordedHours: number;
  capacityHours: number;
  recordedHoursPct: number | null;
  band: ReturnType<typeof bandFor>;
  /** Percentage-point change against the previous period. Null when unknowable. */
  trendPct: number | null;
};

export const GET = withAuth(async ({ scope, req }) => {
  const sp = req.nextUrl.searchParams;

  const sortParam = (sp.get("sort") ?? "utilization") as SortKey;
  /* `hasOwnProperty`, not `in`.
   *
   * `in` walks the prototype chain, so `?sort=__proto__`, `?sort=toString` and
   * `?sort=constructor` all passed this check. `SORTS[sortParam]` then handed
   * back something that is not a comparator, and `rows.sort()` threw — a 500
   * where the whole point of this guard is a 400. */
  if (!Object.prototype.hasOwnProperty.call(SORTS, sortParam)) {
    throw new ApiError(400, "INVALID_SORT", `sort must be one of ${Object.keys(SORTS).join(", ")}`);
  }
  const order = sp.get("order") === "asc" ? "asc" : "desc";
  const search = sp.get("search")?.trim().toLowerCase();
  const status = sp.get("status");
  if (status && !["active", "inactive", "all"].includes(status)) {
    throw new ApiError(400, "INVALID_STATUS", "status must be active, inactive or all");
  }
  const needsAttention = sp.get("needsAttention") === "true";

  // The whole tenant decision. An admin may narrow to one university; a manager
  // is pinned to their own and cannot widen.
  const tenantWhere = narrowUniversity(scope, sp.get("universityId"));

  const managers = await prisma.manager.findMany({
    where: {
      ...tenantWhere,
      // The roster boundary applies to this list as well. Narrowing by
      // university alone returned every manager in a caller's university, and
      // with `includeInstructors` it returned those managers' rosters too —
      // the one thing the manager relation exists to keep apart.
      ...narrowManagerRow(scope, sp.get("managerId")),
      ...(status === "active" ? { user: { isActive: true } } : {}),
      ...(status === "inactive" ? { user: { isActive: false } } : {}),
    },
    select: {
      id: true,
      employeeCode: true,
      universityId: true,
      user: { select: { name: true, email: true, isActive: true } },
      university: { select: { id: true, name: true, code: true, primaryManagerId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (managers.length === 0) {
    return NextResponse.json({ managers: [], universities: [], period: null });
  }

  // One instructor query for every roster in scope, rather than one per manager.
  const instructors = await prisma.instructor.findMany({
    where: { ...tenantWhere, managerId: { in: managers.map((m) => m.id) } },
    select: { id: true, managerId: true },
  });
  const managerNameById = new Map(managers.map((m) => [m.id, m.user.name]));
  const managerOf = new Map(
    instructors
      .filter((i) => i.managerId)
      .map((i) => [
        i.id,
        { id: i.managerId!, name: managerNameById.get(i.managerId!) ?? "" },
      ]),
  );

  const universities = [
    ...new Map(managers.map((m) => [m.universityId, m.university])).values(),
  ].map((u) => ({ id: u.id, name: u.name, code: u.code }));

  // "This week" is timezone-dependent, so it is resolved per university.
  const periodFor = new Map<string, PeriodBounds>();
  await Promise.all(
    universities.map(async (u) => periodFor.set(u.id, await currentWeekFor(u.id))),
  );
  const previousFor = new Map(
    [...periodFor.entries()].map(([id, p]) => [id, previousWeek(p)]),
  );

  const [current, prior] = await Promise.all([
    instructorPerformance({ universities, managerOf, periodFor }),
    instructorPerformance({ universities, managerOf, periodFor: previousFor }),
  ]);

  function groupByManager(rows: typeof current) {
    const out = new Map<string, typeof current>();
    for (const row of rows) {
      if (!row.managerId) continue;
      const bucket = out.get(row.managerId);
      if (bucket) bucket.push(row);
      else out.set(row.managerId, [row]);
    }
    return out;
  }

  const byManager = groupByManager(current);
  const priorByManager = groupByManager(prior);

  let rows: Row[] = managers.map((m) => {
    const totals = rosterTotals(byManager.get(m.id) ?? []);
    const before = rosterTotals(priorByManager.get(m.id) ?? []);
    return {
      id: m.id,
      name: m.user.name,
      email: m.user.email,
      employeeCode: m.employeeCode,
      isActive: m.user.isActive,
      isPrimary: m.university.primaryManagerId === m.id,
      universityId: m.universityId,
      universityName: m.university.name,
      universityCode: m.university.code,
      ...totals,
      band: bandFor(totals.recordedHoursPct),
      // Null rather than zero when there is nothing to compare against, so the
      // UI can say "no previous-period data" instead of implying "flat".
      trendPct:
        totals.recordedHoursPct === null || before.recordedHoursPct === null
          ? null
          : totals.recordedHoursPct - before.recordedHoursPct,
    };
  });

  if (search) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(search) ||
        r.email.toLowerCase().includes(search) ||
        (r.employeeCode ?? "").toLowerCase().includes(search) ||
        r.universityName.toLowerCase().includes(search),
    );
  }

  if (needsAttention) {
    // Managers whose roster is genuinely below the documented band. Rosters with
    // no measurable capacity are excluded: "unknown" is not "failing".
    rows = rows.filter((r) => r.band === "attention");
  }

  rows.sort(SORTS[sortParam]);
  // "Needs attention" is a worst-first view; every other sort defaults to best
  // first, which `SORTS` already produces.
  if (order === "asc" || needsAttention) rows.reverse();

  // The per-instructor rows are already computed above — the managers list is
  // built by grouping them. Returning them on request costs one flag rather
  // than a second endpoint running the same engine pass again.
  const includeInstructors = sp.get("includeInstructors") === "true";
  const inScope = new Set(managers.map((m) => m.id));
  const instructorRows = includeInstructors
    ? current
        // Exactly the rows the manager list above was grouped from. The engine
        // pass covers a whole university, so without this a caller receives
        // people who are on no roster of theirs — for a manager, that is a
        // peer's roster; for an admin, instructors nobody in the filtered list
        // manages. Either way it is not what this flag claims to return.
        .filter((i) => i.managerId && inScope.has(i.managerId))
        .filter((i) => i.isActive)
        .map((i) => {
          const before = prior.find((p) => p.instructorId === i.instructorId);
          return {
            ...i,
            trendPct:
              i.recordedHoursPct === null || before?.recordedHoursPct == null
                ? null
                : i.recordedHoursPct - before.recordedHoursPct,
          };
        })
        // Worst first: this list exists to be acted on, and an unmeasurable
        // roster is not a failing one, so it sorts last rather than first.
        .sort((a, b) => (a.recordedHoursPct ?? 999) - (b.recordedHoursPct ?? 999))
    : undefined;

  return NextResponse.json({
    managers: rows,
    ...(instructorRows ? { instructors: instructorRows } : {}),
    universities,
    period: periodFor.get(universities[0]!.id) ?? null,
    bands: UTILIZATION_BANDS,
  });
}, { roles: ["ADMIN", "MANAGER"] });
