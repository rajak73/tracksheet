/**
 * CI step: ask every configured model whether it is still there.
 *
 * Exits non-zero when the primary does not answer, so a retired model is a red
 * build rather than a timeout in production three weeks later.
 *
 * Skipped, not failed, without a key: the suite runs with no provider on
 * purpose, and a check that cannot run has not found anything wrong.
 */
import "dotenv/config";
import { checkChain, chainVerdict } from "../src/server/ai/health";

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.log("[models] no GEMINI_API_KEY — skipped, not failed");
    return;
  }
  const results = await checkChain();
  for (const [i, r] of results.entries()) {
    const role = i === 0 ? "primary " : "fallback";
    const state = r.ok ? "ok" : r.capacity ? "busy" : "GONE";
    console.log(
      `[models] ${role} ${r.model.padEnd(24)} ${state.padEnd(6)} ${String(r.ms).padStart(6)}ms  ${r.ok ? "" : r.detail.slice(0, 110)}`,
    );
  }
  const verdict = chainVerdict(results);
  if (!verdict.ok) {
    console.error(`\n[models] ${verdict.reason}`);
    process.exit(1);
  }
  const busy = results.filter((r) => r.capacity).map((r) => r.model);
  if (busy.length) console.warn(`[models] capacity-limited right now: ${busy.join(", ")}`);
  console.log("[models] chain healthy");
}

main().catch((err) => {
  console.error("[models]", err);
  process.exit(1);
});
