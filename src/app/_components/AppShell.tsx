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
import {
  NAV_BY_ROLE,
  ROLE_LABEL,
  type NavItem,
  type Role,
} from "@/app/_components/nav";
import { IconButton } from "@/app/_components/ui";
import { ToastProvider } from "@/app/_components/interactive";
import {
  IconBell,
  IconChevronDown,
  IconClose,
  IconMenu,
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
          className="sr-only-text focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>

        {/* Desktop sidebar — a fixed Navy surface, one of the two strongest
            visual anchors of the product (the other is the wordmark inside
            it). It does not follow the workspace's light/dark switching; see
            the token comment in globals.css. */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-sidebar-bg lg:flex lg:flex-col">
          <SidebarContent role={role} nav={nav} pathname={pathname} userName={userName} />
        </aside>

        {/* Mobile drawer. */}
        {drawerOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar-bg">
              <SidebarContent
                role={role}
                nav={nav}
                pathname={pathname}
                userName={userName}
                onClose={() => setDrawerOpen(false)}
              />
            </aside>
          </div>
        ) : null}

        <div className="lg:pl-60">
          <header className="sticky top-0 z-20 border-b border-line bg-surface">
            <div className="flex h-14 items-center gap-2 px-4 sm:px-6 lg:px-8">
              <IconButton
                label="Open navigation"
                onClick={() => setDrawerOpen(true)}
                className="-ml-2 lg:hidden"
              >
                <IconMenu size={20} />
              </IconButton>

              <span className="font-display text-sm font-semibold tracking-tight text-content lg:hidden">
                NEXTWAVE
              </span>

              <div className="ml-auto flex items-center gap-1">
                <NotificationBell />
                {/* The profile menu lives in the sidebar footer on desktop
                    (§7). On mobile there is no persistent sidebar, so it
                    stays in the header — same component, one definition. */}
                <div className="lg:hidden">
                  <UserMenu userName={userName} role={role} />
                </div>
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
    </ToastProvider>
  );
}

function SidebarContent({
  role,
  nav,
  pathname,
  userName,
  onClose,
}: {
  role: Role;
  nav: NavItem[];
  pathname: string;
  userName: string;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4">
        <div className="min-w-0">
          <p className="font-display truncate text-sm font-semibold tracking-tight text-sidebar-text">
            NEXTWAVE
          </p>
          <p className="truncate text-xs text-sidebar-text-muted">{ROLE_LABEL[role]}</p>
        </div>
        {onClose ? (
          <IconButton
            label="Close navigation"
            onClick={onClose}
            className="-mr-2 text-sidebar-text-muted hover:bg-sidebar-hover-bg hover:text-sidebar-text"
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
                  ? "mt-3 space-y-0.5 border-t border-sidebar-border pt-3"
                  : "space-y-0.5"
              }
            >
              {items.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    {/* The active item is a solid Royal Blue pill. No extra
                        left accent bar — against a filled selection that is
                        a second indicator saying the same thing. */}
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-sidebar-active-bg text-white"
                          : "text-sidebar-text-muted hover:bg-sidebar-hover-bg hover:text-sidebar-text"
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

      {/* Sidebar footer profile (§7). Desktop only — on mobile the drawer is
          transient, so the profile menu stays in the header instead. */}
      <div className="hidden shrink-0 border-t border-sidebar-border p-3 lg:block">
        <SidebarProfile userName={userName} role={role} />
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
 */
function SidebarProfile({ userName, role }: { userName: string; role: Role }) {
  const [open, setOpen] = useState(false);
  const { signOut, busy } = useSignOut();
  const initials = initialsOf(userName);

  return (
    <div className="relative">
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
            className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-card border border-line bg-surface shadow-raised"
          >
            <button
              role="menuitem"
              onClick={signOut}
              disabled={busy}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-muted transition-colors hover:bg-hovered hover:text-content disabled:opacity-50"
            >
              <IconSignOut size={16} />
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </>
      ) : null}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors hover:bg-sidebar-hover-bg"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-sidebar-text">
          {initials || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-sidebar-text">
            {userName}
          </span>
          <span className="block truncate text-xs text-sidebar-text-muted">
            {ROLE_LABEL[role]}
          </span>
        </span>
        <IconChevronDown size={16} className="shrink-0 text-sidebar-text-muted" />
      </button>
    </div>
  );
}

/* ── Header controls ───────────────────────────────────────────────────── */

type Notification = { id: string; title: string; message: string; createdAt: string };

function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setItems(body.notifications ?? []);
      } catch {
        // A failed notification poll must never take the page down with it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function markAllRead() {
    setBusy(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "MARK_ALL_READ" }),
      });
      if (res.ok) {
        setItems([]);
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <IconButton
        label={items.length > 0 ? `Notifications (${items.length} unread)` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="relative">
          <IconBell size={20} />
          {items.length > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-danger ring-2 ring-surface" />
          ) : null}
        </span>
      </IconButton>

      {open ? (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-line bg-surface shadow-raised">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold text-content">Notifications</p>
              {items.length > 0 ? (
                <button
                  onClick={markAllRead}
                  disabled={busy}
                  className="rounded-chip text-xs font-medium text-primary hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              ) : null}
            </div>

            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                You are all caught up.
              </p>
            ) : (
              <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-content">{n.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{n.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Up to two initials, for the avatar in both profile controls. */
function initialsOf(userName: string): string {
  return userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Sign-out, shared by the header `UserMenu` and the sidebar
 * `SidebarProfile`. The two look different because they sit on different
 * surfaces; the behaviour behind them must not be two implementations.
 */
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

function UserMenu({ userName, role }: { userName: string; role: Role }) {
  const [open, setOpen] = useState(false);
  const { signOut, busy } = useSignOut();
  const initials = initialsOf(userName);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-control px-1.5 py-1.5 transition-colors hover:bg-hovered"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-text">
          {initials || "?"}
        </span>
        <span className="hidden max-w-32 truncate text-sm text-content sm:inline">
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
            className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-card border border-line bg-surface shadow-raised"
          >
            <div className="border-b border-line px-4 py-3">
              <p className="truncate text-sm font-medium text-content">{userName}</p>
              <p className="text-xs text-muted">{ROLE_LABEL[role]}</p>
            </div>
            <button
              role="menuitem"
              onClick={signOut}
              disabled={busy}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-muted transition-colors hover:bg-hovered hover:text-content disabled:opacity-50"
            >
              <IconSignOut size={16} />
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
