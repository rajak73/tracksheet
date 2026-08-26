/**
 * The chrome every signed-in page sits inside.
 *
 * ONE shell for all three roles (§12). An earlier design gave admin, manager
 * and instructor their own header colour, which read as three products sharing
 * a login. Orientation now comes from a small role label and from the
 * navigation itself — the layout, spacing and interaction are identical, so
 * moving between roles never feels like moving between applications.
 *
 * Desktop is a fixed sidebar plus a sticky context header. Below `lg` the
 * sidebar becomes a drawer: the same markup, the same order, the same active
 * state — not a second navigation implementation that can drift.
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV_BY_ROLE, ROLE_LABEL, type NavItem, type Role } from "@/app/_components/nav";
import { IconButton } from "@/app/_components/ui";
import { ConfirmDialog, ToastProvider } from "@/app/_components/interactive";
import { NotificationBell } from "@/app/_components/NotificationBell";
import { useHoverMenu } from "@/app/_components/use-hover-menu";
import {
  AccountDialog,
  Avatar,
  useMyProfile,
  type MyProfile,
} from "@/app/_components/AccountDialogs";
import {
  IconChevronDown,
  IconClose,
  IconLock,
  IconMenu,
  IconSettings,
  IconSignOut,
} from "@/app/_components/icons";

const GROUP_ORDER: NavItem["group"][] = ["main", "intelligence", "admin"];

export function AppShell({
  role,
  userName,
  children,
}: {
  role: Role;
  userName: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The account dialogs are mounted ONCE here and opened from either profile
  // control, so the sidebar and the mobile header cannot drift into two
  // different account experiences.
  const { profile, setProfile } = useMyProfile();
  const [accountTab, setAccountTab] = useState<"profile" | "password" | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const account = {
    profile,
    openProfile: () => setAccountTab("profile"),
    openPassword: () => setAccountTab("password"),
    requestSignOut: () => setConfirmSignOut(true),
  };
  const pathname = usePathname();
  const nav = NAV_BY_ROLE[role];

  // Navigating closes the drawer. Without this it stays open over the page the
  // user just asked for, which on a phone looks like the tap did nothing.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas">
        {/* Skip link: the first tab stop on every page, so a keyboard user is
            not walked through nine nav items to reach the content (§36). */}
        <a
          href="#main"
          className="sr-only-text focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-brand-navy focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>

        {/* Desktop sidebar — a fixed Navy surface, one of the two strongest
            visual anchors of the product (the other is the wordmark inside
            it). It does not follow the workspace's light/dark switching; see
            the token comment in globals.css. */}
        {/* Blue, matching the instructor's bar and this shell's own mobile one.
            The `sidebar-*` TOKENS stay navy on purpose — the login page and the
            marketing bands still use them and are still navy — so the colours
            here are named outright rather than by repointing a token that other
            surfaces depend on. */}
        <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 bg-brand-navy lg:flex lg:flex-col">
          <SidebarContent
            role={role}
            nav={nav}
            pathname={pathname}
            userName={userName}
            account={account}
          />
        </aside>

        {/* Mobile drawer. */}
        {drawerOpen ? (
          <div className="fixed inset-0 z-[60] lg:hidden">
            <button
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-navy">
              <SidebarContent
                role={role}
                nav={nav}
                pathname={pathname}
                userName={userName}
                account={account}
                onClose={() => setDrawerOpen(false)}
              />
            </aside>
          </div>
        ) : null}

        <div className="lg:pl-60">
          {/* ── Mobile only, deliberately ──────────────────────────────────
           * On a phone this bar earns its height: it carries the button that
           * opens the nav drawer, the wordmark, and the profile menu, none of
           * which have anywhere else to live without a persistent sidebar.
           *
           * On desktop every one of those was already `lg:hidden`, so the bar
           * was fifty-six pixels of white with a single bell floating at the
           * right of it — a band above every page that said nothing. The bell
           * moved into the sidebar footer beside the profile, where the other
           * "about me" control already lives, and the bar stops existing at
           * `lg`. Every page gains that height back.
           *
           * z-50: chrome, above anything the page content can stick. It was
           * z-20 — under the manager sheet's own sticky header — so the bell
           * and profile panels opened UNDERNEATH the table. */}
          <header
            /* Blue, matching `InstructorShell`'s bar — see the note there for
               why the `sidebar-*` tokens cannot come along. The desktop
               SIDEBAR stays navy: it is a vertical rail, not this bar, and the
               two are never on screen together. */
            className="sticky top-0 z-50 bg-brand-navy lg:hidden"
          >
            <div className="flex h-14 items-center gap-2 px-4 sm:px-6 lg:px-8">
              <IconButton
                label="Open navigation"
                onClick={() => setDrawerOpen(true)}
                className="-ml-2 text-white/80 hover:bg-white/15 hover:text-white lg:hidden"
              >
                <IconMenu size={20} />
              </IconButton>

              <span className="font-display text-sm font-semibold tracking-tight text-white lg:hidden">
                NIAT
              </span>

              <div className="ml-auto flex items-center gap-1">
                <NotificationBell
                  placement="header-dark"
                  className="text-white/80 hover:bg-white/15 hover:text-white"
                />
                {/* The profile menu lives in the sidebar footer on desktop
                    (§7). This whole bar is mobile-only now, so no `lg:hidden`
                    is needed here any more. */}
                <UserMenu userName={userName} account={account} />
              </div>
            </div>
          </header>

          <main
            id="main"
            className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
          >
            {children}
          </main>
        </div>
      </div>

      {/* Mounted once, for every role and every page. */}
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

