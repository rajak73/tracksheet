/**
 * Identities that belong to exactly one run of the suite.
 *
 * ── Why fixtures need their own domain ────────────────────────────────────
 * The seed's accounts and the tests' accounts both lived at `@example.edu`,
 * which meant no cleanup could tell them apart: anything broad enough to
 * remove fixture leftovers would also remove the four instructors the whole
 * suite logs in as. Fixtures now live at `fixture.test` — a reserved TLD, so
 * it can never collide with a real address — and the seed keeps
 * `@example.edu` to itself. The separation is what makes a sweep safe to
 * write at all.
 *
 * ── Why the id is shared rather than per-file ─────────────────────────────
 * Every test file used to roll its own suffix, eighteen different ways. That
 * prevents collisions between files but says nothing about what a run owns,
 * so nothing could ask "is this row mine, or did a killed run leave it?".
 * One id per run, written by global setup and read here, makes that question
 * answerable.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RUN_ID_FILE = join(process.cwd(), "node_modules", ".cache", "tracksheet-test-run-id");

/** Reserved TLD (RFC 2606): guaranteed never to resolve, and never the seed's. */
export const FIXTURE_DOMAIN = "fixture.test";

/**
 * A fresh id for one run. Time gives ordering; the random tail carries the
 * uniqueness, because the timestamp contributes nothing when two runs start
 * inside the same millisecond — which is exactly the case that matters here,
 * a run killed to free the port and restarted immediately.
 *
 * The tail is twelve hex characters rather than four base-36 ones. The short
 * version was written first and a 5000-draw test collided on it repeatedly:
 * with the clock held constant it offered only 36^4 values, where the
 * birthday bound makes a collision near-certain well before 5000.
 */
export function newRunId(): string {
  return `${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}

function readRunId(): string {
  try {
    const id = readFileSync(RUN_ID_FILE, "utf8").trim();
    if (id) return id;
  } catch {
    /* Falling through is correct for a single file run outside the harness. */
  }
  return `local${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Unique to this run of the suite, identical across every file in it.
 */
export const RUN = readRunId();

/**
 * A fixture address that cannot collide with another run, another file, or
 * the seed. `local` should say which test owns it, so a stray row in a
 * database names its author.
 */
export function fixtureEmail(local: string): string {
  return `${local}.${RUN}@${FIXTURE_DOMAIN}`;
}
