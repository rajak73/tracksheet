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
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-hovered hover:text-content disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
