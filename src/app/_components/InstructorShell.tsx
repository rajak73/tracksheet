"use client";

/**
 * The instructor's chrome: a top bar, and nothing else.
 *
 * ── Why this is not `AppShell` ────────────────────────────────────────────
 * Admin and manager navigate — between universities, rosters, analytics, audit
 * — so they get a sidebar. An instructor does one thing: record and read their
 * own workload. A permanent sidebar listing six destinations for a person who
 * needs one is furniture, and it steals the horizontal space the week grid
 * actually needs. So the instructor tree gets a single page under a single bar.
 *
 * `AppShell` is untouched and still serves admin and manager; the pieces the two
 * shells genuinely share — the notification bell, the account dialogs, the toast
 * provider — are imported by both rather than copied into either.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 * The reference design shows a light/dark control. This product is a fixed
 * light theme by decision, and `globals.css` records why: a dark mode existed,
 * repainted every content surface near-black against a navy sidebar, and was
 * removed as a defect. A toggle that does nothing would be worse than no
 * toggle, so there is none.
 */

import { useState, type ReactNode } from "react";
import { ConfirmDialog, ToastProvider } from "@/app/_components/interactive";
import { NotificationBell } from "@/app/_components/NotificationBell";
import {
  AccountDialog,
  Avatar,
  useMyProfile,
  type MyProfile,
} from "@/app/_components/AccountDialogs";
import {
  IconChevronDown,
  IconChevronRight,
  IconLock,
  IconSettings,
  IconSignOut,
  IconUser,
} from "@/app/_components/icons";
import { usePathname, useRouter } from "next/navigation";
import { useHoverMenu } from "@/app/_components/use-hover-menu";
import { apiSend } from "@/app/_lib/api";

/**
 * Page names for the bar.
 *
 * Derived from the path rather than passed in, because the layout that renders
 * this shell is a server component and wraps every instructor route — hard-coding
 * one title there would have labelled every page "Dashboard".
 */
const TITLES: Array<[string, string]> = [
  ["/instructor/dashboard", "Dashboard"],
  ["/instructor/activity-tracker", "Activity Tracker"],
  ["/instructor/performance", "My Performance"],
  ["/instructor/activities", "My Activity"],
  ["/instructor/deliverables", "Deliverables"],
  ["/instructor/schedule", "Schedule"],
  ["/instructor/learning", "Learning"],
  ["/instructor/analytics", "Analytics"],
  ["/instructor/report", "Report"],
  ["/instructor/profile", "Profile"],
  ["/instructor/settings", "Settings"],
];

export function InstructorShell({
  userName,
  children,
}: {
  userName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const title = TITLES.find(([href]) => pathname.startsWith(href))?.[1] ?? "Dashboard";
  const { profile, setProfile } = useMyProfile();
  const [accountTab, setAccountTab] = useState<"profile" | "password" | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-canvas">
        {/* One bar: product and page on the left, the controls that belong to
            the PERSON on the right — bell, then their own account. Identity
            used to open the bar, which put "who am I" ahead of "where am I" on
            a page that only ever shows one person their own work. It sits with
            the notifications now, which is the corner people already reach for
            to sign out. */}
        {/* z-50: chrome. See the layer scale in globals.css — the sheet's sticky
            corner is z-30 and `main` opens no stacking context of its own, so at
            the z-30 this used to carry, the "Date" cell simply out-painted the
            bell and profile panels for coming later in the document. */}
        <header className="sticky top-0 z-50 border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <span className="font-display text-base font-semibold tracking-tight text-content">
              NIAT
            </span>

            <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />

            <h1 className="hidden truncate text-lg font-semibold text-content sm:block">
              {title}
            </h1>

            <div className="ml-auto flex items-center gap-2">
              <NotificationBell />
              <IdentityMenu
                userName={userName}
                profile={profile}
                onProfile={() => setAccountTab("profile")}
                onPassword={() => setAccountTab("password")}
                onSignOut={() => setConfirmSignOut(true)}
              />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      <AccountDialog
        key={`account-${accountTab ?? "closed"}`}
        open={accountTab !== null}
        initialTab={accountTab ?? "profile"}
        profile={profile}
        onClose={() => setAccountTab(null)}
        onSaved={setProfile}
      />
      <SignOutConfirm open={confirmSignOut} onClose={() => setConfirmSignOut(false)} />
    </ToastProvider>
  );
}

/**
 * The identity chip and its menu.
 *
 * Photo, name and employee code, because "am I looking at my own dashboard?" is
 * the first question the page has to answer and an id is what settles it.
 *
 * ── Hover opens it, but hover is never the only way in ────────────────────
 * The menu opens on hover and each level opens the next the same way. Hover
 * alone would make it unreachable on a phone, which has no hover, and unusable
 * from a keyboard — so clicking still toggles it, focus still opens it, and
 * Escape closes it. The hover is the convenience, not the mechanism.
 */
