import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { bootstrapAdmin } from "@/server/users/bootstrap-admin";
import { verifyPassword } from "@/server/auth/password";

/**
 * The first-ADMIN bootstrap.
 *
 * ── Why this file builds its own database ──────────────────────────────────
 * The claim under test is "creates the first admin on a database that has
 * none", and the shared test database always has one. An earlier version of
 * this file faked the empty case by deleting the seeded ADMIN inside a
 * transaction it then rolled back. That passed alone and failed in a full run:
 * `AuditLog.userId` is `onDelete: Restrict`, so once earlier test files have
 * written audit rows against the seeded admin the delete is refused outright.
 * The result was a test whose outcome depended on file ordering.
 *
 * So this file provisions a throwaway database, migrates it, and leaves it
 * genuinely empty — which is also the exact production situation the command
 * exists for. Nothing here touches the shared seeded database except the final
 * read-only check that it is still intact.
 */

const PASSWORD = "bootstrap-correct-horse-battery";
const SCRATCH_DB = "tracksheet_bootstrap_scratch";

/** The shared seeded database — only ever read from, in this file. */
let seeded: PrismaClient;
/** A migrated database containing no rows at all. */
let empty: PrismaClient;
let scratchUrl: string;

/** Rewrites the configured connection string to point at another database. */
function urlFor(database: string): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Runs a statement against the `postgres` maintenance database. */
async function maintenance(sql: string): Promise<void> {
  const client = new Client({ connectionString: urlFor("postgres") });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  seeded = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  // Dropped first in case a previous run was killed before its teardown.
  await maintenance(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await maintenance(`CREATE DATABASE ${SCRATCH_DB}`);

  scratchUrl = urlFor(SCRATCH_DB);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: scratchUrl },
    stdio: "pipe",
  });

  empty = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });
});

afterAll(async () => {
  await empty?.$disconnect();
  await seeded?.$disconnect();
  await maintenance(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
});

describe("the database this file provisions", () => {
  test("is migrated and contains no users at all", async () => {
    expect(await empty.user.count()).toBe(0);
  });
});

/**
 * Deliberately placed before the block that creates the ADMIN: this is the one
 * refusal that has to be proven while the database genuinely still has none,
 * so it cannot be mistaken for the ADMIN_EXISTS path.
 */
describe("an email already in use is refused, with no ADMIN present", () => {
  test("returns EMAIL_IN_USE rather than creating a second account", async () => {
    const university = await empty.university.create({
      data: { name: "Email Clash University", slug: "email-clash", code: "CLASH1", timezone: "UTC" },
    });
    const manager = await empty.user.create({
      data: {
        email: "clash@example.com",
        name: "Existing Manager",
        role: "MANAGER",
        passwordHash: "scrypt$32768$8$1$AAAA$AAAA",
        universityId: university.id,
      },
      select: { id: true, email: true },
    });

    // The precondition that makes this test meaningful.
    expect(await empty.user.count({ where: { role: "ADMIN" } })).toBe(0);

    const result = await bootstrapAdmin(empty, {
      email: manager.email.toUpperCase(),
      name: "Duplicate Email",
      password: PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("EMAIL_IN_USE");
    expect(await empty.user.count()).toBe(1);

    // Leave the throwaway database empty again for the blocks below.
    await empty.user.delete({ where: { id: manager.id } });
    await empty.university.delete({ where: { id: university.id } });
    expect(await empty.user.count()).toBe(0);
  });
});

describe("creating the first administrator", () => {
  test("creates an ADMIN when the database has none", async () => {
    const result = await bootstrapAdmin(empty, {
      email: "First.Admin@Example.Com",
      name: "First Admin",
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("First Admin");
    // Email is normalised to lower case, as the provisioning routes do.
    expect(result.email).toBe("first.admin@example.com");

    const stored = await empty.user.findUniqueOrThrow({
      where: { id: result.id },
      select: { passwordHash: true, role: true, universityId: true, isActive: true },
    });

    // The stored credential is a real scrypt hash of that password — not the
    // plaintext, and not merely some other string.
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(stored.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(PASSWORD, stored.passwordHash)).toBe(true);
    expect(await verifyPassword("the wrong password", stored.passwordHash)).toBe(false);

    // Global, as the `user_role_tenant_binding` CHECK constraint requires.
    expect(stored.role).toBe("ADMIN");
    expect(stored.universityId).toBeNull();
    expect(stored.isActive).toBe(true);
  });

  test("the created account is the only user on that database", async () => {
    expect(await empty.user.count()).toBe(1);
  });
});

describe("refusing to create a second administrator", () => {
  // Runs after the block above, so `empty` now holds exactly one ADMIN.
  test("refuses once an ADMIN exists", async () => {
    expect(await empty.user.count({ where: { role: "ADMIN" } })).toBe(1);

    const result = await bootstrapAdmin(empty, {
      email: "second.admin@example.com",
      name: "Second Admin",
      password: PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ADMIN_EXISTS");
  });

  test("the refusal writes nothing", async () => {
    const before = await empty.user.count();
    await bootstrapAdmin(empty, {
      email: "never.created@example.com",
      name: "Never Created",
      password: PASSWORD,
    });

    expect(await empty.user.count()).toBe(before);
    const created = await empty.user.findUnique({
      where: { email: "never.created@example.com" },
      select: { id: true },
    });
    expect(created).toBeNull();
  });

  test("refuses against the real seeded database too, writing nothing", async () => {
    const before = await seeded.user.count();
    const result = await bootstrapAdmin(seeded, {
      email: "second.admin@example.com",
      name: "Second Admin",
      password: PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ADMIN_EXISTS");
    expect(await seeded.user.count()).toBe(before);
  });
});

describe("invalid input fails safely", () => {
  test.each([
    ["missing email", { email: "", name: "X", password: PASSWORD }],
    ["malformed email", { email: "not-an-email", name: "X", password: PASSWORD }],
    ["missing name", { email: "a@b.com", name: "   ", password: PASSWORD }],
    ["short password", { email: "a@b.com", name: "X", password: "short" }],
    ["empty password", { email: "a@b.com", name: "X", password: "" }],
  ])("rejects %s without writing", async (_label, input) => {
    const before = await empty.user.count();
    const result = await bootstrapAdmin(empty, input as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_INPUT");
    expect(await empty.user.count()).toBe(before);
  });

  test("the rejection message never echoes the password", async () => {
    const result = await bootstrapAdmin(empty, {
      email: "bad",
      name: "X",
      password: "a-very-secret-value-here",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("a-very-secret-value-here");
  });
});

describe("the shared seeded database is never touched", () => {
  test("every seeded account still exists", async () => {
    const admins = await seeded.user.count({ where: { role: "ADMIN" } });
    const total = await seeded.user.count();
    expect(admins).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(admins);

    const seededAdmin = await seeded.user.findUnique({
      where: { email: "admin@example.edu" },
      select: { id: true, role: true },
    });
    expect(seededAdmin).not.toBeNull();
    expect(seededAdmin!.role).toBe("ADMIN");
  });

  test("bootstrap created nothing on it", async () => {
    const strays = await seeded.user.count({
      where: {
        email: {
          in: ["first.admin@example.com", "second.admin@example.com", "never.created@example.com"],
        },
      },
    });
    expect(strays).toBe(0);
  });
});
