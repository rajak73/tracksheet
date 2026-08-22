/**
 * Reads six real worklogs with the real model, and prints what it made of them.
 *
 * ── Why this is a script and not a test ───────────────────────────────────
 * The same reason `ai:sample` is. It needs a real API key, and a test that
 * silently passes without one is worse than no test — it reports green for a
 * feature that is not running. The deterministic half of this feature (what is
 * accepted, what is refused, what the figures are) is covered by
 * `tests/worklog-narrative.test.ts` and needs no provider at all. What only a
 * live call can show is whether the model finds every activity in a messy
 * paragraph, and that is what this prints for a person to read.
 *
 * The cases are the client's own, from the specification.
 *
 *   npm run worklog:sample
 */
import { config as loadEnv } from "dotenv";

/* Loaded before anything that reads it. The taxonomy comes from the database,
 * and `import` runs ahead of every statement in a module body — so a static
 * import of it would construct the Prisma client before this line, and fail on
 * a DATABASE_URL that is sitting right there in the file. The imports are
 * therefore inside `main`. */
loadEnv({ path: ".env", quiet: true });

const CASES: Array<{ label: string; expect: string; text: string }> = [
  {
    label: "1. Written out properly",
    expect: "five activities, 05h 15m",
    text:
      "9 AM to 11 AM took DSA lecture on binary trees for Section A. " +
      "From 11:15 AM to 12 PM conducted a doubt clearing session. " +
      "From 1 PM to 2 PM checked 12 assignments. " +
      "From 3:15 PM to 4 PM prepared slides for next week's class. " +
      "4:30 PM to 5:15 PM attended a faculty coordination meeting.",
  },
  {
    label: "2. Shorthand",
    expect: "four activities, 05h 00m, 20 copies",
    text: "took os class 9-11 then checked 20 copies 12-1, meeting 2-3, prep for tomorrow 3-4",
  },
  {
    label: "3. Two languages at once",
    expect: "four activities, quantities 15 and 10",
    text:
      "Morning me section B ka DBMS lecture liya 9 se 11, uske baad 15 students ke doubts " +
      "clear kiye 11:15 to 12. 10 project submissions review kiye 1 PM to 2 PM. " +
      "Faculty meeting me 2:30 to 3 spent kiye.",
  },
  {
    label: "4. No times given",
    expect: "two activities, NO hours invented",
    text: "Worked on preparing tomorrow's lecture material and reviewed student projects.",
  },
  {
    label: "5. Overlapping times",
    expect: "flagged, and the day holds 2h — not 3h",
    text: "Lecture 9:00 AM to 11:00 AM, assignment review 10:30 AM to 11:30 AM.",
  },
  {
    label: "6. No count stated — the client's `?` case",
    expect: "Assignment Evaluation with an UNKNOWN count, and 1 Department Meeting",
    text:
      "Spent the morning grading assignments from the last batch 9 to 11. " +
      "Also sat through the department meeting 2:15 to 3.",
  },
  {
    label: "7. One activity only",
    expect: "one activity — a paragraph is not always several",
    text: "Took a DBMS lecture on normalisation for section B from 10 AM to 11:30 AM.",
  },
];

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}h ${String(minutes % 60).padStart(2, "0")}m`;

async function main() {
  const { isGeminiConfigured } = await import("../src/server/ai/gemini");
  const { loadTaxonomy } = await import("../src/server/worklog/taxonomy");
  const { parseNarrative } = await import("../src/server/worklog/narrative");

  if (!isGeminiConfigured()) {
    console.error("GEMINI_API_KEY is not set. Nothing to sample — this needs a real key.");
    process.exitCode = 1;
    return;
  }

  const taxonomy = await loadTaxonomy();

  for (const testCase of CASES) {
    const startedAt = Date.now();
    const result = await parseNarrative(testCase.text, taxonomy);

    console.log(`\n${"─".repeat(78)}`);
    console.log(`${testCase.label}   (${Date.now() - startedAt}ms)`);
    console.log(`  expected: ${testCase.expect}`);
    console.log(`  wrote:    ${testCase.text}`);
    console.log("");

    if (!result.ok) {
      console.log(`  COULD NOT READ IT — ${result.reason}`);
      continue;
    }

    let total = 0;
    for (const bullet of result.bullets) {
      total += bullet.durationMinutes ?? 0;
      const clock =
        bullet.startLocal && bullet.endLocal
          ? `${bullet.startLocal}–${bullet.endLocal}`
          : "  no time  ";
      const { deliverableFor } = await import("../src/domain/worklog-taxonomy");
      const label = deliverableFor(bullet.deliverableCode, bullet.categoryCode).name;

      console.log(
        `  ${clock}  ${String(bullet.durationMinutes ?? "—").padStart(4)}m  ` +
          `x${String(bullet.quantity ?? "?").padEnd(3)} ${label.padEnd(28)} ` +
          `${bullet.subjectCode ?? "—"}`,
      );
      console.log(`      from: “${bullet.rawText}”`);
      if (bullet.remark) console.log(`      remark: ${bullet.remark}`);
      if (bullet.problem) console.log(`      NOT RECORDED: ${bullet.problem}`);
    }

    console.log(`\n  Working Hours: ${hhmm(total)}`);
    for (const warning of result.warnings) console.log(`  REVIEW: ${warning.message}`);
    for (const drop of result.dropped ?? []) {
      console.log(`  DROPPED “${drop.rawText}” — ${drop.reason}`);
    }
  }
  console.log("");
}

void main();
