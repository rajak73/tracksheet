"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, inputClass, Alert } from "@/app/_components/ui";

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
        setError(data.error?.message || "Login failed");
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
      router.push(destination);
    } catch {
      setError("Could not reach the server. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <p className="text-sm font-semibold tracking-tight text-content">Tracksheet</p>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-content">
              Sign in
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              University workforce intelligence.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-content">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-content">Password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-8 text-xs text-subtle">
            Your role and university are determined by your account — there is one sign-in
            for administrators, managers and instructors.
          </p>
        </div>
      </div>
    </div>
  );
}
