"use client";

/**
 * Deliverable, and a Quantity section that mirrors it line for line.
 *
 * ── The shape, and why it is this one ─────────────────────────────────────
 * The client's sheet has a Deliverable column and a Deliverable Quantity
 * column, so the form keeps both. What it does NOT keep is the thing that made
 * them dangerous: two free boxes joined by nothing but position, which produced
 * "1, 1, 12, 1, 4, 1, 1, 1, 6" beside nine descriptions and one real day with
 * five descriptions against four numbers.
 *
 * The activities are written once, as bullets. The Quantity section then shows
 * those same bullets back with a number beside each, so the pairing is stated
 * by the person who did the work rather than inferred afterwards — and nobody
 * types their activities twice.
 */
import { useRef } from "react";
import { formatMinutes } from "@/app/_lib/format";

/** What one bullet has beside it. Blank Quantity is not zero — see below. */
export type LineNumbers = { quantity: string; hr: string; min: string };

export const emptyNumbers = (): LineNumbers => ({ quantity: "", hr: "", min: "" });

const BULLET = "• ";

/** The activities, one per line, with the bullet and surrounding space removed. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter((l) => l !== "");
}

/**
 * Which line each parsed activity came from.
 *
 * The numbers are held per LINE INDEX, so a blank line in the middle does not
 * silently shift every quantity below it onto the wrong activity — which is the
 * whole failure this form exists to prevent, arriving through the back door.
 */
export function lineIndexes(text: string): number[] {
  return text
    .split("\n")
    .map((l, i) => ({ i, text: l.replace(/^\s*[•\-*]\s*/, "").trim() }))
    .filter((l) => l.text !== "")
    .map((l) => l.i);
}

const digits = (v: string) => v.replace(/[^0-9]/g, "");
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

export const minutesOf = (n: LineNumbers) => num(n.hr) * 60 + num(n.min);
export const totalMinutesOf = (ns: LineNumbers[]) => ns.reduce((t, n) => t + minutesOf(n), 0);

/** `90` minutes reads as 1h 30m. Applied on blur, and again on the server. */
export function roll(n: LineNumbers): LineNumbers {
  const total = minutesOf(n);
  return { ...n, hr: String(Math.floor(total / 60)), min: String(total % 60) };
}

export function DeliverableFields({
  deliverable,
  numbers,
  onDeliverableChange,
  onNumbersChange,
}: {
  deliverable: string;
  /** Keyed by LINE index, so a number never drifts onto another activity. */
  numbers: Record<number, LineNumbers>;
  onDeliverableChange: (next: string) => void;
  onNumbersChange: (next: Record<number, LineNumbers>) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const indexes = lineIndexes(deliverable);
  const lines = parseLines(deliverable);

  const at = (i: number) => numbers[i] ?? emptyNumbers();
  const set = (i: number, patch: Partial<LineNumbers>) =>
    onNumbersChange({ ...numbers, [i]: { ...at(i), ...patch } });

  /** Enter continues the list rather than dropping out of it. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const next = `${deliverable.slice(0, start)}\n${BULLET}${deliverable.slice(el.selectionEnd)}`;
    onDeliverableChange(next);
    requestAnimationFrame(() => {
      const caret = start + 1 + BULLET.length;
      area.current?.setSelectionRange(caret, caret);
    });
  };

  /** The first bullet appears as soon as somebody starts writing. */
  const onFocus = () => {
    if (deliverable === "") onDeliverableChange(BULLET);
  };

  const numberCell =
    "w-full rounded-control border border-line bg-surface px-2 py-1.5 text-right text-sm text-content focus:border-primary focus:outline-none";

  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-content">Deliverable</span>
        <span className="mb-1.5 block text-xs text-muted">
          One activity per bullet. Press Enter for the next one.
        </span>
        <textarea
          ref={area}
          rows={5}
          value={deliverable}
          onFocus={onFocus}
          onChange={(e) => onDeliverableChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`${BULLET}Live class on binary search\n${BULLET}Doubt clearing session`}
          className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-content placeholder:text-subtle focus:border-primary focus:outline-none"
        />
      </label>

      <div className="block">
        <span className="mb-1.5 block text-sm font-semibold text-content">Deliverable Quantity</span>
        <span className="mb-1.5 block text-xs text-muted">
          How many of each, and how long. Leave a number blank if you did not count it.
        </span>

        {lines.length === 0 ? (
          /* Nothing to number yet. Said plainly rather than shown as an empty
             table, which would look like something failed to load. */
          <p className="rounded-control border border-dashed border-line px-3 py-3 text-sm text-subtle">
            Write an activity above and it appears here.
          </p>
        ) : (
          <div className="space-y-1">
            <div className="flex gap-2 pl-1 text-xs font-medium text-muted">
              <span className="flex-1">Activity</span>
              <span className="w-20 text-right">Quantity</span>
              <span className="w-14 text-right">Hr</span>
              <span className="w-14 text-right">Min</span>
            </div>
            {lines.map((line, position) => {
              const index = indexes[position]!;
              const n = at(index);
              return (
                <div key={index} className="flex items-center gap-2">
                  {/* The activity as written, not re-typed. Read-only: this is a
                      reflection of the box above, and editing it in two places
                      is how the two drift apart. */}
                  <span className="flex-1 truncate rounded-control bg-canvas px-2 py-1.5 text-sm text-content">
                    {line}
                  </span>
                  <input
                    inputMode="numeric"
                    aria-label={`Quantity for ${line}`}
                    value={n.quantity}
                    onChange={(e) => set(index, { quantity: digits(e.target.value) })}
                    className={`w-20 ${numberCell}`}
                  />
                  {(["hr", "min"] as const).map((field) => (
                    <input
                      key={field}
                      inputMode="numeric"
                      aria-label={`${field === "hr" ? "Hours" : "Minutes"} for ${line}`}
                      value={n[field]}
                      onChange={(e) => set(index, { [field]: digits(e.target.value) })}
                      onBlur={() => set(index, roll(at(index)))}
                      className={`w-14 ${numberCell}`}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between border-t border-line-subtle pt-2">
        <span className="text-sm font-semibold text-content">Working Hours</span>
        <span className="tabular text-sm text-content">
          {formatMinutes(totalMinutesOf(indexes.map((i) => at(i))))}
          {/* Calculated, and not sent. The server adds the rows up itself, so a
              payload cannot claim a total the activities do not support. */}
          <span className="ml-2 text-xs text-muted">calculated</span>
        </span>
      </div>
    </>
  );
}
