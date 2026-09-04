import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACTIVITY_TYPE_CODES, DELIVERABLE_TYPES } from "../prisma/reference-data";

/**
 * No prompt names a fixed set of work types.
 *
 * ── Why the response scan could never have caught this ────────────────────
 * `no-category-in-responses` walks what the product SAYS and looks for the
 * taxonomy in it. A prompt is not a response. `day-summary.ts` carried a list
 * of work areas for weeks and no response scan could have seen it, because that
 * string was never in one — it went upstream, and what came back was prose
 * shaped by it.
 *
 * The same blind spot produced `CATEGORY_VAR`: sixteen work-type codes mapped
 * to a closed palette in the UI, which no response carried either. A category
 * system does not have to reach a screen to be a category system. It only has
 * to be somewhere a future reader will find it and treat it as the shape of the
 * product.
 *
 * ── Why the closed-set phrasings are here too ─────────────────────────────
 * A prompt can impose a taxonomy without naming one word of it — "choose from
 * the following", "must be one of", "NEVER write a name that is not". Those
 * sentences are the taxonomy's grammar, and a scan that only knew the old names
 * would pass a prompt that reintroduced the idea with new ones.
 *
 * ── Every assertion here is an ABSENCE ────────────────────────────────────
 * Which is the dangerous kind: a walker that finds no files reports absence for
 * everything and goes green forever. So the first test asserts the walk found
 * the prompts it is supposed to be scanning, by name, before any of the rest
 * mean anything.
 */

/** Where prompt text lives. Server-side only: a prompt is never client code. */
const ROOTS = ["src/server/ai", "src/server/insights"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(r)).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

/**
 * Comments are excluded, and that is a deliberate weakening.
 *
 * Every file here explains at length WHY the taxonomy is gone, and those
 * explanations name it — this file does too. Scanning comments would make the
 * rule impossible to document, and a rule nobody may write down is a rule
 * nobody can follow. What ships to the model is the code.
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const CODE = FILES.map((f) => ({ path: f.path, text: withoutComments(f.text) }));

/**
 * Only what is inside a string literal counts.
 *
 * `export const OTHER = "Other"` is an identifier, not a taxonomy — the group
 * with no topic has to be called something, and `OTHER` matching an old
 * activity-type code is a coincidence of spelling. What reaches a model is
 * string content, so that is what is scanned.
 */
function literalsOf(code: string): string {
  return [
    ...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g),
    ...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g),
    ...code.matchAll(/`((?:[^`\\]|\\.)*)`/g),
  ]
    .map((m) => m[1])
    .join("\n");
}

const PROMPT_TEXT = CODE.map((f) => ({ path: f.path, text: literalsOf(f.text) }));

/** The removed vocabulary, in every spelling it ever had. */
const BANNED_NAMES = [
  ...ACTIVITY_TYPE_CODES,
  ...DELIVERABLE_TYPES.map((d) => d.code),
  ...DELIVERABLE_TYPES.map((d) => d.label),
  "Unclassified",
  "broadCategory",
  "Broad Category",
  "instructorCategory",
];

/**
 * The grammar of a closed set, whatever it is filled with.
 *
 * A prompt saying "must be one of" has imposed a taxonomy even when the list
 * that follows is brand new.
 */
const CLOSED_SET_PHRASES = [
  "from this list only",
  "must be one of",
  "NEVER write a name that is not",
  "choose from the following",
  "pick one of",
  "select from the list",
  "one of the following categories",
];

describe("the scan is looking at something", () => {
  test("it found the files that actually carry prompts", () => {
    /* Without this the whole file is vacuous: a walker that returns nothing
       reports absence for every name below and stays green forever. */
    const paths = CODE.map((f) => f.path);
    for (const expected of [
      "src/server/insights/label-day.ts",
      "src/server/insights/group.ts",
      "src/server/insights/extract.ts",
      "src/server/ai/prompts.ts",
    ]) {
      expect(paths, `${expected} was not scanned`).toContain(expected);
    }
    expect(CODE.length).toBeGreaterThan(8);
  });

  test("and it is reading their prompt text, not just their imports", () => {
    const labelDay = PROMPT_TEXT.find((f) => f.path.endsWith("label-day.ts"))!;
    expect(labelDay.text).toContain("Never output a number of any kind");
    // And the grouping's, so the extraction side is not the only one read.
    const group = PROMPT_TEXT.find((f) => f.path.endsWith("group.ts"))!;
    expect(group.text).toContain("Output no numbers of any kind");
  });

  test("the banned vocabulary is not itself empty", () => {
    // If `reference-data` were emptied, every name check below would pass.
    expect(BANNED_NAMES.length).toBeGreaterThan(20);
  });
});

describe("no prompt names a fixed set of work types", () => {
  test("none of the removed names appears in any prompt", () => {
    const found: string[] = [];
    for (const file of PROMPT_TEXT) {
      for (const name of BANNED_NAMES) {
        if (name.length < 4) continue;
        if (file.text.includes(name)) found.push(`${file.path}: ${name}`);
      }
    }
    expect(found, "a removed category name is being sent to a model").toEqual([]);
  });

  test("and none imposes a closed set without naming one", () => {
    const found: string[] = [];
    for (const file of PROMPT_TEXT) {
      for (const phrase of CLOSED_SET_PHRASES) {
        if (file.text.toLowerCase().includes(phrase.toLowerCase())) {
          found.push(`${file.path}: "${phrase}"`);
        }
      }
    }
    expect(found, "a prompt is asking a model to choose from a list").toEqual([]);
  });

  test("nor does one hand a model a JSON array of work types to pick from", () => {
    /* The shape the taxonomy took last time it was in a prompt: an inline
       array of quoted names.
    
       Narrowed to arrays holding a name that WAS a work type. The broad version
       flagged `RECOMMENDATION_SEVERITIES` and `ENTITY_TYPES` — closed sets that
       are not taxonomies of work, and the second of which the assistant needs.
       A check that fires on every list of constants is one somebody turns off. */
    const found: string[] = [];
    for (const file of CODE) {
      for (const m of file.text.matchAll(
        /\[(?:\s*["'][A-Z][A-Z_]{3,}["']\s*,){3,}\s*["'][A-Z][A-Z_]{3,}["']\s*,?\s*\]/g,
      )) {
        if (BANNED_NAMES.some((n) => n.length >= 4 && m[0].includes(`"${n}"`))) {
          found.push(`${file.path}: ${m[0].slice(0, 60)}`);
        }
      }
    }
    expect(found, "a prompt carries a list of codes").toEqual([]);
  });
});
