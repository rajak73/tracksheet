/**
 * Creating the very first ADMIN on a fresh production database.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────
 * Every provisioning route requires an authenticated ADMIN, and the only other
 * account-creating code is `prisma/seed.ts`, which deletes users and installs a
 * publicly-known development password. On a fresh production database there is
 * therefore no way in: nobody can sign in, so nobody can create the account
 * that would let them sign in. This closes exactly that gap and nothing else.
 *
 * ── Why it is not an HTTP endpoint ─────────────────────────────────────────
 * An unauthenticated "create the first admin" route is a takeover primitive the
 * moment its guard is wrong — and its guard is inherently racy, because the
 * check and the insert are separated by a network round trip an attacker
 * controls. This runs as a one-off operator command against the database
 * instead, so there is no public surface to defend and no race to lose.
 *
 * ── The guard, stated honestly ─────────────────────────────────────────────
 * Two refusals, with genuinely different strengths:
 *
 *   - Duplicate EMAIL is race-safe. The check below is a courtesy that produces
 *     a readable message; the actual guarantee is the unique index on
 *     `User.email`, which the database enforces however many processes race.
 *
 *   - "An ADMIN already exists" is NOT race-safe. It is a plain check-then-
 *     insert: no transaction, no row lock, and no partial unique index on
 *     `role = 'ADMIN'` for the database to enforce. Two operators running this
 *     simultaneously with different email addresses could both read zero and
 *     both insert.
 *
 * That is accepted rather than hidden: this is a one-off command an operator
 * runs by hand, once, on a database that by definition has no accounts yet, and
 * the fix for a duplicate is to deactivate one through the application. If it
 * ever becomes something automation calls, it needs a real lock or a partial
 * unique index first — do not assume the check below is doing that work.
 *
 * The plaintext password exists only as a function argument. It is hashed with
 * the application's own `hashPassword` and never logged, returned, or stored.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";

/** Matches the minimum the provisioning routes already enforce. */
export const MIN_PASSWORD_LENGTH = 12;

export type BootstrapInput = {
  email: string;
  name: string;
  password: string;
};

export type BootstrapResult =
  | { ok: true; id: string; email: string; name: string }
  | { ok: false; reason: "ADMIN_EXISTS" | "EMAIL_IN_USE" | "INVALID_INPUT"; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Anything Prisma-shaped: the real client, or a transaction client in tests. */
type Db = Pick<PrismaClient, "user">;

function validate(input: BootstrapInput): string | null {
  const email = input.email?.trim().toLowerCase() ?? "";
  const name = input.name?.trim() ?? "";

  if (!email) return "An email address is required.";
  if (!EMAIL.test(email)) return "That does not look like an email address.";
  if (!name) return "A name is required.";
  if (typeof input.password !== "string" || input.password.length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Creates the first ADMIN, or refuses.
 *
 * Never throws for an expected refusal — the caller renders the reason. It
 * deletes nothing and modifies no existing row under any code path.
 */
export async function bootstrapAdmin(db: Db, input: BootstrapInput): Promise<BootstrapResult> {
  const problem = validate(input);
  if (problem) return { ok: false, reason: "INVALID_INPUT", message: problem };

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  // The refusal that matters. Counting rather than fetching keeps any existing
  // admin's details out of this process entirely.
  const existingAdmins = await db.user.count({ where: { role: "ADMIN" } });
  if (existingAdmins > 0) {
    return {
      ok: false,
      reason: "ADMIN_EXISTS",
      message:
        `This database already has ${existingAdmins} administrator account(s). ` +
        "Bootstrap is for an empty system only — create further admins through the application.",
    };
  }

  const taken = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) {
    return {
      ok: false,
      reason: "EMAIL_IN_USE",
      message: "An account with that email already exists.",
    };
  }

  const passwordHash = await hashPassword(input.password);

  const admin = await db.user.create({
    data: {
      email,
      name,
      role: "ADMIN",
      passwordHash,
      // Required by the `user_role_tenant_binding` CHECK constraint: an ADMIN
      // is global and must carry no tenant.
      universityId: null,
    },
    select: { id: true, email: true, name: true },
  });

  return { ok: true, ...admin };
}
