import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { validateImportJob } from "@/server/import/service";
import { isValidTimezone } from "@/server/import/schema";

/**
 * Validating a mapped dataset, producing the preview the admin approves.
 *
 * Nothing is written here. The whole point of a separate step is that an admin
 * sees what an import WOULD do — how many records are created, how many updated,
 * which rows are wrong and why — before anything happens.
 *
 * `defaultTimezone` exists because `University.timezone` is NOT NULL with no
 * default, and a staff roster rarely carries one. Rather than inventing a
 * timezone (every "working day" boundary in the product is computed in it, so a
 * wrong guess silently misreports capacity for a whole tenant), the admin states
 * one for the universities this file creates. Omit it and any new university
 * without a timezone column is reported as an error, not quietly defaulted.
 */
const Validate = z.object({
  defaultTimezone: z.string().min(1).max(64).optional(),
});

export const POST = withAuth<{ id: string }>(async ({ params, req, principal, scope }) => {
  const body = Validate.parse((await req.json().catch(() => null)) ?? {});

  if (body.defaultTimezone && !isValidTimezone(body.defaultTimezone)) {
    throw new ApiError(
      400,
      "INVALID_TIMEZONE",
      `"${body.defaultTimezone}" is not a recognised IANA timezone (for example Asia/Kolkata).`,
    );
  }

  const result = await validateImportJob(params.id, { timezone: body.defaultTimezone });

  await logAudit(principal, scope, {
    action: "IMPORT_VALIDATED",
    entityType: "ImportJob",
    entityId: params.id,
    universityId: null,
    metadata: {
      rowCount: result.preview.rowCount,
      validRows: result.preview.validRows,
      errors: result.preview.errorCount,
      warnings: result.preview.warningCount,
    },
  });

  return NextResponse.json(result);
}, { roles: ["ADMIN"] });
