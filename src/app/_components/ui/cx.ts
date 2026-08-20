/**
 * Joins class names, dropping anything falsy.
 *
 * One definition for the whole primitive set. The nine modules of this folder
 * each carried an identical copy after the split — nine chances for one of them
 * to grow a variant that quietly treats `0` or `""` differently from the rest.
 *
 * Not re-exported by `ui/index.ts`: it is how these components are built, not
 * something a screen imports.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
