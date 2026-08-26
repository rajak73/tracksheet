import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { getPrincipal, type Principal } from "@/server/auth/session";
import { scopeFor, type TenantScope } from "@/server/auth/scope";
import { ApiError } from "@/server/http/errors";
import type { Role } from "@/generated/prisma/client";

export type AuthedContext<P = unknown> = {
  principal: Principal;
  scope: TenantScope;
  params: P;
  req: NextRequest;
};

type Handler<P> = (ctx: AuthedContext<P>) => Promise<Response> | Response;

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/** Duck-typed rather than an `instanceof` import: every caller of this module
 *  already has its own Prisma import, and matching on `.code` avoids pulling
 *  the generated client into a file that otherwise has no need of it. */
function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

function toResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return jsonError(err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid request", err.issues);
  }
  if (isUniqueConstraintViolation(err)) {
    // A once-per-day (or other unique) constraint firing at the database is a
    // conflict with existing state, not a server failure — the caller can act
    // on a 409 (e.g. "already recorded today"), but not on a 500.
    return jsonError(409, "CONFLICT", "This already exists.");
  }
  // Never leak internals to the client; the detail goes to the server log only.
  console.error("[unhandled route error]", err);
  return jsonError(500, "INTERNAL_ERROR", "Something went wrong");
}

/**
 * Wraps a route handler so that authentication, role gating, and tenant-scope
 * derivation all happen in ONE place. Handlers receive an already-resolved
 * `scope` and never see a raw `universityId` from the request.
 *
 * Phase 1 rule: no tenant-scoped endpoint may be written without this wrapper.
 */
export function withAuth<P = unknown>(
  handler: Handler<P>,
  options: { roles?: Role[] } = {},
) {
  return async (req: NextRequest, segment: { params: Promise<P> }): Promise<Response> => {
    const startedAt = Date.now();
    try {
      const principal = await getPrincipal();
      if (!principal) {
        return jsonError(401, "UNAUTHENTICATED", "Sign in to continue");
      }

      if (options.roles && !options.roles.includes(principal.role)) {
        return jsonError(403, "FORBIDDEN", "Your role cannot access this resource");
      }

      const scope = scopeFor(principal);
      const params = (segment?.params ? await segment.params : {}) as P;

      return await handler({ principal, scope, params, req });
    } catch (err) {
      return toResponse(err);
    } finally {
      reportIfSlow(req, startedAt);
    }
  };
}

/**
 * How long a request may take before it is worth telling somebody.
 *
 * Two seconds: comfortably above a healthy write on this app (a worklog entry
 * lands in 0.03–0.8s, an activity in 0.1–0.7s, every read under 0.6s) and well
 * below the point where a person decides the button is broken.
 *
 * Env-overridable so a slow environment can raise the bar rather than being
 * told about every request.
 */
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS ?? 2000);

/**
 * Says out loud when a request was slow.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Every worklog save made a blocking call to the model provider and took
 * THIRTY-FOUR SECONDS. It had been doing that for as long as the four-field
 * form existed, and it was found by accident — somebody mentioned saving felt
 * slow. Nothing measured it, so nothing could have said so.
 *
 * `withAuth` wraps 62 of the 64 routes, which makes it the one place that sees
 * every authenticated request. One line here instruments all of them.
 *
 * ── Deliberately only the slow ones ───────────────────────────────────────
 * Logging every request buries the signal in noise and the log stops being
 * read. Only requests over the threshold are reported, so a quiet log means
 * the app is quick — which is the state worth being able to trust.
 */
function reportIfSlow(req: NextRequest, startedAt: number): void {
  const ms = Date.now() - startedAt;
  if (ms < SLOW_MS) return;
  // The pathname only. A query string can carry a search term somebody typed,
  // and this line ends up in a log aggregator.
  console.warn(`[slow] ${req.method} ${req.nextUrl.pathname} ${ms}ms`);
}

/** For unauthenticated endpoints (login) that still want uniform error shaping. */
export function withPublic(handler: (req: NextRequest) => Promise<Response> | Response) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      return toResponse(err);
    }
  };
}
