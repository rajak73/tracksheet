"use client";

/**
 * What an instructor teaches, set in place.
 *
 * ── Why a dropdown in the row and not a dialog ────────────────────────────
 * It is one value from a closed list, reversible in the same control, and it
 * writes an audit row like every other instructor edit. A dialog with a Save
 * button for a single field is ceremony, and ceremony is why fields like this
 * end up unset — which here means a blank column in the sheet the client signs
 * off. Making it a one-click change is the point.
 *
 * ── Shared, so the two directories cannot drift ───────────────────────────
 * Both the staff list and the instructor directory offer this. Two copies would
 * eventually disagree about what "Not set" sends, and one of them would send an
 * empty string the API reads as "leave it alone".
 */

import { useState } from "react";
import { Select } from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";
import { apiSend } from "@/app/_lib/api";

export type InstructorCategory = { code: string; label: string };

export function CategoryPicker({
  instructorId,
  current,
  options,
  onSaved,
}: {
  instructorId: string;
  /** The current code, or `""` when nobody has filed them yet. */
  current: string;
  options: InstructorCategory[];
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async (code: string) => {
    setBusy(true);
    try {
      await apiSend(
        `/api/instructors/${instructorId}`,
        "PATCH",
        // Cleared is an ANSWER, not an omission, so it goes as null. An empty
        // string would be read as "field not sent" and silently change nothing.
        { categoryCode: code === "" ? null : code },
        "Could not save that category.",
      );
      toast("success", code === "" ? "Category cleared." : "Category saved.");
      onSaved();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not save that category.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Select
      aria-label="Broad category"
      value={current}
      disabled={busy || options.length === 0}
      onChange={(e) => void save(e.target.value)}
      className="w-auto min-w-[9rem]"
    >
      <option value="">Not set</option>
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </Select>
  );
}
