"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Signing out must revoke the session on the SERVER. This was previously an
 * `<a href="/login">`, which navigated away while leaving the session cookie
 * fully valid — the user looked signed out but pressing Back returned them to
 * the dashboard, and the cookie kept working until it expired.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // refresh() clears the client router cache so no server-rendered page
      // for the old session is served from memory.
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="text-sm font-medium text-indigo-200 hover:text-white disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign Out"}
    </button>
  );
}
