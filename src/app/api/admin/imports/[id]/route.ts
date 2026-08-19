import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { remapImportJob } from "@/server/import/service";
import { CANONICAL_FIELDS } from "@/server/import/schema";

/**
 * One import: its state, and its column mapping.
 *
 * GET is what the wizard polls while a confirmed import is running, so it is
 * deliberately cheap: `rows` — the entire parsed file — is never selected.
 * Everything the UI needs (status, counts, preview, diagnostics) is a scalar or
 * a small JSON blob.
 */

const JOB_FIELDS = {
  id: true,
  sourceType: true,
  status: true,
  fileName: true,
  fileSize: true,
  checksum: true,
  rowCount: true,
  processedRows: true,
  mapping: true,
  errors: true,
  warnings: true,
  summary: true,
  extractionConfidence: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  createdBy: { select: { name: true, email: true } },
} as const;

export const GET = withAuth<{ id: string }>(async ({ params }) => {
  const job = await prisma.importJob.findUnique({ where: { id: params.id }, select: JOB_FIELDS });
  if (!job) throw new ApiError(404, "NOT_FOUND", "Import not found");

  // Columns come from `summary`, which holds only the header names and a few
  // sample values. `rows` — the entire parsed file — is deliberately never
  // selected here: this is the endpoint the wizard polls while an import runs,
  // and loading megabytes of JSON several times a second to read a header row
  // made every other request on the server wait behind the garbage collector.
  const summary = (job.summary ?? {}) as { headers?: string[]; sampleRows?: string[][] };

  return NextResponse.json({
    job,
    headers: summary.headers ?? [],
    sampleRows: summary.sampleRows ?? [],
    fields: CANONICAL_FIELDS,
  });
}, { roles: ["ADMIN"] });

/**
 * Correcting the column mapping.
 *
 * The body names source headers and the field each one holds. A field may be
 * claimed once — two columns mapped to `instructorEmail` would make the import
 * depend on column order — and only real field names are accepted, so neither a
 * typo nor a model suggestion can introduce one that does not exist.
 */
const Remap = z.object({
  mapping: z.record(
    z.string().min(1).max(300),
    z.enum(CANONICAL_FIELDS),
  ),
});

export const PATCH = withAuth<{ id: string }>(async ({ params, req, principal, scope }) => {
  const { mapping } = Remap.parse(await req.json().catch(() => null));

  const claimed = Object.values(mapping);
  if (new Set(claimed).size !== claimed.length) {
    throw new ApiError(400, "DUPLICATE_FIELD", "Each field can be mapped to only one column.");
  }

  await remapImportJob(params.id, mapping);

  await logAudit(principal, scope, {
    action: "IMPORT_MAPPED",
    entityType: "ImportJob",
    entityId: params.id,
    universityId: null,
    metadata: { mapping },
  });

  const job = await prisma.importJob.findUniqueOrThrow({
    where: { id: params.id },
    select: JOB_FIELDS,
  });
  return NextResponse.json({ job });
}, { roles: ["ADMIN"] });
