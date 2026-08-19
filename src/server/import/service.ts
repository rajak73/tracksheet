/**
 * The import as a workflow: upload, map, validate, confirm.
 *
 *     POST   /imports              upload   -> UPLOADED   (parsed, mapping guessed)
 *     PATCH  /imports/:id          map      -> MAPPED
 *     POST   /imports/:id/validate validate -> VALIDATED  (preview ready)
 *     POST   /imports/:id/confirm  confirm  -> PROCESSING -> COMPLETED | …
 *
 * Each step is a separate request because each one is a decision the admin makes
 * with information the previous step produced. The dataset lives in the job row
 * between them, so a 10,000-row file is uploaded once rather than four times.
 *
 * ── Why confirmation does not wait ─────────────────────────────────────────
 * Writing 10,000 people is thousands of round trips, and the request that starts
 * it must not be the request that finishes it. So `confirmImport` marks the job
 * PROCESSING, returns, and lets the work continue in the background, writing
 * `processedRows` as it goes; the client polls the job. This is the same
 * in-process pattern the metrics rollup already uses — the repository has no
 * queue, and inventing one for this would be a second scheduler to operate.
 *
 * The honest limitation: a deploy or a crash mid-run leaves a job PROCESSING
 * with no worker. That is recoverable rather than corrupting, because every
 * write is idempotent — confirming again re-resolves and finishes the rest. It
 * is stated in the UI rather than hidden.
 *
 * ── The file itself is never kept ──────────────────────────────────────────
 * Bytes are validated, parsed, and dropped. What persists is the parsed rows,
 * which is what steps 2-4 operate on. Nothing here writes an uploaded document
 * to disk or to object storage, so there is no upload directory to secure and
 * nothing to clean up.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { ImportStatus, ImportSourceType, type Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/server/http/errors";
import { parseCsv } from "@/server/import/csv";
import { applyMapping, detectMapping, unmappedHeaders } from "@/server/import/mapping";
import { extractFromPdf } from "@/server/import/pdf";
import { executeImport } from "@/server/import/execute";
import { resolveImport, type ImportDefaults } from "@/server/import/resolve";
import {
  MAX_REPORTED_ISSUES,
  type CanonicalRow,
  type ColumnMapping,
  type ImportIssue,
  type ImportPreview,
} from "@/server/import/schema";

/**
 * Upload ceilings.
 *
 * There is no body-size limit anywhere in this application — no middleware, no
 * `bodySizeLimit`, and `withAuth` never touches the body — so an unbounded
 * upload endpoint would be an open invitation. These are the bound.
 *
 * PDF is capped lower than it could be: the file is base64-encoded into a
 * provider request whose whole-payload ceiling is 20MB, and base64 costs a
 * third, so 10MB of PDF is about 13.4MB on the wire with room to spare.
 */
export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Rows one job may hold. Beyond this the file should be split. */
export const MAX_ROWS = 20_000;

export type StoredSummary = {
  preview?: ImportPreview;
  defaults?: ImportDefaults;
  outcome?: unknown;
  unmapped?: string[];
  extractionNotes?: string[];
  /**
   * The source column names and a few sample values, for the mapping screen.
   *
   * Kept here, small and separate, so the status endpoint the wizard polls never
   * has to load `rows` — which is the whole file — just to name its columns.
   */
  headers?: string[];
  sampleRows?: string[][];
};

/* ── Storage shape ────────────────────────────────────────────────────────── */

/**
 * What `ImportJob.rows` holds.
 *
 * Both the ORIGINAL cells and the mapped rows, because remapping needs the
 * former: a column the first pass left unmapped has no value in the mapped rows,
 * so relabelling them is impossible and the source has to be there. Headers plus
 * cells is a few hundred kilobytes for a 10,000-row file, which is a reasonable
 * price for making step 2 work without a re-upload.
 */
type StoredRows = {
  headers?: string[];
  cells: string[][];
  rowNumbers: number[];
  mapped: CanonicalRow[];
};

function mappedRows(job: { rows: unknown }): CanonicalRow[] {
  const stored = job.rows as unknown;
  if (Array.isArray(stored)) return stored as CanonicalRow[]; // PDF, or pre-remap
  const shaped = stored as StoredRows;
  return shaped.mapped ?? [];
}

