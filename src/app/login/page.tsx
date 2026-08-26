"use client";

/**
 * The one login screen (§14).
 *
 * No Admin/Manager/Instructor variants. The destination comes from the ROLE
 * THE SERVER RETURNED — the form never asks, and never trusts, which kind of
 * user this is.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, inputClass } from "@/app/_components/ui";
import { clearMeCache } from "@/app/_lib/api";

const DESTINATION: Record<string, string> = {
  ADMIN: "/admin/dashboard",
  MANAGER: "/manager/dashboard",
  INSTRUCTOR: "/instructor/worklog",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message || "Incorrect email or password.");
        setIsLoading(false);
        return;
      }

      // The destination comes from the role the SERVER returned — the form
      // never asks which kind of user this is.
      const destination = DESTINATION[data.user.role];
      if (!destination) {
        setError("This account has no dashboard assigned. Contact your administrator.");
        setIsLoading(false);
        return;
      }
      clearMeCache();
      router.push(destination);
    } catch {
      setError("Could not reach the server. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    /* ── An ordinary sign-in, on purpose ────────────────────────────────────
     * This was a two-column screen: a navy marketing panel on the left with a
     * headline and three selling points, the form squeezed into the right half.
     * That is a landing page, and the people who reach this URL have already
     * been given an account — they are not being persuaded, they are being let
     * in. The pitch now lives only on the public pages, where it belongs.
     *
     * One centred card, the wordmark above it, nothing else. */
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <svg aria-hidden viewBox="0 0 20 20" className="size-6 text-primary" fill="none">
            <rect x="1" y="12" width="4.5" height="7" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="7.75" y="7" width="4.5" height="12" rx="1" fill="currentColor" opacity="0.75" />
            <rect x="14.5" y="1" width="4.5" height="18" rx="1" fill="currentColor" />
          </svg>
          <span className="font-display text-lg font-semibold tracking-tight text-content">
            NIAT
          </span>
        </div>

        <div className="rounded-card border border-line bg-surface p-7 shadow-card">
          <h1 className="text-xl font-semibold tracking-tight text-content">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the account your institution issued you.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <Field label="Email" required>
              <input
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Password" required>
              {/* ── Show / hide ──────────────────────────────────────────────
                * A password field people cannot read back is where most failed
                * sign-ins come from — a typo in a string you can only see as
                * dots. The eye reveals it.
                *
                * `pr-11` keeps the text from running under the button, and the
                * button is `tabIndex={-1}` so Tab goes Email -> Password ->
                * Sign in rather than detouring through a control that is there
                * for the mouse. */}
              <span className="relative block">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-11`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-muted transition-colors hover:text-content"
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </span>
            </Field>

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? "Signing in\u2026" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-subtle">
          One sign-in for administrators, managers and instructors — your role and university come
          from your account.
        </p>
      </div>
    </div>
  );
}

/* ── The two eye states ──────────────────────────────────────────────────
 * Drawn here rather than pulled from the icon set: this is the only screen
 * that reveals a password, and a one-file component should not add two exports
 * to a shared module for it. */
function Eye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden>
      <path
        d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden>
      <path
        d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a18 18 0 0 1-3.2 4M6.3 8.2A18.4 18.4 0 0 0 2 12s3.6 6.5 10 6.5a9.9 9.9 0 0 0 3.6-.66"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M9.9 10.2a2.75 2.75 0 0 0 3.9 3.86" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
