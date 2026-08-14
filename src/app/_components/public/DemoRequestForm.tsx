"use client";

/**
 * The demo-request / contact form.
 *
 * INTEGRATION STATUS — READ BEFORE EDITING
 *
 * This repository has no contact or demo endpoint (`/api/contact` does not
 * exist), so the form cannot actually deliver anything yet. Rather than fake
 * a success screen for a message that was never sent — which is the worst
 * possible outcome for a form a prospective customer fills in — submission is
 * gated behind `DEMO_ENDPOINT`:
 *
 *   - `null` (today): the form validates fully and then tells the visitor
 *     plainly that submission is not yet wired up.
 *   - a path (once built): the same code POSTs to it with proper loading,
 *     success and error states. Nothing else has to change.
 *
 * Everything else — field structure, validation, the three result states — is
 * complete and is the part that would otherwise need rebuilding later.
 */

import { useState } from "react";
import { Alert, Button, Field, Select, inputClass } from "@/app/_components/ui";

/** Set to e.g. "/api/contact" once a receiving endpoint exists. */
const DEMO_ENDPOINT: string | null = null;

type Values = {
  name: string;
  email: string;
  organization: string;
  institution: string;
  role: string;
  message: string;
};

const EMPTY: Values = {
  name: "",
  email: "",
  organization: "",
  institution: "",
  role: "",
  message: "",
};

const ROLES = [
  "University administrator",
  "Operations / workforce manager",
  "Academic leadership",
  "IT / systems",
  "Instructor",
  "Other",
];

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent" }
  | { kind: "error"; message: string }
  | { kind: "not-connected" };

export function DemoRequestForm() {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    // Clearing on edit rather than re-validating on every keystroke: an error
    // that reappears while you are still fixing it reads as nagging.
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const next: Partial<Record<keyof Values, string>> = {};
    if (!values.name.trim()) next.name = "Enter your name.";
    if (!values.email.trim()) {
      next.email = "Enter your work email.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
      next.email = "Enter a valid email address.";
    }
    if (!values.organization.trim()) next.organization = "Enter your organization.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    if (DEMO_ENDPOINT === null) {
      setStatus({ kind: "not-connected" });
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      const res = await fetch(DEMO_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: "We couldn't send your request just now. Please try again.",
        });
        return;
      }
      setValues(EMPTY);
      setStatus({ kind: "sent" });
    } catch {
      setStatus({
        kind: "error",
        message: "We couldn't reach the server. Please check your connection and try again.",
      });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="rounded-card border border-line bg-surface p-8">
        <h2 className="text-xl font-semibold text-content">Thanks — we&rsquo;ve got it.</h2>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Someone from the NEXTWAVE team will be in touch shortly to arrange your demo.
        </p>
        <Button
          variant="secondary"
          className="mt-6"
          onClick={() => setStatus({ kind: "idle" })}
        >
          Send another request
        </Button>
      </div>
    );
  }

  const submitting = status.kind === "submitting";

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="rounded-card border border-line bg-surface p-6 sm:p-8"
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Name" required error={errors.name}>
          <input
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            autoComplete="name"
            aria-invalid={Boolean(errors.name)}
            className={inputClass}
          />
        </Field>

        <Field label="Work email" required error={errors.email}>
          <input
            type="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            className={inputClass}
          />
        </Field>

        <Field label="Organization" required error={errors.organization}>
          <input
            value={values.organization}
            onChange={(e) => set("organization", e.target.value)}
            autoComplete="organization"
            aria-invalid={Boolean(errors.organization)}
            className={inputClass}
          />
        </Field>

        <Field
          label="University / institution"
          hint="Optional — if different from your organization."
        >
          <input
            value={values.institution}
            onChange={(e) => set("institution", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Your role" hint="Optional." className="sm:col-span-2">
          <Select value={values.role} onChange={(e) => set("role", e.target.value)}>
            <option value="">Select a role…</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="What would you like to see?"
          hint="Optional — the more specific, the more useful the demo."
          className="sm:col-span-2"
        >
          <textarea
            rows={4}
            value={values.message}
            onChange={(e) => set("message", e.target.value)}
            className={`${inputClass} resize-y`}
          />
        </Field>
      </div>

      {status.kind === "error" ? (
        <div className="mt-6">
          <Alert tone="danger">{status.message}</Alert>
        </div>
      ) : null}

      {status.kind === "not-connected" ? (
        <div className="mt-6">
          <Alert tone="info" title="This form isn't connected yet">
            Your details passed validation, but demo requests aren&rsquo;t wired to a backend on
            this deployment, so nothing was sent. Please reach out through your usual NEXTWAVE
            contact in the meantime.
          </Alert>
        </div>
      ) : null}

      <div className="mt-7 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Request a Demo"}
        </Button>
        <p className="text-xs text-subtle">Required fields are marked with an asterisk.</p>
      </div>
    </form>
  );
}
