import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { loadUniversityConfig } from "@/server/universities/config";
import { validateTimeConfig } from "@/server/time/schedule-windows";
import { logAudit } from "@/server/audit/logger";

/** Readable by admin (any university) and by manager/instructor (their own). */
export const GET = withAuth<{ id: string }>(async ({ scope, params }) => {
  assertCanAccessUniversity(scope, params.id);
  const config = await loadUniversityConfig(params.id);
  return NextResponse.json({ config });
});

const WorkingHourInput = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isWorkingDay: z.boolean(),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
});

const ConfigPatch = z
  .object({
    timezone: z.string().min(1).optional(),
    openingDurationMin: z.number().int().positive().optional(),
    closingDurationMin: z.number().int().positive().optional(),
    /** Partial: only the supplied days are changed. */
    workingHours: z.array(WorkingHourInput).min(1).max(7).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

/**
 * Admin only. Managers get 403 from the role gate in withAuth, so this handler
 * contains no role logic of its own.
 *
 * The whole update runs in one transaction after validation, so a rejected
 * configuration never lands half-applied.
 */
export const PATCH = withAuth<{ id: string }>(
  async ({ params, req, principal, scope }) => {
    const patch = ConfigPatch.parse(await req.json().catch(() => null));
    const current = await loadUniversityConfig(params.id);

    // Merge onto current state so a partial patch is validated as the config
    // it will actually produce, not just the fields that happened to be sent.
    const mergedHours = new Map(current.workingHours.map((h) => [h.dayOfWeek, { ...h }]));
    for (const h of patch.workingHours ?? []) mergedHours.set(h.dayOfWeek, h);

    const merged = {
      timezone: patch.timezone ?? current.timezone,
      openingDurationMin: patch.openingDurationMin ?? current.openingDurationMin,
      closingDurationMin: patch.closingDurationMin ?? current.closingDurationMin,
      workingHours: [...mergedHours.values()],
    };

    validateTimeConfig(merged);

    await prisma.$transaction([
      prisma.university.update({
        where: { id: params.id },
        data: {
          timezone: merged.timezone,
          openingDurationMin: merged.openingDurationMin,
          closingDurationMin: merged.closingDurationMin,
        },
      }),
      ...(patch.workingHours ?? []).map((h) =>
        prisma.universityWorkingHours.upsert({
          where: { universityId_dayOfWeek: { universityId: params.id, dayOfWeek: h.dayOfWeek } },
          create: { universityId: params.id, ...h },
          update: {
            isWorkingDay: h.isWorkingDay,
            startMinute: h.startMinute,
            endMinute: h.endMinute,
          },
        }),
      ),
    ]);

    await logAudit(principal, scope, {
      action: "UNIVERSITY_CONFIG_UPDATED",
      entityType: "University",
      entityId: params.id,
      metadata: { changed: Object.keys(patch) },
    });

    return NextResponse.json({ config: await loadUniversityConfig(params.id) });
  },
  { roles: ["ADMIN"] },
);
