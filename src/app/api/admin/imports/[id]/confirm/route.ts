import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/http/route";
import { logAudit } from "@/server/audit/logger";
import { confirmImportJob } from "@/server/import/service";
import { MIN_PASSWORD_LENGTH } from "@/server/users/bootstrap-admin";

/**
 * The confirmation: the one request that causes writes.
 *
 * ── 202, not 200 ───────────────────────────────────────────────────────────
 * This returns as soon as the job is marked PROCESSING. Writing thousands of
 * people takes minutes, and the request that starts it must not be the one that
 * finishes it — the client polls `GET /api/admin/imports/:id` for progress.
 *
 * ── initialPassword ────────────────────────────────────────────────────────
 * Every account this import creates gets this password, hashed ONCE and reused.
 * It is required because `User.passwordHash` is NOT NULL and the product has no
 * password-reset endpoint, so an account created without a usable credential
 * would be permanently unusable. It is taken here rather than from a column in
 * the file, so an uploaded roster never becomes a credential store, and it is
 * never persisted, echoed back, or logged — including in this route's audit
 * metadata below.
 *
 * The length rule is the platform's existing one, imported rather than restated.
 */
const Confirm = z.object({
  initialPassword: z.string().min(MIN_PASSWORD_LENGTH).max(1024),
});

export const POST = withAuth<{ id: string }>(async ({ params, req, principal, scope }) => {
  const { initialPassword } = Confirm.parse(await req.json().catch(() => null));

  const started = await confirmImportJob(params.id, initialPassword);

  await logAudit(principal, scope, {
    action: "IMPORT_CONFIRMED",
    entityType: "ImportJob",
    entityId: params.id,
    universityId: null,
    // Deliberately only the row count. The password is not in this object, and
    // must never be added to it.
    metadata: { rowCount: started.rowCount },
  });

  return NextResponse.json(started, { status: 202 });
}, { roles: ["ADMIN"] });