/** What both profile controls need in order to behave identically. */
type AccountControls = {
  profile: MyProfile | null;
  openProfile: () => void;
  openPassword: () => void;
  requestSignOut: () => void;
};

/**
 * Signing out asks first.
 *
 * A misplaced click on a menu should not discard an unsaved form. It shares
 * `useSignOut()` with nothing else — the confirmation IS the only path now, so
 * neither menu can sign somebody out on a single click.
 */
function SignOutConfirm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut, busy } = useSignOut();
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

function SidebarContent({
  role,
  nav,
  pathname,
  userName,
  account,
  onClose,
}: {
  role: Role;
  nav: NavItem[];
  pathname: string;
  userName: string;
  account: AccountControls;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/20 px-4">
        <div className="min-w-0">
          <p className="font-display truncate text-sm font-semibold tracking-tight text-white">
            NIAT
          </p>
          <p className="truncate text-xs text-white">{ROLE_LABEL[role]}</p>
        </div>
        {onClose ? (
          <IconButton
            label="Close navigation"
            onClick={onClose}
            className="-mr-2 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <IconClose size={20} />
          </IconButton>
        ) : null}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
        {GROUP_ORDER.map((group, groupIndex) => {
          const items = nav.filter((item) => item.group === group);
          if (items.length === 0) return null;

          return (
            <ul
              key={group}
              className={
                groupIndex > 0
                  ? "mt-3 space-y-0.5 border-t border-white/20 pt-3"
                  : "space-y-0.5"
              }
            >
              {items.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    {/* The active item INVERTS — white pill, blue label —
                        because the rail is now that same blue and a blue pill
                        on it is not a pill. Inactive items are full white
                        rather than a tint: at 14px they are small text, and no
                        tint of white clears 4.5:1 on this blue. The pill is
                        what separates the two, which is what a segmented
                        control does everywhere else in the product. */}
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-white text-primary-text"
                          : "text-white hover:bg-white/15"
                      }`}
                    >
                      <Icon size={20} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          );
        })}
      </nav>

      {/* Sidebar footer (§7). Desktop only — on mobile the drawer is transient,
          so these stay in the header instead.

          The bell sits beside the profile rather than in a bar of its own: both
          are about the person signed in, not about the page, and one row of
          chrome is enough for them. */}
      <div className="hidden shrink-0 items-center gap-1 border-t border-white/20 p-3 lg:flex">
        <div className="min-w-0 flex-1">
          <SidebarProfile userName={userName} role={role} account={account} />
        </div>
        <NotificationBell
          placement="sidebar-footer"
          className="shrink-0 text-white/80 hover:bg-white/15 hover:text-white"
        />
      </div>
    </>
  );
}

/**
 * The profile control that sits at the bottom of the desktop sidebar.
 *
 * Deliberately NOT a second copy of `UserMenu`: that one is styled for a
 * white header and lives in the mobile header, this one is styled for the
 * navy sidebar. They share the same sign-out behaviour via `useSignOut()` so
 * the actual logic has one definition — only the presentation differs.
 *
 * Opens on hover, on the same timing as the instructor's chip, via
 * `useHoverMenu()`. It used to open only on click while the instructor's
 * opened on hover, which made the same control behave differently depending on
 * who was signed in. The panel also carries the same header — photo, name,
 * role, employee id — because "am I looking at my own account?" is the question
 * the chip exists to answer, and an id is what settles it.
 */
function SidebarProfile({
  userName,
  role,
  account,
}: {
  userName: string;
  role: Role;
  account: AccountControls;
}) {
  const menu = useHoverMenu();
  const name = account.profile?.name ?? userName;

  return (
    <div className="relative" {...menu.hoverProps}>
      {menu.open ? (
        /* Opens to the RIGHT of the rail rather than upward over it.
           Upward, the panel covered the navigation it sits under — the list
           somebody may well have been on their way to — and the taller it got
           the more of it went. Sideways it opens over the page instead, which
           is the surface with room to spare.
           `bottom-0` rather than `top-0`: the trigger is the last thing in the
           rail, so the panel aligns to its bottom edge and grows upward from
           there instead of running off the foot of the window.
           The gap is PADDING on the positioned box, not a margin on the panel,
           so the pointer never crosses a strip belonging to neither. */
        <div className="absolute bottom-0 left-full z-20 w-60 pl-2">
          <div
            role="menu"
            /* No name/photo/ID header block — the trigger this opens from
               already shows both, right below it. */
            className="overflow-hidden rounded-card border border-line bg-surface shadow-raised"
          >
            <AccountMenuItems account={account} onPicked={menu.closeNow} />
          </div>
        </div>
      ) : null}

      <button
        onClick={menu.toggle}
        aria-expanded={menu.open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors hover:bg-white/15"
      >
        <Avatar
          name={name}
          avatarUrl={account.profile?.avatarUrl ?? null}
          size={32}
          className="bg-white/20 text-white"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{name}</span>
          <span className="block truncate text-xs text-white">{ROLE_LABEL[role]}</span>
        </span>
        <IconChevronDown
          size={16}
          className={`shrink-0 text-white/80 transition-transform ${
            menu.open ? "rotate-180" : ""
          }`}
        />
      </button>
    </div>
  );
}

/**
 * The three account actions, shared verbatim by both profile controls.
 *
 * One definition, so the sidebar and the mobile header can never offer
 * different things — which is what happened when each owned its own sign-out
 * button and only one of them ever gained a confirmation.
 */
function AccountMenuItems({
  account,
  onPicked,
}: {
  account: AccountControls;
  onPicked: () => void;
}) {
  const item =
    "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-hovered";
  return (
    <>
      <button
        role="menuitem"
        onClick={() => {
          onPicked();
          account.openProfile();
        }}
        className={`${item} text-muted hover:text-content`}
      >
        <IconSettings size={16} />
        Profile settings
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onPicked();
          account.openPassword();
        }}
        className={`${item} text-muted hover:text-content`}
      >
        <IconLock size={16} />
        Change password
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onPicked();
          account.requestSignOut();
        }}
        className={`${item} border-t border-line text-danger-text`}
      >
        <IconSignOut size={16} />
        Logout
      </button>
    </>
  );
}

function useSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // A full navigation, not router.push: signing out must drop every piece
      // of client state, and a soft navigation keeps the cached page tree.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    } catch {
      setBusy(false);
      router.refresh();
    }
  }

  return { signOut, busy };
}

function UserMenu({
  userName,
  account,
}: {
  userName: string;
  account: AccountControls;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-control px-1.5 py-1.5 transition-colors hover:bg-white/15"
      >
        <Avatar
          name={userName}
          avatarUrl={account.profile?.avatarUrl ?? null}
          size={28}
          className="bg-white/20 text-white"
        />
        <span className="hidden max-w-32 truncate text-sm text-white sm:inline">
          {userName}
        </span>
      </button>

      {open ? (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            /* No name/photo header block — the trigger this opens from
               already shows the name, right beside it. */
            className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-card border border-line bg-surface shadow-raised"
          >
            <AccountMenuItems account={account} onPicked={() => setOpen(false)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
