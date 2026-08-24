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
import { IconChevronDown, IconSignOut, IconUser } from "@/app/_components/icons";
import { usePathname, useRouter } from "next/navigation";
import { apiSend } from "@/app/_lib/api";

/**
 * Page names for the bar.
 *
 * Derived from the path rather than passed in, because the layout that renders
 * this shell is a server component and wraps every instructor route — hard-coding
 * one title there would have labelled every page "Dashboard".
 */
/**
 * `null` means the page prints its own title and the bar should not repeat it —
 * two headings saying the same words is a duplicate <h1>, and on the work log
 * the client's design puts the title inside the card.
 */
const TITLES: Array<[string, string | null]> = [
  ["/instructor/worklog", null],
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
  const match = TITLES.find(([href]) => pathname.startsWith(href));
  // `undefined` is an unlisted route and falls back; `null` is a page that owns
  // its own heading, and gets nothing here.
  // An unlisted route shows nothing rather than the name of a screen that no
  // longer exists.
  const title = match ? match[1] : null;
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
        <header className="sticky top-0 z-50 border-b border-sidebar-border bg-sidebar-bg">
          <div className="mx-auto flex w-full max-w-[96rem] items-center gap-3 px-4 py-4 sm:px-6 lg:px-10">
            {/* The client's mark for this product: a clipboard tile, then the
                wordmark with the second half in the brand blue. */}
            <span className="flex shrink-0 items-center gap-2.5">
              <span
                aria-hidden
                className="inline-flex size-10 items-center justify-center rounded-[10px] bg-primary text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" className="size-6">
                  <rect
                    x="5"
                    y="4"
                    width="14"
                    height="17"
                    rx="2.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <path
                    d="M9.5 4V3.2A1.2 1.2 0 0 1 10.7 2h2.6a1.2 1.2 0 0 1 1.2 1.2V4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                  <path
                    d="m9 12.5 2 2 4-4"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="font-display text-2xl font-bold tracking-tight text-sidebar-text">
                Work<span className="text-primary-bright">Log</span>
              </span>
            </span>

            {title ? (
              <>
                <span aria-hidden className="hidden h-6 w-px bg-sidebar-border sm:block" />
                <h1 className="hidden truncate text-lg font-semibold text-sidebar-text sm:block">
                  {title}
                </h1>
              </>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              <NotificationBell
                placement="header-dark"
                className="text-sidebar-text-muted hover:bg-sidebar-hover-bg hover:text-sidebar-text"
              />
              <IdentityMenu
                userName={userName}
                profile={profile}
                onProfile={() => setAccountTab("profile")}
                onSignOut={() => setConfirmSignOut(true)}
              />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6 lg:px-10">
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
        onChangePassword={() => setAccountTab("password")}
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
 * ── Click only, no hover ─────────────────────────────────────────────────
 * This used to open on hover too (`useHoverMenu`, shared with the sidebar's
 * own profile chip), and that was the complaint: resting the pointer near the
 * corner — reading the notification bell beside it, aiming for something
 * else — popped the menu open uninvited. A menu opening from something that
 * isn't a deliberate action is a menu that gets in the way. Click toggles it;
 * a click anywhere outside — the full-screen invisible button below — closes
 * it, the same dismissal `UserMenu` in `AppShell.tsx` already uses.
 *
 * ── Two items only ───────────────────────────────────────────────────────
 * Profile, Logout. What used to be here — "Change password" as its own row
 * under an "Account" flyout — still exists, just one layer in: it is a link
 * inside the Profile dialog now (see `onChangePassword` on `AccountDialog`),
 * not a second thing this menu has to offer.
 */
function IdentityMenu({
  userName,
  profile,
  onProfile,
  onSignOut,
}: {
  userName: string;
  profile: MyProfile | null;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  const name = profile?.name ?? userName;
  const code = profile?.employeeCode ?? null;

  // ~46px tall: py-3 (24px) plus a 16px icon/text line plus its leading.
  const item =
    "flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors hover:bg-hovered";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-card py-1.5 pl-1.5 pr-2.5 text-left transition-colors hover:bg-sidebar-hover-bg"
      >
        <Avatar
          name={name}
          avatarUrl={profile?.avatarUrl ?? null}
          size={36}
          className="bg-white/10 text-sidebar-text"
        />
        <span className="min-w-0">
          <span className="block max-w-[9rem] truncate text-sm font-semibold text-sidebar-text">
            {name}
          </span>
          {code ? (
            <span className="tabular block truncate text-xs text-sidebar-text-muted">{code}</span>
          ) : null}
        </span>
        <IconChevronDown
          size={16}
          className={`shrink-0 text-sidebar-text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <>
          {/* Dismisses on any click outside the panel — not a hover leave,
              a deliberate second interaction, matching `UserMenu`. */}
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          {/* Anchored to the right edge, because the chip sits at the right of
              the bar and a left-anchored panel would open past the window. */}
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-card border border-line bg-surface shadow-raised"
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
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

            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onProfile();
              }}
              className={`${item} text-muted hover:text-content`}
            >
              <IconUser size={16} />
              Profile
            </button>

            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className={`${item} border-t border-line text-danger-text`}
            >
              <IconSignOut size={16} />
              Logout
            </button>
          </div>
        </>
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
