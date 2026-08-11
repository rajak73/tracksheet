import { prisma } from "@/server/db";
import { type TenantScope } from "@/server/auth/scope";
import { type Principal } from "@/server/auth/session";

export type AuditEntry = {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Records a meaningful state change.
 *
 * A global ADMIN has no universityId, which previously caused the write to be
 * skipped entirely — so the most privileged actor was the one nobody audited.
 * `universityId` is now nullable and a global action is stored with null.
 */
export async function logAudit(
  principal: Principal,
  scope: TenantScope,
  entry: AuditEntry,
): Promise<void> {
  const universityId = scope.kind === "global" ? null : scope.universityId;

  try {
    await prisma.auditLog.create({
      data: {
        userId: principal.userId,
        // Omitted rather than explicitly null for a global action; the column
        // is nullable, so the stored value is the same either way.
        universityId: universityId ?? undefined,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: (entry.metadata ?? {}) as object,
      },
    });
  } catch (error) {
    // Auditing must never break the operation it is recording, but a failure
    // here is a real problem, so it is logged loudly rather than swallowed.
    console.error("[audit] failed to record", entry.action, error);
  }
}
