import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { suggestMapping } from "@/server/import/mapping";
import type { ColumnMapping } from "@/server/import/schema";

/**
 * Asking the model to place the columns the synonym table could not.
 *
 * Explicitly requested by the admin, never automatic — the deterministic pass
 * resolves nearly every real file, and a model call the admin did not ask for is
 * a cost with no decision behind it. ONE call for the whole file, carrying only
 * the unmatched header names and two sample values each; the dataset never goes.
 *
 * The response is a suggestion. It cannot overwrite a column already mapped, it
 * is filtered to real field names, and the admin still confirms via PATCH before
 * anything is validated. If the provider is unavailable this returns an empty
 * suggestion set and says why — mapping by hand still works.
 */
export const POST = withAuth<{ id: string }>(async ({ params }) => {
  // `summary` carries the headers and a couple of sample values; `rows` is the
  // whole file and is not needed to suggest a mapping.
  const job = await prisma.importJob.findUnique({
    where: { id: params.id },
    select: { summary: true, mapping: true, sourceType: true },
  });
  if (!job) throw new ApiError(404, "NOT_FOUND", "Import not found");
  if (job.sourceType === "PDF") {
    throw new ApiError(400, "NOT_MAPPABLE", "A PDF import has no columns to map.");
  }

  const stored = (job.summary ?? {}) as { headers?: string[]; sampleRows?: string[][] };
  const headers = stored.headers ?? [];
  if (headers.length === 0) {
    throw new ApiError(409, "CONFLICT", "This import has no stored columns. Upload the file again.");
  }

  const outcome = await suggestMapping(
    headers,
    (stored.sampleRows ?? []).slice(0, 2),
    (job.mapping ?? {}) as ColumnMapping,
  );

  if (!outcome.ok) {
    console.warn("[import] mapping suggestion unavailable:", outcome.reason);
    return NextResponse.json({
      suggestions: {},
      available: false,
      notice: "AI mapping suggestions are unavailable. Map the remaining columns manually.",
    });
  }

  return NextResponse.json({ suggestions: outcome.suggestions, available: true });
}, { roles: ["ADMIN"] });
