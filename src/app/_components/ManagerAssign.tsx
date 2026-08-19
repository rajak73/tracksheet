"use client";

/**
 * Assigning an instructor to a manager, from a list row.
 *
 * ── Why the manager list loads lazily ──────────────────────────────────────
 * The admin instructor directory spans every university, so eagerly fetching
 * each row's candidate managers would be one request per row. Instead the
 * options load on first interaction and are cached per university for the life
 * of the page — a directory of fifty instructors across three universities
 * makes three requests, not fifty.
 *
 * ── Why it never changes anything silently ─────────────────────────────────
 * The select is optimistic about nothing: it shows a pending state, and on
 * failure it puts the previous value back and says why. An assignment that
 * appears to have happened but did not is worse than a visible error, because
 * the roster is what every manager-scoped report is built from.
 */

import { useCallback, useState } from "react";
import { Select } from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";
import { apiGet, apiSend } from "@/app/_lib/api";

export type AssignableManager = {
  id: string;
  employeeCode: string | null;
  user: { name: string; isActive: boolean };
};

/** Cache shared by every row on the page: universityId → its managers. */
type ManagerCache = Map<string, AssignableManager[]>;

export function useManagerCache(): ManagerCache {
  // A lazily-created Map held in state: stable across renders, and never read
  // during render the way a ref would be.
  const [cache] = useState<ManagerCache>(() => new Map());
  return cache;
}

export function ManagerAssign({
  instructorId,
  universityId,
  current,
  cache,
  onChanged,
}: {
  instructorId: string;
  universityId: string;
  /** Null when nobody leads this instructor yet. */
  current: { id: string; name: string } | null;
  cache: ManagerCache;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [managers, setManagers] = useState<AssignableManager[] | null>(
    cache.get(universityId) ?? null,
  );
  const [value, setValue] = useState(current?.id ?? "");
  const [busy, setBusy] = useState(false);

  const loadManagers = useCallback(async () => {
    if (managers) return;
    const cached = cache.get(universityId);
    if (cached) {
      setManagers(cached);
      return;
    }
    try {
      const { managers: list } = await apiGet<{ managers: AssignableManager[] }>(
        `/api/universities/${universityId}/managers`,
        "Could not load managers.",
      );
      cache.set(universityId, list);
      setManagers(list);
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not load managers.");
    }
  }, [managers, cache, universityId, toast]);

  const assign = useCallback(
    async (next: string) => {
      const previous = value;
      setValue(next);
      setBusy(true);
      try {
        await apiSend(
          `/api/instructors/${instructorId}/manager`,
          "PATCH",
          { managerId: next === "" ? null : next },
          "Could not change the manager.",
        );
        const name = managers?.find((m) => m.id === next)?.user.name;
        toast("success", next === "" ? "Instructor unassigned." : `Assigned to ${name ?? "manager"}.`);
        onChanged?.();
      } catch (e) {
        // Put the old value back: the roster must never *look* changed when it
        // is not.
        setValue(previous);
        toast("danger", e instanceof Error ? e.message : "Could not change the manager.");
      } finally {
        setBusy(false);
      }
    },
    [value, instructorId, managers, toast, onChanged],
  );

  return (
    <Select
      aria-label="Manager"
      value={value}
      disabled={busy}
      onFocus={loadManagers}
      onMouseDown={loadManagers}
      onChange={(e) => void assign(e.target.value)}
      className="w-full min-w-[11rem] text-sm"
    >
      {/* Always present so "Unassigned" is a real, selectable state rather than
          an absence the reader has to infer. */}
      <option value="">Unassigned</option>
      {/* Before the list loads, the current manager still needs a matching
          option or the select would render blank and look unassigned. */}
      {!managers && current ? <option value={current.id}>{current.name}</option> : null}
      {managers?.map((m) => (
        <option key={m.id} value={m.id}>
          {m.user.name}
          {m.employeeCode ? ` (${m.employeeCode})` : ""}
          {m.user.isActive ? "" : " — deactivated"}
        </option>
      ))}
    </Select>
  );
}
