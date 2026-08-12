import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { universityWhere } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate, validateTimeConfig } from "@/server/time/schedule-windows";
import { toDateOnly } from "@/server/time/workday";

/** Admin sees all universities; manager and instructor see only their own. */
export const GET = withAuth(async ({ scope }) => {
  const universities = await prisma.university.findMany({
    where: scope.kind === "global" ? {} : { id: universityWhere(scope).universityId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      openingDurationMin: true,
      closingDurationMin: true,
      workingHours: {
        orderBy: { dayOfWeek: "asc" },
        select: { dayOfWeek: true, isWorkingDay: true, startMinute: true, endMinute: true },
      },
      _count: { select: { instructors: true, managers: true } },
    },
  });

  return NextResponse.json({ universities, scope: scope.kind });
});


const WorkingHourInput = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isWorkingDay: z.boolean(),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
});

const CreateUniversity = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only"),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "Lowercase letters, digits and - only"),
  timezone: z.string().min(1),
  openingDurationMin: z.number().int().positive().optional(),
  closingDurationMin: z.number().int().positive().optional(),
  breakDurationMin: z.number().int().min(0).optional(),
  workingHours: z.array(WorkingHourInput).length(7),
  holidays: z.array(z.object({ date: z.string(), name: z.string().min(1).max(200) })).optional(),
  country: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  contactEmail: z.string().email().optional(),
});

/**
 * Creates a university, its working-hours configuration, its settings row and
 * any initial holidays in ONE transaction.
 *
 * All-or-nothing on purpose: a university that exists without working hours
 * would be visible in the admin list but would produce no opening/closing
 * windows and no capacity, which looks like a calculation bug rather than a
 * half-finished creation.
 *
 * The configuration is validated through the same `validateTimeConfig` the
 * PATCH path uses, so a university cannot be created in a state the edit form
 * would reject.
 */
export const POST = withAuth(
  async ({ req, principal, scope }) => {
    const input = CreateUniversity.parse(await req.json().catch(() => null));

    validateTimeConfig({
      timezone: input.timezone,
      openingDurationMin: input.openingDurationMin ?? 15,
      closingDurationMin: input.closingDurationMin ?? 15,
      workingHours: input.workingHours,
    });

    for (const h of input.holidays ?? []) assertValidDate(h.date);

    const existing = await prisma.university.findFirst({
      where: { OR: [{ code: input.code }, { slug: input.slug }] },
      select: { code: true, slug: true },
    });
    if (existing) {
      throw new ApiError(
        409,
        "UNIVERSITY_EXISTS",
        existing.code === input.code
          ? `A university with code ${input.code} already exists`
          : `A university with slug ${input.slug} already exists`,
      );
    }

    const university = await prisma.university.create({
      data: {
        name: input.name,
        code: input.code,
        slug: input.slug,
        timezone: input.timezone,
        openingDurationMin: input.openingDurationMin ?? 15,
        closingDurationMin: input.closingDurationMin ?? 15,
        breakDurationMin: input.breakDurationMin ?? 0,
        country: input.country,
        city: input.city,
        contactEmail: input.contactEmail,
        workingHours: { create: input.workingHours },
        universitySettings: { create: {} },
        holidays: {
          create: (input.holidays ?? []).map((h) => ({
            date: toDateOnly(h.date),
            name: h.name,
          })),
        },
      },
      select: { id: true, name: true, code: true, slug: true, timezone: true },
    });

    await logAudit(principal, scope, {
      action: "UNIVERSITY_CREATED",
      entityType: "University",
      entityId: university.id,
      metadata: { code: university.code, name: university.name },
    });

    return NextResponse.json({ university }, { status: 201 });
  },
  { roles: ["ADMIN"] },
);
