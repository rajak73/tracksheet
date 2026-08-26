import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every colour utility in the app names a token that actually exists.
 *
 * ── The bug this exists for ───────────────────────────────────────────────
 * A card was written as `border border-line-card`. There is no `line-card`
 * token — the theme defines `line`, `line-subtle` and `line-strong` — so
 * Tailwind generated NO class for it, `border` fell back to its default of
 * `currentColor`, and a black box appeared around a white card.
 *
 * Nothing caught it. It is valid TypeScript, valid JSX, valid CSS, and the
 * build succeeds: an unknown utility is silently not emitted rather than being
 * an error. The only signal was the rendered colour, and the only reason it was
 * found is that somebody looked at the screen and said the line was wrong.
 *
 * ── Why it checks families rather than every word ─────────────────────────
 * `border-b`, `border-l-2` and `rounded-card` all look like `<prefix>-<name>`
 * to a regular expression, and none of them names a colour. Flagging those
 * would make this test noise, and a noisy test gets deleted.
 *
 * So it only judges names whose FIRST segment is one this theme actually uses
 * for colours — `line-…`, `primary-…`, `success-…`, `sidebar-…` and the rest.
 * That is exactly the space typos live in: nobody writes `bg-flurble`, they
 * write `border-line-card` when the token is `line`.
 */

const THEME = "src/app/globals.css";
const ROOTS = ["src/app", "src/components"];

/** Colour utilities. `shadow` is excluded: it reads `--shadow-*`, not `--color-*`. */
const PREFIX = "(?:bg|text|border|ring|fill|stroke|divide|outline|decoration|accent|caret|from|via|to)";
/** Tailwind's own side/axis suffixes, which sit between the prefix and the name. */
const SIDE = "(?:-(?:x|y|t|b|l|r|s|e))?";
const UTILITY = new RegExp(`\\b${PREFIX}${SIDE}-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\\/\\d+)?\\b`, "g");

/** `className="…"` and `className={…}` — the only places a utility can take effect. */
const CLASS_ATTR = /className=(?:"([^"]*)"|\{([\s\S]*?)\})/g;

function sourceFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(sourceFiles(path));
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Comments are not markup. The fix for this very bug quotes the typo in one. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

describe("colour utilities name tokens that exist", () => {
  const theme = readFileSync(THEME, "utf8");
  const tokens = new Set([...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]!));

  /* The families this theme owns. A name starting with one of these is meant to
   * be a token, so a near-miss is a typo rather than a Tailwind builtin. */
  const families = new Set([...tokens].map((t) => t.split("-")[0]!));

  test("the theme defines the tokens this test relies on", () => {
    // A guard on the guard: if the token block is ever renamed, this test would
    // otherwise pass by checking nothing at all.
    expect(tokens.size).toBeGreaterThan(20);
    for (const expected of ["line", "primary", "surface", "content", "success"]) {
      expect(families.has(expected), `theme should define a ${expected}-* family`).toBe(true);
    }
  });

  test("no colour utility names a token the theme does not define", () => {
    const offences: string[] = [];

    for (const file of ROOTS.flatMap(sourceFiles)) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const attr of src.matchAll(CLASS_ATTR)) {
        const classes = attr[1] ?? attr[2] ?? "";
        for (const use of classes.matchAll(UTILITY)) {
          const name = use[1]!;
          if (tokens.has(name)) continue;
          // Only judge names inside a family this theme owns — see the header.
          if (!families.has(name.split("-")[0]!)) continue;
          offences.push(`${file}: ${use[0]} — no --color-${name} in ${THEME}`);
        }
      }
    }

    expect(
      offences,
      `A colour utility names a token that does not exist. Tailwind emits NO class for it, so\n` +
        `the element falls back to its default — for \`border\` that is currentColor, which paints\n` +
        `a black line. This is invisible to tsc, eslint and the build.\n\n` +
        offences.join("\n"),
    ).toEqual([]);
  });
});
