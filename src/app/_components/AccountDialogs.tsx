"use client";

/**
 * The account dialogs: who you are, and the two things you can change about it.
 *
 * ── One account menu, not two ─────────────────────────────────────────────
 * `AppShell` already owns the product's profile control — in the sidebar on
 * desktop, in the header on mobile. These dialogs are mounted BY that shell and
 * opened from it, so there is exactly one place a person goes to change their
 * account, on every page and in every role. An earlier draft put a second
 * profile chip on the instructor dashboard itself; two profile menus on one
 * screen is a duplicate control, not a feature.
 *
 * ── Profile and password are two dialogs, not one with tabs ──────────────
 * They were one dialog with a tab strip, back when the account menu was a flat
 * list and the tabs finished the choice the menu had only started. The menu now
 * picks between them under "Account", so a strip offering both would be the
 * same decision asked twice — and would put "Change password" in front of
 * somebody who came to edit their name.
 * ── What it cannot change ─────────────────────────────────────────────────
 * Email is shown and disabled, and there is no control for role, instructor id,
 * university or permissions. The server has no field for them on these routes
 * either: the control's absence and the API's absence are the same decision,
 * made twice on purpose.
 */

import { useState } from "react";
import { Alert, Button, Field, inputClass } from "@/app/_components/ui";
import { Dialog } from "@/app/_components/interactive";
import { apiGet, apiSend } from "@/app/_lib/api";
import { useEffect } from "react";

export type MyProfile = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  /** Set by an administrator; shown in the account menu, never editable here. */
  employeeCode: string | null;
};

/** Matches the server's cap, so an over-sized file is refused before upload. */
const MAX_AVATAR_BYTES = 256 * 1024;
const ACCEPTED_IMAGE = ["image/png", "image/jpeg", "image/webp"];

/** Initials, for when there is no picture. Never a generated cartoon. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * The person's picture, or their initials.
 *
 * `alt=""` because the name is always rendered beside it — announcing it twice
 * is noise for a screen reader, not information.
 */
export function Avatar({
  name,
  avatarUrl,
  size = 40,
  className = "",
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
  className?: string;
}) {
  const dimension = { width: size, height: size };
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        style={dimension}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={dimension}
      className={`flex shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        className || "bg-primary-subtle text-primary-text"
      }`}
    >
      {initialsOf(name) || "?"}
    </span>
  );
}

/**
 * The account dialog: whichever half the menu asked for, and only that one.
 *
 * ── Why the tab bar is gone ───────────────────────────────────────────────
 * These two used to open as one dialog with a Profile / Change password tab
 * strip, so either entry landed on a screen offering both. That made sense
 * while the menu was a flat list — the tabs were the second half of the choice.
 * The menu now makes the choice itself, under "Account", so the strip repeated
 * a decision that had already been taken and put "Change password" in front of
 * somebody who asked to edit their name.
 *
 * `initialTab` is still the name of the parameter because it is still what the
 * caller passes; it now selects the dialog outright rather than its first tab.
 */
export function AccountDialog({
  open,
  initialTab,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialTab: "profile" | "password";
  profile: MyProfile | null;
  onClose: () => void;
  onSaved: (profile: MyProfile) => void;
}) {
  if (!open) return null;

  return initialTab === "profile" ? (
    <ProfileSettingsDialog open profile={profile} onClose={onClose} onSaved={onSaved} />
  ) : (
    <ChangePasswordDialog open onClose={onClose} />
  );
}

/* ── Profile settings ─────────────────────────────────────────────────────── */