/* ── File acceptance ───────────────────────────────────────────────────────── */

/**
 * Decides what a file actually is, from its bytes.
 *
 * The extension and the browser-supplied MIME type are both hints a caller
 * controls, so neither is trusted on its own: a PDF must begin with `%PDF-`, and
 * a CSV must be decodable text with no NUL bytes. That last check is what stops
 * a renamed binary from being fed to the parser as if it were a spreadsheet.
 */
export function detectSourceType(
  fileName: string,
  declaredType: string,
  bytes: Uint8Array,
): ImportSourceType {
  const isPdfMagic =
    bytes.length > 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;

  if (isPdfMagic) {
    if (bytes.length > MAX_PDF_BYTES) {
      throw new ApiError(413, "FILE_TOO_LARGE", `A PDF may be at most ${MAX_PDF_BYTES / 1024 / 1024}MB.`);
    }
    return ImportSourceType.PDF;
  }

  const looksPdf = /\.pdf$/i.test(fileName) || declaredType === "application/pdf";
  if (looksPdf) {
    throw new ApiError(400, "INVALID_FILE", "That file is named as a PDF but is not one.");
  }

  if (bytes.length > MAX_CSV_BYTES) {
    throw new ApiError(413, "FILE_TOO_LARGE", `A CSV may be at most ${MAX_CSV_BYTES / 1024 / 1024}MB.`);
  }
  // A NUL byte in the first kilobyte means this is not text, whatever it claims.
  if (bytes.subarray(0, 1024).includes(0)) {
    throw new ApiError(400, "INVALID_FILE", "Upload a CSV or a PDF. That file is neither.");
  }
  return ImportSourceType.CSV;
}

/* ── Step 1: upload ────────────────────────────────────────────────────────── */

