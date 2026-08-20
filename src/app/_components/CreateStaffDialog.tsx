"use client";

/**
 * Adding one person.
 *
 * ── Why this is a shared component ────────────────────────────────────────
 * It lived inside the staff directory, which is the one admin screen not in
 * the sidebar — so from the Managers list and the Instructors list, the only
 * route to a single new account was the bulk CSV importer. That is a
 * spreadsheet, a column mapping and a preview, for one person.
 *
 * ── It calls the provisioning endpoints, it does not add a third ──────────
 * A manager goes to `POST /api/universities/[id]/managers`, an instructor to
 * `POST /api/instructors`. Both already exist, both already audit, and the
 * first manager in a university is already promoted to primary by the one it
 * calls. A dialog is a form over those, never a second way to create a person.
 *
 * ── The password ──────────────────────────────────────────────────────────
 * There is no mail transport in this system, so there is no invitation link.
 * The account is usable immediately and the initial password travels out of
 * band — which is stated in the dialog rather than left to be discovered. The
 * plaintext lives in this component's state for exactly as long as the request
 * takes, is cleared on success, and is never rendered back.
 */

import { useState } from "react";
import { Button, Field, Select, inputClass } from "@/app/_components/ui";
import { Dialog, useToast } from "@/app/_components/interactive";
import { apiSend } from "@/app/_lib/api";

export type CreatableUniversity = { id: string; name: string };

export function CreateStaffDialog({
  open,
  universities,
  role: lockedRole,
  onClose,
  onCreated,
}: {
  open: boolean;
  universities: CreatableUniversity[];
  /**
   * Fixes the role and hides the chooser.
   *
   * The Managers list and the Instructors list each know what they are adding,
   * so asking again is a question with one right answer — and a chance to get
   * it wrong. The staff directory covers both and leaves the choice in.
   */
  role?: "MANAGER" | "INSTRUCTOR";
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    role: lockedRole ?? "INSTRUCTOR",
    name: "",
    email: "",
    employeeCode: "",
    universityId: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const universityId = form.universityId || universities[0]?.id || "";

  async function submit() {
    setFormError(null);
    if (!form.name.trim() || !form.email.trim()) {
      setFormError("Name and email are required.");
      return;
    }
    if (form.password.length < 12) {
      setFormError("The initial password must be at least 12 characters.");
      return;
    }
    if (!universityId) {
      setFormError("Select a university.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        email: form.email.trim(),
        name: form.name.trim(),
        password: form.password,
        ...(form.employeeCode.trim() ? { employeeCode: form.employeeCode.trim() } : {}),
      };
      // Two existing provisioning endpoints, reused as-is rather than a third.
      if (form.role === "MANAGER") {
        await apiSend(
          `/api/universities/${universityId}/managers`,
          "POST",
          payload,
          "Could not create this manager.",
        );
      } else {
        await apiSend(
          "/api/instructors",
          "POST",
          { ...payload, universityId },
          "Could not create this instructor.",
        );
      }
      toast("success", `${form.name.trim()} was created. Share the password out of band.`);
      // Cleared immediately: the plaintext lives in this component's state for
      // exactly as long as the request takes, and is never rendered back.
      setForm({ role: lockedRole ?? "INSTRUCTOR", name: "", email: "", employeeCode: "", universityId: "", password: "" });
      onCreated();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not create this employee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={lockedRole === "MANAGER" ? "Add a manager" : lockedRole === "INSTRUCTOR" ? "Add an instructor" : "Add an employee"}
      description="Creates the account immediately. There is no invitation email in this system, so the initial password must be shared out of band."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Creating…" : lockedRole === "MANAGER" ? "Create manager" : lockedRole === "INSTRUCTOR" ? "Create instructor" : "Create employee"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {lockedRole ? null : (
            <Field label="Role" required>
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as "MANAGER" | "INSTRUCTOR" })}
              >
                <option value="INSTRUCTOR">Instructor</option>
                <option value="MANAGER">Manager</option>
              </Select>
            </Field>
          )}
          <Field label="University" required>
            <Select
              value={universityId}
              onChange={(e) => setForm({ ...form, universityId: e.target.value })}
            >
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Full name" required>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Employee ID" hint="Optional.">
            <input
              value={form.employeeCode}
              onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Initial password" hint="At least 12 characters." required>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>
        {formError ? (
          <p className="text-sm text-danger-text" role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
