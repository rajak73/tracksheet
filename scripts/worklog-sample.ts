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

/**
 * A decision that must still hold, checked rather than eyeballed.
 *
 * `deliverable` is the name the sentence must land on. `quantity` is what the
 * report's quantity column must print for it — `null` meaning the deliverable
 * is never counted, so the column has no entry at all.
 */
type Assertion = { from: string; deliverable: string; quantity?: string | null };

const CASES: Array<{ label: string; expect: string; text: string; must?: Assertion[] }> = [
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
    label: "7. The four taxonomy decisions, in one day",
    expect:
      "Lab Evaluation (Assessment) — NOT 20 of anything; Meeting (Other) for the " +
      "student meeting; Department Duties not Documentation; Data Analysis not Experiment",
    text:
      "Graded the lab practicals for 20 students 9 to 10, " +
      "had the project review meeting with the final year team 10 to 10:30, " +
      "spent the afternoon on the invigilation roster 2 to 3, " +
      "then analysed the experiment data 3 to 4.",
    must: [
      // 20 counts STUDENTS. The unit counts evaluations. Never 20.
      { from: "practicals", deliverable: "Lab Evaluation", quantity: "? Lab Evaluations" },
      // Students in the room, however formal the sentence.
      { from: "project review", deliverable: "Meeting (Other)", quantity: "1 Meeting" },
      // Not a document being written.
      { from: "invigilation", deliverable: "Department Duties", quantity: null },
      // Analysing an experiment is not running one.
      { from: "analysed", deliverable: "Data Analysis", quantity: null },
    ],
  },
  {
    label: "8. Lab evaluation, counted and uncounted",
    expect: "both Assessment — a stated number changes the quantity, never the category",
    text: "Evaluated 8 lab reports 9 to 10, then ran the lab evaluation for section B 11 to 12.",
    must: [
      { from: "8 lab reports", deliverable: "Lab Evaluation", quantity: "8 Lab Evaluations" },
      { from: "section B", deliverable: "Lab Evaluation", quantity: "? Lab Evaluations" },
    ],
  },
  {
    label: "9. Governance meetings stay governance",
    expect: "the department meeting is the only Department Meeting",
    text: "Met a student about their progress 9 to 9:30, then the weekly department meeting 10 to 10:30.",
    must: [
      { from: "student", deliverable: "Meeting (Other)" },
      { from: "department meeting", deliverable: "Department Meeting", quantity: "1 Department Meeting" },
    ],
  },
  {
    label: "10. Research has three different verbs",
    expect: "reading is Literature Review, running is Experiment, analysing is Data Analysis",
    text:
      "Read the recent papers 9 to 10, ran the experiment 10 to 11, " +
      "then worked through the statistical models 11 to 12.",
    must: [
      { from: "papers", deliverable: "Literature Review", quantity: null },
      { from: "ran the experiment", deliverable: "Experiment" },
      { from: "statistical models", deliverable: "Data Analysis", quantity: null },
    ],
  },
  {
    label: "8. One activity only",
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
  const failures: string[] = [];

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
      const { deliverableFor, quantityPhrase } = await import("../src/domain/worklog-taxonomy");
      const chosen = deliverableFor(bullet.deliverableCode, bullet.categoryCode);
      const label = chosen.name;
      /* What the report's quantity column would actually print. A deliverable
       * that is never counted has no entry there at all, which is different
       * from an unknown count and must not be shown as one. */
      const counted = quantityPhrase(chosen, bullet.quantity) ?? "— (hours only)";

      console.log(
        `  ${clock}  ${String(bullet.durationMinutes ?? "—").padStart(4)}m  ` +
          `${counted.padEnd(22)} ${label.padEnd(28)} ` +
          `${bullet.subjectCode ?? "—"}`,
      );
      console.log(`      from: “${bullet.rawText}”`);
      if (bullet.remark) console.log(`      remark: ${bullet.remark}`);
      if (bullet.problem) console.log(`      NOT RECORDED: ${bullet.problem}`);
    }

    /* ── The decisions, checked ────────────────────────────────────────
     * This script used to only print, which meant a taxonomy regression was
     * invisible unless somebody read the output carefully. The classification
     * decisions cannot be asserted in the suite — they are the model's
     * judgement, and a test that needs a live key and silently passes without
     * one is worse than no test — but they CAN be asserted here, where a key
     * is a precondition. A regression now exits non-zero. */
    for (const want of testCase.must ?? []) {
      const bullet = result.bullets.find((b) => b.rawText.toLowerCase().includes(want.from.toLowerCase()));
      const { deliverableFor: resolve, quantityPhrase: phrase } = await import(
        "../src/domain/worklog-taxonomy"
      );
      if (!bullet) {
        failures.push(`${testCase.label}: nothing was read from “${want.from}”`);
        continue;
      }
      const got = resolve(bullet.deliverableCode, bullet.categoryCode);
      if (got.name !== want.deliverable) {
        failures.push(
          `${testCase.label}: “${want.from}” -> ${got.name}, expected ${want.deliverable}`,
        );
      }
      if (want.quantity !== undefined) {
        const printed = phrase(got, bullet.quantity);
        if (printed !== want.quantity) {
          failures.push(
            `${testCase.label}: “${want.from}” quantity prints ${JSON.stringify(printed)}, ` +
              `expected ${JSON.stringify(want.quantity)}`,
          );
        }
      }
    }

    console.log(`\n  Working Hours: ${hhmm(total)}`);
    for (const warning of result.warnings) console.log(`  REVIEW: ${warning.message}`);
    for (const drop of result.dropped ?? []) {
      console.log(`  DROPPED “${drop.rawText}” — ${drop.reason}`);
    }
  }
  console.log("");

  if (failures.length > 0) {
    console.error(`\n${"!".repeat(78)}`);
    console.error(`${failures.length} taxonomy decision(s) no longer hold:\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(`${"!".repeat(78)}\n`);
    process.exitCode = 1;
    return;
  }
  console.log("  Every taxonomy decision still holds.\n");
}

void main();
