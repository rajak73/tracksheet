import { prisma } from "@/server/db";
import { type TenantScope } from "@/server/auth/scope";
import { type Principal } from "@/server/auth/session";

export type AuditEntry = {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  /**
   * The university this action concerns, when the caller already knows it —
   * from route params or a loaded entity — independent of the caller's OWN
   * scope. Deriving universityId solely from the caller's scope meant every
   * admin-performed action on a specific university (editing its config,
   * changing a workload target) was written with universityId = null, which
   * made it permanently unreadable through the only audit endpoint — a
   * university-filtered one — even though the action plainly concerned one
   * university. Pass it explicitly wherever it is known; omit it only for
   * genuinely platform-wide actions (e.g. creating a university).
   */
  universityId?: string | null;
};

/**
 * Records a meaningful state change.
 *
 * A global ADMIN has no universityId of their OWN, which previously caused
 * the write to be skipped entirely — so the most privileged actor was the one
 * nobody audited. `universityId` is nullable and a genuinely global action
 * (one with no `entry.universityId` and a global scope) is stored with null.
 */
export async function logAudit(
  principal: Principal,
  scope: TenantScope,
  entry: AuditEntry,
): Promise<void> {
  const universityId =
    entry.universityId !== undefined
      ? entry.universityId
      : scope.kind === "global"
        ? null
        : scope.universityId;

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
