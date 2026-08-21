/**
 * What an instructor teaches, shown — not set.
 *
 * ── Why this replaced a dropdown ──────────────────────────────────────────
 * This was `CategoryPicker`: an in-row select an admin used to file a person's
 * stream. The client's position is that a stream should not be anybody's
 * opinion — it should follow the work the person actually did. So it is counted
 * from their entries now (see `@/server/instructors/stream`) and there is
 * nothing here to choose.
 *
 * The picker's own comment argued that making it one click was the point,
 * "which here means a blank column in the sheet the client signs off". Worth
 * recording that the ease never helped: every instructor in the database still
 * had it unset when it was removed.
 *
 * ── "Not yet determined", not a dash ──────────────────────────────────────
 * An em dash reads as "not applicable". This is a value the system will supply
 * once there is something to read it from — somebody new, or somebody whose
 * sentences have not named a subject yet — and saying so is the difference
 * between a reader waiting and a reader filing a bug.
 */

import { Badge } from "@/app/_components/ui";

export type InstructorStreamValue = { code: string; label: string } | null;

export function InstructorStream({ stream }: { stream: InstructorStreamValue }) {
  if (!stream) {
    return (
      <span className="text-subtle" title="Read from this instructor's own entries once they name a subject">
        Not yet determined
      </span>
    );
  }
  return <Badge tone="neutral">{stream.label}</Badge>;
}
