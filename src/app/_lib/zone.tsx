"use client";

/**
 * What "today" means, everywhere on a screen.
 *
 * ── Why a provider and not a hook that fetches ────────────────────────────
 * Every day boundary on the server is judged in the UNIVERSITY's configured
 * timezone. A screen that asks the browser instead agrees only while the
 * person sits in their university's zone with a correct clock — and when they
 * do not, the form offers a date the server then refuses, telling an instructor
 * they may "only write up today's work" on what their own screen calls today.
 *
 * The zone is already known before any page renders: the layout is a server
 * component holding the principal, so it can resolve the university once and
 * hand it down. That costs no request at all, which is why this is a provider
 * rather than a hook that fetches `/api/auth/me` on every screen that needs it.
 *
 * ── Null is a real value ──────────────────────────────────────────────────
 * An admin belongs to no university, so there is no "their university's today"
 * to give them. Callers fall back to the browser, which for a global role is
 * the honest answer rather than a wrong one.
 */

import { createContext, useContext, type ReactNode } from "react";
import { todayIn, todayISO } from "@/app/_lib/format";

const TimeZoneContext = createContext<string | null>(null);

export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string | null;
  children: ReactNode;
}) {
  return <TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider>;
}

/** The university's IANA zone, or null for a role that belongs to none. */
export function useUniversityZone(): string | null {
  return useContext(TimeZoneContext);
}

/**
 * Today, as the server would judge it for this university.
 *
 * This is what a date field should default to, what a "Today" filter should
 * resolve to, and what a date picker's maximum should be — never `todayISO`,
 * which answers in the browser's zone.
 */
export function useUniversityToday(): string {
  const zone = useUniversityZone();
  return zone ? todayIn(zone) : todayISO();
}
