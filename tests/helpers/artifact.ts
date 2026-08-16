import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where a suite writes a human-readable diagnostic artifact — the security
 * checklist, the sampled model output, the generated insights.
 *
 * These files are evidence for a person to read after a run, not assertions, so
 * losing them must never fail a test. What they must not be is a path that only
 * exists on one machine: three suites previously hardcoded an absolute path
 * into an ephemeral scratch directory, which passed on the machine that created
 * it and threw ENOENT anywhere else, CI included.
 *
 * `os.tmpdir()` is the portable answer — defined on every platform, writable
 * without setup, and outside the repository so nothing lands in `git status`.
 */
const DIR = join(tmpdir(), "tracksheet-test-artifacts");

/** Absolute path for `filename`, with the containing directory guaranteed. */
export function artifactPath(filename: string): string {
  mkdirSync(DIR, { recursive: true });
  return join(DIR, filename);
}
