/**
 * Shared UI primitives.
 *
 * One definition per pattern. A page that needs a button imports one rather
 * than describing one — that is what keeps this looking like one product built
 * by one team rather than fourteen pages built in sequence.
 *
 * Colours are semantic tokens (`bg-surface`, `text-muted`) from globals.css,
 * never raw palette steps, so light and dark cannot drift apart one component
 * at a time. Radii are role-named (`rounded-control`, `rounded-card`,
 * `rounded-chip`) for the same reason: a card and a button should not be able
 * to disagree about how round things are.
 *
 * Nothing here computes a business number. Components take values the server
 * calculated and render them; the only derived thing is TONE — which colour a
 * number wears — and those bands live in one place rather than being
 * re-decided per screen.
 *
 * ── Why this is a barrel ──────────────────────────────────────────────────
 * This was one 1,160-line file holding twenty-odd unrelated components, which
 * meant every screen that wanted a `<Button>` opened a module containing the
 * table renderer, the skeletons and the tone bands. Seventy-four files import
 * from `@/app/_components/ui`, so the split is behind this re-export: the
 * modules are readable on their own and not one import site had to change.
 */

export * from "@/app/_components/ui/scaffolding";
export * from "@/app/_components/ui/surfaces";
export * from "@/app/_components/ui/buttons";
export * from "@/app/_components/ui/forms";
export * from "@/app/_components/ui/feedback";
export * from "@/app/_components/ui/skeletons";
export * from "@/app/_components/ui/status";
export * from "@/app/_components/ui/data";
export * from "@/app/_components/ui/tables";
