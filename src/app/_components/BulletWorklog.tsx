"use client";

/**
 * The worklog entry surface: numbered lines of plain writing, nothing else.
 *
 * ── No dropdowns, on purpose ──────────────────────────────────────────────
 * The form this replaces asked an instructor to choose a category and a
 * deliverable before they could record anything. That is classification work,
 * and it was being asked of the person least interested in doing it, at the
 * moment they were least willing to. Here they write the sentence they would
 * have said out loud, and the classifying happens afterwards, elsewhere.
 *
 * ── Why real lines and not a textarea ─────────────────────────────────────
 * One line is one activity, and that has to be visible while typing rather than
 * explained afterwards. Separate inputs make the boundary literal: Enter starts
 * a new activity, Backspace on an empty line removes it, and the numbers on the
 * left say how many activities are being submitted. A textarea would leave the
 * instructor guessing what the system considers a line.
 *
 * ── The check here is a courtesy, not the rule ────────────────────────────
 * Every line needs a clock range. This form looks for something range-shaped so
 * an obvious omission is caught before a round trip — but it is a hint, and it
 * is deliberately generous. The parser is the authority on what a line actually
 * says, and this must not refuse something the parser would have understood.
 */

import { useRef } from "react";
import { Button, Card, CardBody } from "@/app/_components/ui";

/** Shown once per empty line, in the instructor's own idiom. */
const PLACEHOLDERS = [
  "e.g. Took DSA lecture, 10:00 AM – 11:30 AM",
  "e.g. Lab session for unit 3, 11:30 to 1",
  "e.g. Checked 40 answer sheets, 2pm-4pm",
  "e.g. Met 3 students about projects, 4 to 5",
];

/**
 * Does this line appear to name a start and an end?
 *
 * Deliberately loose. It accepts "10-11", "10:00 AM to 11:30 AM", "2pm-4pm",
 * "from 4 till 5" — and anything else with two clock-ish numbers joined by a
 * word or a dash. Being strict here would reject sentences the parser reads
 * perfectly well, and a form that refuses valid input is worse than one that
 * lets a rare bad line through to a parser that will say so.
 */
export function looksLikeTimeRange(text: string): boolean {
  const t = text.toLowerCase();
  const clock = "\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?";
  const joiner = "\\s*(?:-|–|—|to|till|until|untill)\\s*";
  return new RegExp(`${clock}${joiner}${clock}`).test(t);
}

/** The message the BRD specifies, word for word. */
export const MISSING_TIME_MESSAGE =
  "Please mention the time frame or duration for each activity.";

export type BulletState = { key: string; text: string };

let counter = 0;
export function newBullet(text = ""): BulletState {
  counter += 1;
  return { key: `b${counter}`, text };
}

export function BulletWorklog({
  bullets,
  onChange,
  disabled,
}: {
  bullets: BulletState[];
  onChange: (next: BulletState[]) => void;
  disabled?: boolean;
}) {
  const refs = useRef(new Map<string, HTMLInputElement>());

  const focus = (key: string) => {
    // After React has rendered the new line, not before it exists.
    requestAnimationFrame(() => refs.current.get(key)?.focus());
  };

  const setText = (key: string, text: string) =>
    onChange(bullets.map((b) => (b.key === key ? { ...b, text } : b)));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    const bullet = bullets[index]!;

    if (e.key === "Enter") {
      e.preventDefault();
      const next = newBullet();
      const copy = [...bullets];
      copy.splice(index + 1, 0, next);
      onChange(copy);
      focus(next.key);
      return;
    }

    // Backspace on an already-empty line removes it and returns the cursor to
    // the end of the previous one — the behaviour of every list editor, and the
    // only way to undo an Enter without reaching for the mouse.
    if (e.key === "Backspace" && bullet.text === "" && bullets.length > 1) {
      e.preventDefault();
      const previous = bullets[index - 1] ?? bullets[index + 1]!;
      onChange(bullets.filter((b) => b.key !== bullet.key));
      focus(previous.key);
      return;
    }

    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      focus(bullets[index - 1]!.key);
    }
    if (e.key === "ArrowDown" && index < bullets.length - 1) {
      e.preventDefault();
      focus(bullets[index + 1]!.key);
    }
  };

  return (
    <Card>
      <CardBody className="space-y-2">
        {bullets.map((bullet, index) => {
          const filled = bullet.text.trim() !== "";
          const missingTime = filled && !looksLikeTimeRange(bullet.text);
          return (
            <div key={bullet.key}>
              <div className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="tabular w-6 shrink-0 pt-2 text-right text-sm text-muted"
                >
                  {index + 1}.
                </span>
                <input
                  ref={(el) => {
                    if (el) refs.current.set(bullet.key, el);
                    else refs.current.delete(bullet.key);
                  }}
                  value={bullet.text}
                  disabled={disabled}
                  onChange={(e) => setText(bullet.key, e.target.value)}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  aria-label={`Activity ${index + 1}`}
                  aria-invalid={missingTime || undefined}
                  // The placeholder is the example, and it disappears the moment
                  // there is anything to read instead of it.
                  placeholder={PLACEHOLDERS[index % PLACEHOLDERS.length]}
                  className={`w-full rounded-control border bg-surface px-3 py-2 text-sm text-content outline-none transition placeholder:text-subtle focus:border-primary disabled:opacity-60 ${
                    missingTime ? "border-warning" : "border-line"
                  }`}
                />
              </div>
              {missingTime ? (
                <p className="ml-8 mt-1 text-xs text-warning-text">
                  Add when this started and ended, for example “10:00 AM to 11:30 AM”.
                </p>
              ) : null}
            </div>
          );
        })}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted">
            One activity per line. Press Enter for the next one.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              const next = newBullet();
              onChange([...bullets, next]);
              focus(next.key);
            }}
          >
            + Add line
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * What is wrong with this draft, if anything.
 *
 * Blank lines are not activities — pressing Enter and changing your mind is not
 * an error — so they are dropped rather than reported.
 */
/**
 * The one thing that still stops a submission here: nothing to submit.
 *
 * ── Why a missing time no longer blocks ───────────────────────────────────
 * It used to. `looksLikeTimeRange` is a loose regex over a sentence a person
 * wrote in their own words, and a regex that guesses wrong holds back a line
 * that would have parsed perfectly — while the reader was already going to
 * refuse a genuinely timeless line and say exactly why.
 *
 * More importantly, a refusal shown HERE is a refusal that exists only while
 * the drawer is open. Everything else that can go wrong with a worklog — a day
 * that is not today, a line that overlaps another, a parse that failed — is
 * reported through the notification bell, where it can still be read an hour
 * later. A missing time is the same kind of problem and now travels the same
 * way. The example under an empty-looking line stays, because a hint offered
 * while somebody is still typing is not a refusal.
 */
export function validateBullets(bullets: BulletState[]): {
  ok: boolean;
  message: string | null;
  submit: string[];
} {
  const submit = bullets.map((b) => b.text.trim()).filter((t) => t !== "");

  if (submit.length === 0) {
    return { ok: false, message: "Write at least one activity before submitting.", submit };
  }
  return { ok: true, message: null, submit };
}
