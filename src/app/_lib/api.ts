/**
 * The client's side of the API.
 *
 * Every page in the audit repeated the same twenty lines: fetch, check `ok`,
 * pull a message out of the error envelope, set three pieces of state, and
 * remember to clear `loading` in a `finally`. Several got a detail wrong — one
 * left the spinner up forever on a failed request, several surfaced
 * "HTTP 500" to a university administrator.
 *
 * This module does NOT change what is fetched or when (§38). It is the same
 * requests the pages already made, with one implementation of the mechanics.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Errors ────────────────────────────────────────────────────────────── */

/**
 * The server's error envelope is `{ error: { code, message } }`.
 *
 * The server's own message is worth showing when it is about the REQUEST
 * ("endTime must be after startTime" tells you what to change). A status code
 * is not: "HTTP 500" tells a university administrator nothing they can act on,
 * so it becomes generic prose instead (§31, §49).
 */
export async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const message = body?.error?.message;
    if (typeof message === "string" && message.length > 0) return message;
  } catch {
    // Not JSON. Nothing to recover; fall through.
  }
  if (res.status === 401) return "Your session has expired. Please sign in again.";
  if (res.status === 403) return "You do not have access to this information.";
  if (res.status === 404) return "That record could not be found.";
  return fallback;
}

export async function apiGet<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await readError(res, fallback));
  return (await res.json()) as T;
}

export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  fallback: string,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res, fallback));
  return (await res.json().catch(() => ({}))) as T;
}

/* ── Current user ──────────────────────────────────────────────────────── */

export type Me = {
  user: {
    id: string;
    name: string;
    email: string;
    role: "ADMIN" | "MANAGER" | "INSTRUCTOR";
    universityId: string | null;
    instructorId: string | null;
  };
};

/**
 * `/api/auth/me`, fetched at most once per page load.
 *
 * Several components need the caller's university or instructor id, and
 * without this cache each one would issue its own identical request — the
 * duplicate-request problem §38 warns about. The promise is shared, so
 * concurrent callers await the same response.
 */
let mePromise: Promise<Me> | null = null;

export function fetchMe(): Promise<Me> {
  mePromise ??= apiGet<Me>("/api/auth/me", "Could not confirm who you are signed in as.");
  return mePromise;
}

/** Cleared on sign-out so the next session does not read the previous user. */
export function clearMeCache() {
  mePromise = null;
}

/* ── Loading a page ────────────────────────────────────────────────────── */

export type Load<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Runs an async loader and tracks the three states every page needs.
 *
 * `key` is what re-runs it — a period, a selected university. It is a string
 * rather than a dependency array so a caller cannot accidentally re-fetch on
 * every render by passing a fresh object, which is the usual way a redesign
 * turns into a request storm.
 *
 * A result that arrives after the inputs changed is DISCARDED rather than
 * rendered: without that, switching period twice quickly can leave the older,
 * slower response on screen showing numbers for a range nobody selected.
 */
export function useLoad<T>(loader: () => Promise<T>, key: string): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const loaderRef = useRef(loader);
  // Refs are only allowed to change outside render, so the latest loader is
  // synced in its own effect rather than assigned directly in the function
  // body. It runs after every render (no dependency array), ahead of the
  // fetch effect below since effects run in declaration order.
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let live = true;
    // Resetting these here — rather than only from inside the promise — is
    // what makes a period change show a skeleton immediately instead of the
    // previous period's numbers while the new request is in flight.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    loaderRef
      .current()
      .then((result) => {
        if (live) setData(result);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Could not reach the server.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload };
}
