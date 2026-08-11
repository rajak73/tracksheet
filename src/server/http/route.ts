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

function toResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return jsonError(err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid request", err.issues);
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
    }
  };
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
