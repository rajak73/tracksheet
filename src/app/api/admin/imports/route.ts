import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { parseLimit } from "@/server/http/params";
import { createImportJob, MAX_CSV_BYTES } from "@/server/import/service";

/**
 * Bulk organisation import: the upload, and the history.
 *
 * ── ADMIN only, enforced here rather than in the UI ────────────────────────
 * `{ roles: ["ADMIN"] }` is what makes this admin-only. An import creates
 * universities, managers and instructors across every tenant, which is a
 * platform-wide action no manager or instructor may take. A manager reaching
 * this URL directly gets a 403 from `withAuth` before a single byte of their
 * body is read.
 *
 * ── Multipart, not JSON ────────────────────────────────────────────────────
 * `NextRequest` extends the web `Request`, so `req.formData()` is available and
 * `withAuth` never touches the body. The size ceiling is checked here because
 * nothing else in this application imposes one — there is no middleware and no
 * `bodySizeLimit`, so an unbounded upload endpoint would be an open door.
 */
export const POST = withAuth(async ({ principal, scope, req }) => {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the file as multipart/form-data.");
  }

  // A declared length lets an oversized upload be refused before it is buffered
  // into memory; `formData()` would otherwise read the whole thing first.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CSV_BYTES * 2) {
    throw new ApiError(413, "FILE_TOO_LARGE", "That file is too large to import.");
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Attach a CSV or PDF file as `file`.");
  }
  if (file.size === 0) throw new ApiError(400, "INVALID_FILE", "That file is empty.");

  const bytes = new Uint8Array(await file.arrayBuffer());

  // `createImportJob` decides what the file actually IS from its bytes, and
  // throws a 413/400 for anything oversized or not a CSV/PDF.
  const { id, duplicateOf } = await createImportJob({
    userId: principal.userId,
    fileName: file.name,
    declaredType: file.type,
    bytes,
  });

  const job = await prisma.importJob.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      sourceType: true,
      status: true,
      fileName: true,
      fileSize: true,
      rowCount: true,
      mapping: true,
      summary: true,
      extractionConfidence: true,
      createdAt: true,
    },
  });

  // Platform-wide by nature: an import is not scoped to one university, so the
  // audit row deliberately carries no universityId.
  await logAudit(principal, scope, {
    action: "IMPORT_UPLOADED",
    entityType: "ImportJob",
    entityId: id,
    universityId: null,
    metadata: {
      sourceType: job.sourceType,
      fileName: job.fileName,
      fileSize: job.fileSize,
      rowCount: job.rowCount,
      duplicateOf,
    },
  });

  return NextResponse.json({ job, duplicateOf }, { status: 201 });
}, { roles: ["ADMIN"] });

/** Import history. `rows` is deliberately not selected — it is the whole file. */
export const GET = withAuth(async ({ req }) => {
  const limit = parseLimit(req.nextUrl.searchParams.get("limit"), { fallback: 25, max: 100 });
  const jobs = await prisma.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      sourceType: true,
      status: true,
      fileName: true,
      fileSize: true,
      rowCount: true,
      processedRows: true,
      summary: true,
      extractionConfidence: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
  });
  return NextResponse.json({ jobs });
}, { roles: ["ADMIN"] });
