"use client";

/**
 * An instructor's Broad Category: shown, and set.
 *
 * ── This has been both things, and the client decided each time ───────────
 * It began as `CategoryPicker`, an in-row select an admin used to file
 * somebody's stream. It became a read-only badge when the client's position was
 * that a stream should follow the work a person actually did rather than an
 * administrator's opinion of it, and the value was counted from their entries.
 *
 * Their rule now is the reverse: the Broad Category on the report is supplied,
 * it must be preserved exactly, and nobody may guess it from somebody's
 * activities. A value that must be supplied needs somebody able to supply it —
 * so the control is back.
 *
 * ── The derived stream is still shown, beside it ──────────────────────────
 * Not as the answer, as evidence. Somebody deciding what to file a person under
 * is exactly who benefits from knowing what that person has actually been
 * teaching for the last ninety days, and it costs a line of muted text to say
 * so. The two are never conflated: one is a control, the other is a hint.
 *
 * ── "Not Provided", in the client's own words ─────────────────────────────
 * Not an em dash, which reads as "not applicable", and no longer "Not yet
 * determined", which promised the system would work it out. Nobody has said
 * yet, and the report prints that.
 */

import { useState } from "react";
import { Badge } from "@/app/_components/ui";
import { NOT_PROVIDED } from "@/domain/worklog-report";

export type InstructorStreamValue = { code: string; label: string } | null;

export type CategoryOption = { code: string; label: string };

/** The badge alone, for a table that does not edit. */
export function InstructorStream({ stream }: { stream: InstructorStreamValue }) {
  if (!stream) {
    return (
      <span className="text-subtle" title="Nobody has assigned a broad category yet">
        {NOT_PROVIDED}
      </span>
    );
  }
  return <Badge tone="neutral">{stream.label}</Badge>;
}

/**
 * The badge, and a way to change it.
 *
 * Saves on change rather than behind a Save button: it is one field, the choice
 * is from a closed list, and there is nothing to review before committing. A
 * failure puts the previous value back and says so, so the row never shows
 * something the database does not hold.
 */
export function InstructorCategoryPicker({
  value,
  options,
  stream,
  onSave,
  disabled,
}: {
  value: InstructorStreamValue;
  options: CategoryOption[];
  /** What their work says, shown as evidence. Never written by this control. */
  stream?: InstructorStreamValue;
  onSave: (code: string | null) => Promise<void>;
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(code: string | null) {
    setSaving(true);
    setError(null);
    try {
      await onSave(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <select
        value={value?.code ?? ""}
        disabled={disabled || saving}
        aria-label="Broad category"
        onChange={(e) => void change(e.target.value === "" ? null : e.target.value)}
        className="h-8 rounded-control border border-line bg-surface px-2 text-sm text-content disabled:opacity-60"
      >
        <option value="">{NOT_PROVIDED}</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="text-xs text-danger-text">{error}</span>
      ) : stream && stream.code !== value?.code ? (
        /* Evidence, not a suggestion to accept with one click: filing somebody
           under what a query counted is the guess the client asked us to stop
           making. It is here so the person deciding has the fact in front of
           them. */
        <span className="text-xs text-subtle">Their work lately: {stream.label}</span>
      ) : null}
    </span>
  );
}