export async function createImportJob(input: {
  userId: string;
  fileName: string;
  declaredType: string;
  bytes: Uint8Array;
}): Promise<{ id: string; duplicateOf: string | null }> {
  const sourceType = detectSourceType(input.fileName, input.declaredType, input.bytes);
  const checksum = createHash("sha256").update(input.bytes).digest("hex");

  let rows: CanonicalRow[];
  let mapping: ColumnMapping = {};
  let extractionConfidence: string | null = null;
  const summary: StoredSummary = {};
  /** What lands in `ImportJob.rows`. See {@link StoredRows}. */
  let stored: StoredRows | CanonicalRow[];

  if (sourceType === ImportSourceType.CSV) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    const parsed = parseCsv(text);
    if (!parsed.ok) throw new ApiError(400, "INVALID_FILE", parsed.reason);

    const { headers, rows: cells, rowNumbers } = parsed.table;
    mapping = detectMapping(headers);
    rows = applyMapping(headers, cells, rowNumbers, mapping);
    summary.unmapped = unmappedHeaders(headers, mapping);
    summary.headers = headers;
    summary.sampleRows = cells.slice(0, 5);
    // The source cells are kept so step 2 can remap a column the first pass
    // could not place — a column that was unmapped has no value in `mapped`.
    stored = { headers, cells, rowNumbers, mapped: rows };
  } else {
    const extraction = await extractFromPdf(input.bytes);
    if (!extraction.ok) {
      throw new ApiError(
        422,
        "EXTRACTION_FAILED",
        `The document could not be read: ${extraction.reason}. A CSV import is unaffected.`,
      );
    }
    rows = extraction.extraction.rows;
    extractionConfidence = extraction.extraction.confidence;
    summary.extractionNotes = extraction.extraction.notes;
    // Extraction already produced canonical fields, so there is nothing to map:
    // the job lands in MAPPED directly and there are no source cells to keep.
    stored = rows;
  }

  if (rows.length > MAX_ROWS) {
    throw new ApiError(
      413,
      "TOO_MANY_ROWS",
      `This file has ${rows.length} rows; the limit for one import is ${MAX_ROWS}. Split it and import the parts.`,
    );
  }

  const duplicate = await prisma.importJob.findFirst({
    where: { checksum, status: { in: [ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const job = await prisma.importJob.create({
    data: {
      createdById: input.userId,
      sourceType,
      fileName: input.fileName.slice(0, 255),
      fileSize: input.bytes.length,
      checksum,
      // A PDF arrives already mapped; a CSV needs the admin to confirm columns.
      status: sourceType === ImportSourceType.PDF ? ImportStatus.MAPPED : ImportStatus.UPLOADED,
      mapping: mapping as Prisma.InputJsonValue,
      rows: stored as unknown as Prisma.InputJsonValue,
      rowCount: rows.length,
      summary: summary as Prisma.InputJsonValue,
      extractionConfidence,
    },
    select: { id: true },
  });

  return { id: job.id, duplicateOf: duplicate?.id ?? null };
}

/* ── Step 2: mapping ──────────────────────────────────────────────────────── */

/**
 * Re-applies a mapping the admin corrected.
 *
 * The stored rows were produced by the previous mapping, so they cannot simply
 * be relabelled — a column that was unmapped has no value in them at all. The
 * source table is not kept, so instead the job holds the ORIGINAL cell values
 * alongside the mapped ones; see `rawRows` below.
 */
export async function remapImportJob(
  jobId: string,
  mapping: ColumnMapping,
): Promise<void> {
  const job = await requireJob(jobId);
  if (job.sourceType === ImportSourceType.PDF) {
    throw new ApiError(400, "NOT_MAPPABLE", "A PDF import has no columns to map.");
  }
  assertStatus(job.status, [ImportStatus.UPLOADED, ImportStatus.MAPPED, ImportStatus.VALIDATED]);

  const stored = job.rows as unknown as StoredRows;
  if (!stored.headers) {
    throw new ApiError(409, "CONFLICT", "This import predates column remapping. Upload the file again.");
  }

  const rows = applyMapping(stored.headers, stored.cells, stored.rowNumbers, mapping);
  const summary: StoredSummary = {
    ...(job.summary as StoredSummary),
    unmapped: unmappedHeaders(stored.headers, mapping),
    headers: stored.headers,
    sampleRows: stored.cells.slice(0, 5),
  };

  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      mapping: mapping as Prisma.InputJsonValue,
      rows: { ...stored, mapped: rows } as unknown as Prisma.InputJsonValue,
      rowCount: rows.length,
      status: ImportStatus.MAPPED,
      summary: summary as Prisma.InputJsonValue,
      errors: [],
      warnings: [],
    },
  });
}

/* ── Step 3: validation ───────────────────────────────────────────────────── */

export async function validateImportJob(
  jobId: string,
  defaults: ImportDefaults,
): Promise<{ preview: ImportPreview; errors: ImportIssue[]; warnings: ImportIssue[] }> {
  const job = await requireJob(jobId);
  assertStatus(job.status, [ImportStatus.UPLOADED, ImportStatus.MAPPED, ImportStatus.VALIDATED]);

  const rows = mappedRows(job);
  const resolution = await resolveImport(rows, defaults);

  const summary: StoredSummary = {
    ...(job.summary as StoredSummary),
    preview: resolution.preview,
    defaults,
  };

  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: ImportStatus.VALIDATED,
      errors: resolution.errors.slice(0, MAX_REPORTED_ISSUES) as unknown as Prisma.InputJsonValue,
      warnings: resolution.warnings.slice(0, MAX_REPORTED_ISSUES) as unknown as Prisma.InputJsonValue,
      summary: summary as Prisma.InputJsonValue,
    },
  });

  return { preview: resolution.preview, errors: resolution.errors, warnings: resolution.warnings };
}

/* ── Step 4: confirmation ─────────────────────────────────────────────────── */

