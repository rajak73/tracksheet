import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { parseLimit, parsePage } from "@/server/http/params";
import { narrowUniversity } from "@/server/auth/scope";

/**
 * The staff directory — instructors AND managers in one list.
 *
 * ── Why a new endpoint rather than reusing /api/instructors ────────────────
 * Employment state lives on `User`, not on the profile, and a directory that
 * cannot show managers is not a staff directory. `/api/instructors` is the
 * roster used by the tracker and the manager's own screens; widening it to
 * carry managers would change what every existing caller receives. This reads
 * the same rows from the other side — from `User` — and leaves that contract
 * untouched.
 *
 * ── Status ─────────────────────────────────────────────────────────────────
 * `?status=active|former|all`, defaulting to `active`, because the everyday
 * question is "who works here now". Former staff are never hidden — they are
 * one filter away, and they keep every historical record they ever had.
 *
 * Never selects `passwordHash`. The field is not in the select list at all, so
 * it cannot leak through this route by omission or by a later careless edit.
 */

const STATUS = new Set(["active", "former", "all"]);
const ROLES = new Set(["INSTRUCTOR", "MANAGER"]);

export const GET = withAuth(
  async ({ scope, req }) => {
    const sp = req.nextUrl.searchParams;
    const page = parsePage(sp.get("page"));
    const limit = parseLimit(sp.get("limit"), { fallback: 50, max: 200 });
    const search = sp.get("search")?.trim();

    const status = sp.get("status") ?? "active";
    if (!STATUS.has(status)) {
      throw new ApiError(400, "INVALID_STATUS", "status must be active, former or all");
    }
    const role = sp.get("role");
    if (role !== null && !ROLES.has(role)) {
      throw new ApiError(400, "INVALID_ROLE", "role must be INSTRUCTOR or MANAGER");
    }

    // Tenant narrowing goes through the same helper every other route uses, so
    // a manager asking for another university gets the usual 403 rather than a
    // quietly empty list.
    // `narrowUniversity` returns a where-fragment and throws 403 on a widen
    // attempt, so a manager is pinned to their own tenant here exactly as they
    // are on every other route.
    const { universityId } = narrowUniversity(scope, sp.get("universityId"));

    const where: Prisma.UserWhereInput = {
      // Admins are platform operators, not staff of any university; they are
      // not part of an employee directory.
      role: role ? (role as "INSTRUCTOR" | "MANAGER") : { in: ["INSTRUCTOR", "MANAGER"] },
      ...(universityId ? { universityId } : {}),
      ...(status === "all" ? {} : { isActive: status === "active" }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { instructorProfile: { employeeCode: { contains: search, mode: "insensitive" } } },
              { managerProfile: { employeeCode: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        /* Active first, then the most recent leavers — "who left" is read
         * newest-first, while "who works here" is read alphabetically. */
        orderBy: [{ isActive: "desc" }, { deletedAt: "desc" }, { name: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          deletedAt: true,
          leftReason: true,
          university: { select: { id: true, name: true } },
          // The broad category comes with the row so the directory can offer it
          // as an editable field rather than needing a second request per person.
          instructorProfile: {
            select: {
              id: true,
              employeeCode: true,
              category: { select: { code: true, label: true } },
            },
          },
          managerProfile: {
            select: {
              id: true,
              employeeCode: true,
              // How many people would be orphaned if this manager left, and
              // whether the university itself points at them. The exit dialog
              // needs both to know whether to ask for a successor, and asking
              // here costs one join rather than a request per row.
              _count: { select: { instructors: true } },
              university: { select: { primaryManagerId: true } },
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const staff = users.map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      /* Null on an active person, and null on someone deactivated before this
       * was recorded — an unknown departure date stays unknown rather than being
       * back-filled with a plausible one. */
      leftOn: u.deletedAt,
      leftReason: u.leftReason,
      universityId: u.university?.id ?? null,
      universityName: u.university?.name ?? null,
      employeeCode: u.instructorProfile?.employeeCode ?? u.managerProfile?.employeeCode ?? null,
      // Present only for instructors — the tracker is instructor-scoped, so a
      // manager row has nothing to link to.
      instructorId: u.instructorProfile?.id ?? null,
      category: u.instructorProfile?.category ?? null,
      managerId: u.managerProfile?.id ?? null,
      /** Null for an instructor. Zero is a real answer for a manager. */
      rosterSize: u.managerProfile?._count.instructors ?? null,
      isPrimaryManager:
        u.managerProfile != null &&
        u.managerProfile.university?.primaryManagerId === u.managerProfile.id,
    }));

    return NextResponse.json({
      staff,
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