function ProfileSettingsDialog({
  open,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean;
  profile: MyProfile | null;
  onClose: () => void;
  onSaved: (profile: MyProfile) => void;
}) {
  // Seeded from the profile at MOUNT. The parent remounts this component every
  // time it opens, so these initialisers are the reset.
  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatarUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pickImage = async (file: File) => {
    setError(null);
    if (!ACCEPTED_IMAGE.includes(file.type)) {
      setError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(`That image is ${Math.round(file.size / 1024)}KB. The limit is ${MAX_AVATAR_BYTES / 1024}KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(String(reader.result));
    reader.onerror = () => setError("That image could not be read.");
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ profile: MyProfile }>(
        "/api/me/profile",
        "PATCH",
        { name: name.trim(), phone: phone.trim() || null, avatarUrl },
        "Your profile could not be saved.",
      );
      onSaved(res.profile);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your profile could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <SuccessDialog
        open={open}
        title="Profile updated successfully!"
        description="Your profile has been updated."
        onClose={onClose}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Profile settings"
      description="Your name, picture and contact number. Your email address is managed by your administrator."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || name.trim() === ""}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex items-center gap-4">
          <Avatar name={profile?.name ?? ""} avatarUrl={avatarUrl} size={64} />
          <div className="space-y-2">
            <label className="block">
              <span className="sr-only-text">Profile photo</span>
              <input
                type="file"
                accept={ACCEPTED_IMAGE.join(",")}
                className={inputClass}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void pickImage(file);
                }}
              />
            </label>
            <p className="text-xs text-muted">
              PNG, JPEG or WebP, under {MAX_AVATAR_BYTES / 1024}KB.
              {avatarUrl ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setAvatarUrl(null)}
                  >
                    Remove photo
                  </button>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <Field label="Full name" required>
          <input className={inputClass} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Mobile number" hint="Optional">
          <input
            className={inputClass}
            value={phone}
            maxLength={32}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        <Field label="Email" hint="Set by your administrator and cannot be changed here">
          <input className={inputClass} value={profile?.email ?? ""} disabled readOnly />
        </Field>
      </div>
    </Dialog>
  );
}

/* ── Change password ──────────────────────────────────────────────────────── */

/** Mirrors the server's `MIN_PASSWORD_LENGTH`, so the two cannot disagree. */
const MIN_PASSWORD = 12;

function ChangePasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Empty at mount, and the parent remounts on every open — so a password never
  // lingers in component state after the dialog is closed.
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const problem =
    current === ""
      ? "Enter your current password."
      : next.length < MIN_PASSWORD
        ? `The new password must be at least ${MIN_PASSWORD} characters.`
        : next === current
          ? "The new password must be different from your current one."
          : confirm !== next
            ? "The new passwords do not match."
            : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(
        "/api/me/password",
        "POST",
        { currentPassword: current, newPassword: next, confirmPassword: confirm },
        "Your password could not be changed.",
      );
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your password could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <SuccessDialog
        open={open}
        title="Password changed successfully!"
        description="Your password has been updated. Any other devices signed in as you have been signed out."
        onClose={onClose}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change password"
      description="You will stay signed in here. Every other session is ended."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || problem !== null}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Field label="Current password" required>
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" required hint={`At least ${MIN_PASSWORD} characters`}>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password" required>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>

        {/* Shown rather than only disabling the button, so it is clear WHY the
            form is not ready. */}
        {problem && (current || next || confirm) ? (
          <p className="text-xs text-muted">{problem}</p>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ── Shared success modal ─────────────────────────────────────────────────── */

export function SuccessDialog({
  open,
  title,
  description,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title=""
      footer={
        <Button onClick={onClose} className="w-full sm:w-auto">
          OK
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle text-2xl text-success-text"
        >
          ✓
        </span>
        <p className="text-base font-semibold text-content">{title}</p>
        <p className="text-sm text-muted">{description}</p>
      </div>
    </Dialog>
  );
}

/** Loads the signed-in user's own profile. */
export function useMyProfile() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  useEffect(() => {
    void apiGet<{ profile: MyProfile }>("/api/me/profile", "Could not load your profile.")
      .then((r) => setProfile(r.profile))
      .catch(() => setProfile(null));
  }, []);
  return { profile, setProfile };
}