export async function confirmImportJob(
  jobId: string,
  initialPassword: string,
): Promise<{ started: true; rowCount: number }> {
  const job = await requireJob(jobId);

  // Validation is not optional: it is what produced the preview the admin just
  // agreed to, and it is where cross-tenant rows were rejected.
  /* PROCESSING is allowed back in, and that is the whole recovery story this
   * module's header promises. A container restart mid-run leaves a job
   * PROCESSING with no worker behind it; refusing everything but VALIDATED made
   * that state terminal — `validateImportJob` also declines PROCESSING — so a
   * crash at row 4,000 of 10,000 stranded the remaining 6,000 people with no
   * route but re-uploading the file.
   *
   * Re-running is safe because resolution is re-done from the stored rows
   * against the CURRENT database: everybody already written resolves to an
   * update rather than a create. The `updateMany` below is what stops a live
   * run being joined rather than resumed. */
  if (job.status !== ImportStatus.VALIDATED && job.status !== ImportStatus.PROCESSING) {
    throw new ApiError(409, "NOT_VALIDATED", "Validate this import before confirming it.");
  }

  /* A job that is still moving must not be restarted underneath itself. Only a
   * run that has been silent long enough to be certainly dead is resumable. */
  const STALE_AFTER_MS = 15 * 60_000;
  if (
    job.status === ImportStatus.PROCESSING &&
    job.startedAt !== null &&
    Date.now() - job.startedAt.getTime() < STALE_AFTER_MS
  ) {
    throw new ApiError(409, "ALREADY_RUNNING", "This import is still running.");
  }

  const summary = job.summary as StoredSummary;
  if ((summary.preview?.errorCount ?? 0) > 0) {
    throw new ApiError(
      409,
      "BLOCKING_ERRORS",
      "This import still has errors. Correct the file and upload it again.",
    );
  }

  const rows = mappedRows(job);

  /* The status check above is a READ, and this is the write it guards. Between
   * them another request can do the same thing — a double-clicked Confirm, or a
   * client retrying the slow 202 — and both would see VALIDATED, both would
   * start, and two runs would write the same rows concurrently: colliding on
   * the same emails, failing chunks with P2002, and reporting WRITE_FAILED for
   * people who were in fact created.
   *
   * Conditioning the update on the status makes the transition itself the lock.
   * Whoever loses writes nothing and says so. */
  const claimed = await prisma.importJob.updateMany({
    where: { id: jobId, status: job.status },
    data: { status: ImportStatus.PROCESSING, startedAt: new Date(), processedRows: 0, errorMessage: null },
  });
  if (claimed.count === 0) {
    throw new ApiError(409, "ALREADY_RUNNING", "This import has already been started.");
  }

  // Deliberately NOT awaited. The client polls the job; see the module note on
  // why the confirming request must not be the one that finishes the work.
  void runImport(jobId, rows, summary.defaults ?? {}, initialPassword);

  return { started: true, rowCount: rows.length };
}

async function runImport(
  jobId: string,
  rows: CanonicalRow[],
  defaults: ImportDefaults,
  initialPassword: string,
): Promise<void> {
  try {
    let lastWrite = 0;
    const { outcome, errors } = await executeImport(rows, {
      defaults,
      initialPassword,
      onProgress: async (processed) => {
        // Throttled: a write per row would triple the cost of the import to
        // report on it. Every 100 is enough for a progress bar.
        if (processed - lastWrite < 100) return;
        lastWrite = processed;
        await prisma.importJob.update({ where: { id: jobId }, data: { processedRows: processed } });
      },
    });

    const existing = await prisma.importJob.findUnique({ where: { id: jobId }, select: { summary: true, warnings: true } });
    const summary = { ...((existing?.summary as StoredSummary) ?? {}), outcome };
    const warningCount = Array.isArray(existing?.warnings) ? existing.warnings.length : 0;

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status:
          outcome.failed > 0 || warningCount > 0
            ? ImportStatus.COMPLETED_WITH_WARNINGS
            : ImportStatus.COMPLETED,
        processedRows: outcome.created.instructors + outcome.updated.instructors + outcome.created.managers + outcome.updated.managers,
        completedAt: new Date(),
        summary: summary as Prisma.InputJsonValue,
        errors: errors.slice(0, MAX_REPORTED_ISSUES) as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // A failure here is the import's, not the request's — the request returned
    // long ago. It is recorded on the job so the admin sees it, and logged so it
    // is diagnosable.
    console.error("[import] job failed", jobId, error);
    await prisma.importJob
      .update({
        where: { id: jobId },
        data: {
          status: ImportStatus.FAILED,
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message.split("\n")[0] : "unknown error",
        },
      })
      .catch(() => {});
  }
}

/* ── Shared ───────────────────────────────────────────────────────────────── */

async function requireJob(id: string) {
  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job) throw new ApiError(404, "NOT_FOUND", "Import not found");
  return job;
}

function assertStatus(actual: ImportStatus, allowed: ImportStatus[]): void {
  if (!allowed.includes(actual)) {
    throw new ApiError(409, "WRONG_STATUS", `An import that is ${actual} cannot be changed.`);
  }
}
