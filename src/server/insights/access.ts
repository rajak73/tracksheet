import { ApiError } from "@/server/http/errors";
import type { TenantScope } from "@/server/auth/scope";
import type { ScopeType } from "@/server/insights/context";

/**
 * Who is asking, and whether their asking may spend money.
 *
 * ── Why this exists before generation does ────────────────────────────────
 * Nothing can be generated yet, which is exactly why the gate is cheap to build
 * today. Adding a permission boundary to a path that already works is the change
 * that gets skipped — it has no visible effect, it only takes things away, and
 * there is always something more urgent.
 *
 * ── The rule it enforces ──────────────────────────────────────────────────
 * A day's insight belongs to the instructor's own view. A manager reads what is
 * there and never causes one to be made. Without that, a manager scrolling a
 * roster of thirty instructors across a fortnight would generate four hundred
 * day insights in one page load, none of which anybody asked for.
 *
 * An admin is a manager here. Browsing somebody's days must not quietly spend
 * the budget just because the browser has more authority.
 */

export type ViewerRole = "INSTRUCTOR" | "MANAGER" | "ADMIN";

/** Whether a miss or a mismatch may call the model, or must answer PENDING. */
export type GenerationMode = "GENERATE" | "READ_ONLY";

/**
 * The matrix, as data.
 *
 * Deliberately a lookup rather than nested conditionals. A table can be asserted
 * cell by cell in a test and read at a glance; branching logic has to be
 * re-derived every time somebody questions it, and drifts from the specification
 * one plausible edit at a time.
 *
 * Read it as: on a cache HIT every cell serves the stored insight — that is not
 * represented here because it does not vary. This says what happens when there
 * is nothing to serve, or what is stored no longer matches the data.
 */
export const GENERATION_MATRIX: Record<ViewerRole, Record<ScopeType, GenerationMode>> = {
  INSTRUCTOR: { DAY: "GENERATE", WEEK: "GENERATE", MONTH: "GENERATE" },
  /* A manager's DAY is read-only. The other two generate: a week or a month is
     one call for a period the manager is actually reading, and it writes to the
     same row the instructor would use — an insight is about an instructor's
     period, not about who happened to look at it. */
  MANAGER: { DAY: "READ_ONLY", WEEK: "GENERATE", MONTH: "GENERATE" },
  ADMIN: { DAY: "READ_ONLY", WEEK: "GENERATE", MONTH: "GENERATE" },
};

export const generationModeFor = (role: ViewerRole, scopeType: ScopeType): GenerationMode =>
  GENERATION_MATRIX[role][scopeType];

/**
 * The role of the person asking, resolved from the SESSION.
 *
 * Never from the request. Not the body, not a query parameter, not a header, and
 * not inferred from the shape of the URL — every one of those is a value the
 * caller controls, and a permission that the caller can state is not a
 * permission. The only inputs here are the scope the session produced and the
 * instructor being asked about.
 *
 * An instructor asking about somebody else is a 403 rather than a downgrade to
 * MANAGER. They have no manager rights, and quietly serving them a read-only
 * view of a colleague's work would be answering a question they may not ask.
 */
export function resolveViewerRole(scope: TenantScope, subjectInstructorId: string): ViewerRole {
  if (scope.kind === "global") return "ADMIN";

  if (scope.kind === "self") {
    if (scope.instructorId !== subjectInstructorId) {
      /* Same shape as an unknown id, deliberately: a 403 that distinguishes
         "exists but not yours" from "does not exist" tells an instructor which
         colleague ids are real. */
      throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    }
    return "INSTRUCTOR";
  }

  // A university-scoped principal is a manager. Whether this particular
  // instructor is theirs to read is decided by `assertCanReadInstructorWork`,
  // which every reading of one person's work already goes through.
  return "MANAGER";
}
