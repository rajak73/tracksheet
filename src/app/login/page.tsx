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
  INSTRUCTOR: "/instructor/dashboard",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-2">
      {/* Brand panel. The same navy that carries the sidebar once you are
          inside, so signing in does not feel like crossing between two
          different products. Hidden below `lg`, where a tall decorative
          panel would only push the form off the first screen. */}
      <aside className="relative hidden flex-col justify-between bg-sidebar-bg p-12 lg:flex">
        <div className="flex items-center gap-2.5">
          <svg aria-hidden viewBox="0 0 20 20" className="size-5 text-white" fill="none">
            <rect x="1" y="12" width="4.5" height="7" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="7.75" y="7" width="4.5" height="12" rx="1" fill="currentColor" opacity="0.75" />
            <rect x="14.5" y="1" width="4.5" height="18" rx="1" fill="currentColor" />
          </svg>
          <span className="font-display text-base font-semibold tracking-tight text-white">
            NIAT
          </span>
        </div>

        <div className="max-w-md">
          <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-white">
            University workforce intelligence.
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-sidebar-text-muted">
            Instructor workload, teaching activity, learning hours, utilization and operational
            performance — measured across every university you operate.
          </p>

          <ul className="mt-10 space-y-3">
            {[
              "Multi-university visibility",
              "Workload and utilization analytics",
              "AI insights with supporting evidence",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm text-sidebar-text-muted">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-sidebar-text-muted">
          © {new Date().getFullYear()} NIAT
        </p>
      </aside>

      {/* Form panel. */}
      <div className="flex min-h-screen items-center justify-center px-4 py-12 lg:min-h-0">
        <div className="w-full max-w-sm">
          {/* The wordmark repeats here only on small screens, where the navy
              panel it normally lives in is not rendered. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <svg aria-hidden viewBox="0 0 20 20" className="size-5 text-primary" fill="none">
              <rect x="1" y="12" width="4.5" height="7" rx="1" fill="currentColor" opacity="0.5" />
              <rect x="7.75" y="7" width="4.5" height="12" rx="1" fill="currentColor" opacity="0.75" />
              <rect x="14.5" y="1" width="4.5" height="18" rx="1" fill="currentColor" />
            </svg>
            <span className="font-display text-base font-semibold tracking-tight text-content">
              NIAT
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
            Sign in
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Use the account your institution issued you.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
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
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-8 text-xs leading-relaxed text-subtle">
            Your role and university are determined by your account — there is one sign-in for
            administrators, managers and instructors.
          </p>
        </div>
      </div>
    </div>
  );
}
