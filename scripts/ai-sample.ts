/**
 * Prints five real Gemini narrations for manual inspection.
 *
 * This is Phase 10 §2's first required test — "the same 5 sample snapshots now
 * produce Gemini-generated text that is still traceable". It needs a real API
 * key, so it is a script you run rather than part of the automated suite:
 * a test that silently no-ops without a key would be worse than no test.
 *
 *   GEMINI_API_KEY=... npm run ai:sample
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env", quiet: true });

import type { AnomalyCondition } from "../src/server/ai/anomalies";
import { buildGeminiRequest, isGeminiConfigured } from "../src/server/ai/gemini";
import { narrateCondition, narrateConditionDeterministic } from "../src/server/ai/narrate";

const SAMPLES: AnomalyCondition[] = [
  {
    type: "NO_DATA_RECORDED", severity: "HIGH", scope: "UNIVERSITY",
    metrics: { instructors: 2, capacityHours: 80, productiveHours: 0, missingDataHours: 80 },
    threshold: {},
  },
  {
    type: "OVERLOAD", severity: "HIGH", scope: "INSTRUCTOR",
    instructorId: "ins_1", instructorName: "Arun Verma",
    metrics: { utilizationPct: 125, capacityHours: 8, productiveHours: 10 },
    threshold: { utilizationPct: 100 },
  },
  {
    type: "UNDERUTILIZATION", severity: "MEDIUM", scope: "INSTRUCTOR",
    instructorId: "ins_1", instructorName: "Arun Verma",
    metrics: { utilizationPct: 2.5, capacityHours: 40, productiveHours: 1, missingDataHours: 32 },
    threshold: { utilizationPct: 60 },
  },
  {
    type: "COMPLIANCE_RISK", severity: "HIGH", scope: "UNIVERSITY",
    metrics: { kind: "opening", compliancePct: 0 },
    threshold: { compliancePct: 90 },
  },
  {
    type: "LEARNING_DROP", severity: "HIGH", scope: "UNIVERSITY",
    metrics: { dropPct: 100, currentHours: 0, previousHours: 8, previousFrom: "2027-04-05", previousTo: "2027-04-09" },
    threshold: { dropPct: 40 },
  },
];

const BANNED = ["lazy", "inefficient", "unproductive", "poor performer", "negligent", "incompetent", "slacking"];

async function main() {
  if (!isGeminiConfigured()) {
    console.error("GEMINI_API_KEY is not set. Add it to .env or pass it inline:");
    console.error("  GEMINI_API_KEY=... npm run ai:sample");
    process.exit(1);
  }

  console.log(`Model: ${process.env.GEMINI_MODEL ?? "gemini-2.0-flash"}\n`);
  let problems = 0;

  for (const condition of SAMPLES) {
    const sent = JSON.stringify(buildGeminiRequest(condition));
    const narration = await narrateCondition(condition);
    const deterministic = narrateConditionDeterministic(condition);
    const usedModel = narration.summary !== deterministic.summary;

    console.log("─".repeat(78));
    console.log(`CONDITION   ${condition.type} (${condition.severity})`);
    console.log(`SOURCE      ${usedModel ? "Gemini" : "DETERMINISTIC FALLBACK — provider unavailable"}`);
    console.log(`METRICS     ${JSON.stringify(condition.metrics)}`);
    console.log(`THRESHOLD   ${JSON.stringify(condition.threshold)}`);
    console.log(`SUMMARY     ${narration.summary}`);
    console.log(`RECOMMEND   ${narration.recommendation}`);

    // Automated checks over the real output, so inspection has a starting point.
    const text = `${narration.summary} ${narration.recommendation}`;
    const snapshot = new Set(JSON.stringify({ ...condition.metrics, ...condition.threshold }).match(/\d+(\.\d+)?/g) ?? []);
    const quoted = text.match(/\d+(\.\d+)?/g) ?? [];
    const invented = quoted.filter((n) => !snapshot.has(n));
    const judgemental = BANNED.filter((w) => text.toLowerCase().includes(w));

    if (invented.length) { console.log(`  ⚠ NUMBERS NOT IN SNAPSHOT: ${invented.join(", ")}`); problems++; }
    if (judgemental.length) { console.log(`  ⚠ JUDGEMENTAL LANGUAGE: ${judgemental.join(", ")}`); problems++; }
    if (sent.includes("Arun Verma")) { console.log("  ⚠ NAME WAS SENT UPSTREAM"); problems++; }
    if (!invented.length && !judgemental.length) console.log("  ✓ traceable, neutral");
  }

  console.log("─".repeat(78));
  console.log(problems === 0 ? "\nAll five samples traceable and neutral." : `\n${problems} problem(s) — review above.`);
  process.exit(problems === 0 ? 0 : 1);
}

main();