function IdentityMenu({
  userName,
  profile,
  onProfile,
  onPassword,
  onSignOut,
}: {
  userName: string;
  profile: MyProfile | null;
  onProfile: () => void;
  onPassword: () => void;
  onSignOut: () => void;
}) {
  const [submenu, setSubmenu] = useState<string | null>(null);
  // The submenu is this component's own state, so closing hands it back: a
  // panel left open would be showing when the menu is next hovered.
  const menu = useHoverMenu(() => setSubmenu(null));
  const { open } = menu;

  const name = profile?.name ?? userName;
  const code = profile?.employeeCode ?? null;

  const item =
    "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-hovered";

  return (
    <div className="relative" {...menu.hoverProps}>
      <button
        type="button"
        onClick={menu.toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-card border border-line bg-surface py-1.5 pl-1.5 pr-2.5 text-left transition hover:bg-hovered"
      >
        <Avatar name={name} avatarUrl={profile?.avatarUrl ?? null} size={36} />
        <span className="min-w-0">
          <span className="block max-w-[9rem] truncate text-sm font-semibold text-content">
            {name}
          </span>
          {code ? <span className="tabular block truncate text-xs text-muted">{code}</span> : null}
        </span>
        <IconChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        /* Anchored to the right edge, because the chip sits at the right of the
           bar and a left-anchored panel would open past the window. */
        <div
          role="menu"
          /* No `overflow-hidden` here, deliberately. It was clipping the
             rounded corners neatly — and clipping the submenu out of
             existence with them, because that panel is positioned OUTSIDE this
             box. The corners are rounded on the first and last rows instead. */
          className="absolute right-0 z-20 mt-2 w-64 rounded-card border border-line bg-surface shadow-raised"
        >
          <div className="flex items-center gap-3 rounded-t-card border-b border-line px-4 py-3">
            <Avatar name={name} avatarUrl={profile?.avatarUrl ?? null} size={44} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-content">{name}</p>
              <p className="text-xs text-muted">Instructor</p>
              {code ? (
                <p className="tabular mt-1 inline-block rounded-chip bg-primary-subtle px-2 py-0.5 text-xs text-primary-text">
                  ID: {code}
                </p>
              ) : null}
            </div>
          </div>

          {/* ── Account, and the two things inside it ─────────────────────
           * The submenu is not decoration: editing a profile and changing a
           * password are the same dialog's two tabs, so they belong under one
           * heading rather than sitting as siblings of "Logout" — which is not
           * an account SETTING, it is leaving. */}
          <div
            className="relative"
            onMouseEnter={() => setSubmenu("account")}
            onMouseLeave={() => setSubmenu(null)}
          >
            <button
              role="menuitem"
              type="button"
              aria-haspopup="menu"
              aria-expanded={submenu === "account"}
              onClick={() => setSubmenu(submenu === "account" ? null : "account")}
              onFocus={() => setSubmenu("account")}
              className={`${item} text-muted hover:text-content`}
            >
              <IconSettings size={16} />
              Account
              <IconChevronRight size={16} className="ml-auto text-subtle" />
            </button>

            {submenu === "account" ? (
              /* Opens to the LEFT. The parent is already flush with the right
                 edge of the window, so a submenu to its right would be
                 off-screen — the direction is forced by where the menu is, not
                 chosen for looks. */
              <div
                role="menu"
                /* Flush against the parent, with no gap. A margin here leaves
                   a sliver the pointer crosses on its way over — and that
                   sliver belongs to the menu behind, so leaving the row closed
                   the very panel the pointer was heading for. */
                className="absolute right-full top-0 z-30 w-56 overflow-hidden rounded-card border border-line bg-surface shadow-raised"
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    menu.closeNow();
                    onProfile();
                  }}
                  className={`${item} text-muted hover:text-content`}
                >
                  <IconUser size={16} />
                  Profile settings
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    menu.closeNow();
                    onPassword();
                  }}
                  className={`${item} border-t border-line text-muted hover:text-content`}
                >
                  <IconLock size={16} />
                  Change password
                </button>
              </div>
            ) : null}
          </div>

          <button
            role="menuitem"
            type="button"
            onMouseEnter={() => setSubmenu(null)}
            onClick={() => {
              menu.closeNow();
              onSignOut();
            }}
            className={`${item} rounded-b-card border-t border-line text-danger-text`}
          >
            <IconSignOut size={16} />
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Signing out asks first: a misplaced click must not discard an unsaved form. */
function SignOutConfirm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await apiSend("/api/auth/logout", "POST", {}, "Could not sign out.");
    } finally {
      // Even a failed sign-out sends the person to the login page rather than
      // leaving them on a dashboard they believe they have left.
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={signOut}
      pending={busy}
      title="Sign out?"
      description="You will be returned to the sign-in page. Anything you have not saved will be lost."
      confirmLabel="Sign out"
      destructive
    />
  );
}
