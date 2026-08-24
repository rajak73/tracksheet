"use client";

/**
 * Page state that survives a refresh, because it lives in the URL.
 *
 * ── Why the URL and not storage ───────────────────────────────────────────
 * Which view somebody is on, which week they paged to, what they searched for
 * — all of it was `useState`, so every refresh threw it away and dropped them
 * back on today's Day view. The URL fixes that, and three other things with
 * it, none of which `sessionStorage` would: the Back button starts working,
 * a link to "Priya's week of the 24th" can be sent to somebody, and two tabs
 * stop fighting over one shared value.
 *
 * ── Why a batch patch rather than a setter per key ────────────────────────
 * Switching view changes four things at once — the view, both dates, and the
 * page number. Four independent setters each read the same snapshot of the
 * query string and each write their own copy of it, so the last one wins and
 * the other three are silently lost. `patch` merges them and writes once,
 * which is the only reason this is a hook over a record rather than a
 * `useQueryParam(key)` used four times.
 *
 * ── Defaults are omitted from the URL ─────────────────────────────────────
 * A value equal to its default is left out, so the address stays readable and
 * `/manager/dashboard` does not become `?view=day&sort=name&search=&page=1`
 * the moment somebody touches anything. It also means the default can change
 * later without every old link pinning the old one.
 */

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useQueryState<T extends Record<string, string>>(
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // `params` is a new object identity on every render, so the keys are what
  // this depends on rather than the object — otherwise every consumer of the
  // returned record re-runs its own memos on every render.
  const serialised = params.toString();

  const values = useMemo(() => {
    const read = new URLSearchParams(serialised);
    const out = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T & string>) {
      const found = read.get(key);
      if (found !== null) out[key] = found as T[keyof T & string];
    }
    return out;
    // `defaults` is a literal at every call site, so a new object each render;
    // depending on it would rebuild this constantly. The KEYS are what matter
    // and they do not change for the life of a page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised]);

  const patch = useCallback(
    (next: Partial<T>) => {
      /* Read from the live URL rather than from `serialised`.
       *
       * Two patches inside one event handler both close over the render's
       * snapshot, so the second would undo the first. `window.location` is
       * whatever the previous `replace` actually put there. */
      const search = new URLSearchParams(
        typeof window === "undefined" ? serialised : window.location.search,
      );
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) continue;
        // Absent means default — see the note above.
        if (value === "" || value === defaults[key]) search.delete(key);
        else search.set(key, String(value));
      }
      const query = search.toString();
      /* `replace`, not `push`: paging a table is not a place somebody wants to
       * walk back through one step at a time. `scroll: false` because this is
       * the same page reading itself differently, and jumping to the top of it
       * on every filter change would be its own bug. */
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, serialised],
  );

  return [values, patch];
}
