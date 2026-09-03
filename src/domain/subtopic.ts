/**
 * When two subtopics are the same thing said twice.
 *
 * ── The rule, and the half of it that matters more ────────────────────────
 * Merge only when two names CLEARLY name the same thing — "AVL trees" and
 * "AVL tree". Never merge a narrower subtopic into a broader one: "AVL trees"
 * and "binary trees" stay separate lines under the same topic, because they
 * were separate sessions and a reader counting sessions would be misled by
 * seeing one.
 *
 * That second half is why this is deliberately dumb. A cleverer comparison —
 * embeddings, stemming a whole phrase, "is X a kind of Y" — is exactly the tool
 * that would fold "AVL trees" into "trees", and there is no version of that
 * mistake a reader can detect from the screen. So the only thing collapsed here
 * is a difference in case, spacing, or a plural on the final word. Anything
 * else stays apart, which is the safe direction to be wrong in: two lines that
 * could have been one is a cosmetic flaw, one line that should have been two is
 * a wrong count.
 */

/** `AVL trees` and `AVL tree` both key to `avl tree`; `binary trees` does not. */
export function subtopicKey(name: string): string {
  const words = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const last = words[words.length - 1]!;
  words[words.length - 1] = singular(last);
  return words.join(" ");
}

/**
 * The final word made singular, conservatively.
 *
 * Short words are left alone: `OS` must not become `o`, and an acronym losing
 * its last letter is a different subject. Nothing here tries to be a stemmer —
 * it undoes a plural and stops.
 */
function singular(word: string): string {
  if (word.length <= 3) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** True when two subtopics are the same thing under different spellings. */
export const sameSubtopic = (a: string, b: string) => subtopicKey(a) === subtopicKey(b);
