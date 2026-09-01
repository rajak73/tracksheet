import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { toDateOnly } from "@/server/time/workday";
import { DID_NOT_HAPPEN } from "@/domain/working-hours";

/**
 * Everything the admin dashboard prints, in one response.
 *
 * ── Why one route and not four ────────────────────────────────────────────
 * The screen shows a head count, today's submissions, what is outstanding, a
 * month of hours, a daily curve against last month's, the latest activity and
 * a list of who has not filed. Every one of those is a different reading of
 * the same two facts — who is active, and what they recorded — and served from
 * four endpoints they would eventually disagree, because each would be
 * answering as of its own moment with its own idea of which people count.
 *
 * ── Why it is not `/api/admin/network` ────────────────────────────────────
 * That route answers per UNIVERSITY: how many of each campus recorded, how
 * many hours, which campuses are silent. It cannot name a person, and naming
 * people is what this screen is for. The two agree because they take the same
 * population — active users only — and the same exclusion of MISSED and
 * EXCUSED.
 *
 * ── Hours here are every recorded minute ──────────────────────────────────
 * Which is what Working Hours means now: the client defines an instructor's
 * working time as what they wrote down. See `countsAsWorkingHours`. No
 * countability filter is applied, deliberately — applying one would make this
 * figure quietly smaller than the same figure everywhere else.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (iso: string) => {
  const at = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === iso;
};

/** First and last day of the calendar month a date falls in. */
function monthBounds(iso: string): { from: string; to: string } {
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${iso.slice(0, 7)}-01`, to: `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

function previousMonthOf(iso: string): string {
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

const round = (n: number) => Math.round(n * 100) / 100;

export const GET = withAuth(
  async ({ req }) => {
    /* The date the screen is asking about. Supplied by the client rather than
     * taken from the server clock: an admin spans several timezones and there
     * is no single "today" here — the page sends the one it is displaying. */
    const date = req.nextUrl.searchParams.get("date") ?? "";
    if (!DAY.test(date) || !isRealDate(date)) {
      return NextResponse.json(
        { error: { code: "BAD_DATE", message: "Provide `date` as YYYY-MM-DD." } },
        { status: 400 },
      );
    }

    const thisMonth = monthBounds(date);
    const lastMonth = monthBounds(previousMonthOf(date));
    const notHappened = [...DID_NOT_HAPPEN];

    type DayCount = { workDate: Date; people: bigint };
    type Person = {
      instructorId: string;
      name: string;
      employeeCode: string | null;
      universityName: string;
      lastRecordedOn: Date | null;
    };
    type Recent = {
      id: string;
      name: string;
      employeeCode: string | null;
      createdAt: Date;
      workDate: Date;
      label: string;
    };
    type Hours = { hours: number | null };

    const [employees, instructors, byDay, byDayLast, people, recent, monthHours, lastHours] =
      await Promise.all([
        // Everybody with an account that still works, both roles.
        prisma.user.count({ where: { isActive: true, role: { in: ["MANAGER", "INSTRUCTOR"] } } }),
        prisma.instructor.count({ where: { user: { isActive: true } } }),

        /* People per day, not entries per day. The curve is "how much of the
         * roster filed", so somebody who wrote four lines is one. */
        prisma.$queryRaw<DayCount[]>`
        SELECT a."workDate" AS "workDate", COUNT(DISTINCT a."instructorId") AS "people"
        FROM "ActivityLog" a
        JOIN "Instructor" i ON i.id = a."instructorId"
        JOIN "User" u ON u.id = i."userId"
        WHERE a."workDate" BETWEEN ${toDateOnly(thisMonth.from)}::date AND ${toDateOnly(thisMonth.to)}::date
          AND a.status::text <> ALL(${notHappened}::text[])
          AND u."isActive" = true
        GROUP BY 1
      `,
        prisma.$queryRaw<DayCount[]>`
        SELECT a."workDate" AS "workDate", COUNT(DISTINCT a."instructorId") AS "people"
        FROM "ActivityLog" a
        JOIN "Instructor" i ON i.id = a."instructorId"
        JOIN "User" u ON u.id = i."userId"
        WHERE a."workDate" BETWEEN ${toDateOnly(lastMonth.from)}::date AND ${toDateOnly(lastMonth.to)}::date
          AND a.status::text <> ALL(${notHappened}::text[])
          AND u."isActive" = true
        GROUP BY 1
      `,

        /* Every active instructor with the last day they recorded — a LEFT
         * JOIN, so somebody who has never written anything comes back with
         * null rather than falling out of the list. They are exactly who the
         * outstanding table is for. */
        prisma.$queryRaw<Person[]>`
        SELECT i.id                AS "instructorId",
               u.name              AS "name",
               i."employeeCode"    AS "employeeCode",
               un.name             AS "universityName",
               MAX(a."workDate")   AS "lastRecordedOn"
        FROM "Instructor" i
        JOIN "User" u ON u.id = i."userId"
        JOIN "University" un ON un.id = i."universityId"
        LEFT JOIN "ActivityLog" a
               ON a."instructorId" = i.id
              AND a.status::text <> ALL(${notHappened}::text[])
        WHERE u."isActive" = true
          AND un."deletedAt" IS NULL
        GROUP BY i.id, u.name, i."employeeCode", un.name
      `,

        /* The latest entries, newest first. Ordered by when they were WRITTEN,
         * not the day they describe: this panel is "what just happened", and a
         * backdated entry filed this morning is news this morning. */
        prisma.$queryRaw<Recent[]>`
        SELECT a.id               AS "id",
               u.name             AS "name",
               i."employeeCode"   AS "employeeCode",
               a."createdAt"      AS "createdAt",
               a."workDate"       AS "workDate",
               COALESCE(d.label, t.label) AS "label"
        FROM "ActivityLog" a
        JOIN "Instructor" i ON i.id = a."instructorId"
        JOIN "User" u ON u.id = i."userId"
        JOIN "ActivityType" t ON t.id = a."activityTypeId"
        LEFT JOIN "DeliverableType" d ON d.id = a."deliverableTypeId"
        WHERE u."isActive" = true
          AND a.status::text <> ALL(${notHappened}::text[])
        ORDER BY a."createdAt" DESC
        LIMIT 8
      `,

        prisma.$queryRaw<Hours[]>`
        SELECT SUM(EXTRACT(EPOCH FROM (a."endTime" - a."startTime")) / 3600.0)::float8 AS "hours"
        FROM "ActivityLog" a
        JOIN "Instructor" i ON i.id = a."instructorId"
        JOIN "User" u ON u.id = i."userId"
        WHERE a."workDate" BETWEEN ${toDateOnly(thisMonth.from)}::date AND ${toDateOnly(thisMonth.to)}::date
          AND a.status::text <> ALL(${notHappened}::text[])
          AND u."isActive" = true
      `,
        prisma.$queryRaw<Hours[]>`
        SELECT SUM(EXTRACT(EPOCH FROM (a."endTime" - a."startTime")) / 3600.0)::float8 AS "hours"
        FROM "ActivityLog" a
        JOIN "Instructor" i ON i.id = a."instructorId"
        JOIN "User" u ON u.id = i."userId"
        WHERE a."workDate" BETWEEN ${toDateOnly(lastMonth.from)}::date AND ${toDateOnly(lastMonth.to)}::date
          AND a.status::text <> ALL(${notHappened}::text[])
          AND u."isActive" = true
      `,
      ]);

    const day = (d: Date) => d.toISOString().slice(0, 10);
    const submittedOn = new Map(byDay.map((r) => [day(r.workDate), Number(r.people)]));
    const submittedOnLast = new Map(byDayLast.map((r) => [day(r.workDate), Number(r.people)]));

    const datesIn = (bounds: { from: string; to: string }) => {
      const out: string[] = [];
      for (let at = new Date(`${bounds.from}T00:00:00.000Z`); day(at) <= bounds.to; ) {
        out.push(day(at));
        at = new Date(at.getTime() + 86_400_000);
      }
      return out;
    };

    const outstanding = people
      .map((p) => ({
        instructorId: p.instructorId,
        name: p.name,
        employeeCode: p.employeeCode,
        universityName: p.universityName,
        lastRecordedOn: p.lastRecordedOn ? day(p.lastRecordedOn) : null,
      }))
      // Nobody who filed today is outstanding today.
      .filter((p) => p.lastRecordedOn !== date)
      /* Silent longest first — the point of the list is who has been missing,
       * and "never" sorts ahead of any date by being empty. */
      .sort((a, b) => (a.lastRecordedOn ?? "").localeCompare(b.lastRecordedOn ?? ""));

    const submittedToday = submittedOn.get(date) ?? 0;

    return NextResponse.json({
      date,
      month: { from: thisMonth.from, to: thisMonth.to },
      totals: {
        employees,
        instructors,
        submittedToday,
        // Everyone active who has not filed for this date.
        pendingToday: Math.max(instructors - submittedToday, 0),
        monthHours: round(monthHours[0]?.hours ?? 0),
        lastMonthHours: round(lastHours[0]?.hours ?? 0),
      },
      series: datesIn(thisMonth).map((d) => ({
        date: d,
        // Ahead of the date being shown is not zero, it is unknown.
        count: d > date ? null : (submittedOn.get(d) ?? 0),
      })),
      compare: datesIn(lastMonth).map((d) => ({ date: d, count: submittedOnLast.get(d) ?? 0 })),
      recent: recent.map((r) => ({
        id: r.id,
        name: r.name,
        employeeCode: r.employeeCode,
        at: r.createdAt.toISOString(),
        workDate: day(r.workDate),
        label: r.label,
      })),
      outstanding,
    });
  },
  { roles: ["ADMIN"] },
);
