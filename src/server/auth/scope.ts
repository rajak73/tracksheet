import type { Principal } from "@/server/auth/session";
import { ApiError } from "@/server/http/errors";

/**
 * Phase 0 §3.8 — the authorization layer never hands out a bare
 * `universityId: string | null`. A null would silently degrade
 * `where: { universityId: null }` into "match nothing" for admins, which is the
 * classic way global access breaks. Instead every handler receives a tagged
 * scope and must consume it through the helpers below, so "global" is always a
 * deliberate branch.
 */
export type TenantScope =
  | { kind: "global" }
  | { kind: "university"; universityId: string }
  | { kind: "self"; universityId: string; instructorId: string };

export function scopeFor(principal: Principal): TenantScope {
  switch (principal.role) {
    case "ADMIN":
      return { kind: "global" };

    case "MANAGER":
      if (!principal.universityId) {
        // Unreachable while the user_role_tenant_binding CHECK holds; failing
        // closed rather than trusting that invariant at runtime.
        throw new ApiError(403, "FORBIDDEN", "Manager has no university binding");
      }
      return { kind: "university", universityId: principal.universityId };

    case "INSTRUCTOR":
      if (!principal.universityId || !principal.instructorId) {
        throw new ApiError(403, "FORBIDDEN", "Instructor profile is incomplete");
      }
      return {
        kind: "self",
        universityId: principal.universityId,
        instructorId: principal.instructorId,
      };
  }
}

/**
 * Prisma `where` fragment restricting a tenant-scoped table by university.
 * `{}` for admins is correct and intentional: an unfiltered global read.
 */
export function universityWhere(scope: TenantScope): { universityId?: string } {
  return scope.kind === "global" ? {} : { universityId: scope.universityId };
}

/**
 * Prisma `where` fragment for the instructors table. Self-scoped callers are
 * additionally pinned to their own id, so an instructor cannot widen to their
 * university's roster.
 *
 * `requested` is an optional client-supplied university filter, validated the
 * same way as {@link narrowUniversity}: narrowing within scope is allowed,
 * widening is a 403.
 *
 * Routes must call THIS rather than assembling a `where` themselves — an
 * endpoint that inlines its own scope check is how isolation regresses.
 */
export function instructorWhere(
  scope: TenantScope,
  requested?: string | null,
): { universityId?: string; id?: string } {
  const universityFilter = narrowUniversity(scope, requested);
  return {
    ...universityFilter,
    ...(scope.kind === "self" ? { id: scope.instructorId } : {}),
  };
}

/**
 * Validates a client-supplied `universityId` filter.
 *
 * A client may NARROW within what it can already see (an admin filtering to one
 * university is legitimate), but may never WIDEN. Anything outside scope is a
 * 403 rather than a silent empty result, so cross-tenant probing is visible in
 * logs instead of looking like "no data".
 */
export function narrowUniversity(
  scope: TenantScope,
  requested: string | null | undefined,
): { universityId?: string } {
  if (!requested) return universityWhere(scope);

  if (scope.kind !== "global" && requested !== scope.universityId) {
    throw new ApiError(403, "CROSS_TENANT_DENIED", "University is outside your scope");
  }

  return { universityId: requested };
}

/**
 * Where-fragment for records that hang off an instructor inside a university
 * (activity logs, deliverables, …).
 *
 * The distinction that matters: {@link assertCanAccessUniversity} answers "may
 * you touch this tenant?", which is NOT sufficient for these tables. A
 * self-scoped caller belongs to the university but must still only ever see
 * their own rows, so this pins `instructorId` as well. Reaching for the
 * university-level check here is what let one instructor read a colleague's
 * records.
 */
export function instructorOwnedWhere(
  scope: TenantScope,
  universityId?: string | null,
): { universityId?: string; instructorId?: string } {
  return {
    ...narrowUniversity(scope, universityId),
    ...(scope.kind === "self" ? { instructorId: scope.instructorId } : {}),
  };
}

/**
 * Throws unless the scope permits acting on this specific university.
 *
 * Delegates to {@link narrowUniversity} rather than re-deriving the comparison,
 * so university-by-id routes and list routes share one definition of
 * "outside your scope" and produce the identical 403 CROSS_TENANT_DENIED.
 */
export function assertCanAccessUniversity(scope: TenantScope, universityId: string): void {
  narrowUniversity(scope, universityId);
}

/** Throws unless the scope permits reading this specific instructor. */
export function assertCanReadInstructor(
  scope: TenantScope,
  instructor: { id: string; universityId: string },
): void {
  switch (scope.kind) {
    case "global":
      return;
    case "university":
      if (instructor.universityId !== scope.universityId) {
        throw new ApiError(404, "NOT_FOUND", "Instructor not found");
      }
      return;
    case "self":
      if (instructor.id !== scope.instructorId) {
        // 404 rather than 403: a self-scoped caller should not be able to
        // confirm that another instructor's id exists.
        throw new ApiError(404, "NOT_FOUND", "Instructor not found");
      }
      return;
  }
}
