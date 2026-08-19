"use client";

/**
 * The public site's primary navigation.
 *
 * Dropdowns open on CLICK, not hover. Hover-only menus are unreachable by
 * keyboard and hostile on touch, and the "open on hover, close on leave"
 * pattern is the single most common accessibility defect in marketing
 * navigation. Click-to-open gives keyboard, pointer and touch users the same
 * interaction, with Escape and outside-click to dismiss.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ButtonLink } from "@/app/_components/ui";
import { Wordmark } from "@/app/_components/public/Wordmark";
import { IconChevronDown, IconClose, IconMenu } from "@/app/_components/icons";

type MenuLink = { href: string; label: string; description?: string };

const SOLUTIONS: MenuLink[] = [
  {
    href: "/solutions/universities",
    label: "For Universities",
    description: "Network-wide visibility across every institution.",
  },
  {
    href: "/solutions/managers",
    label: "For Managers",
    description: "Workload, schedules and risks inside one university.",
  },
  {
    href: "/solutions/instructors",
    label: "For Instructors",
    description: "One clear view of the working day.",
  },
];

const RESOURCES: MenuLink[] = [
  { href: "/resources", label: "Overview", description: "How NIAT is used day to day." },
  { href: "/analytics", label: "Analytics", description: "Utilization, capacity and trends." },
  { href: "/security", label: "Security", description: "Access control and data isolation." },
  { href: "/contact", label: "Contact", description: "Talk to the NIAT team." },
];

const DIRECT_LINKS: MenuLink[] = [
  { href: "/platform", label: "Platform" },
  { href: "/ai-intelligence", label: "AI Intelligence" },
  { href: "/security", label: "Security" },
];

export function PublicNavbar() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Any navigation closes everything — otherwise a menu stays open on top of
  // the page the user just asked for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenMenu(null);
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes whatever is open, from anywhere — including when focus has
  // moved into the panel itself.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Clicking outside the nav dismisses an open dropdown.
  useEffect(() => {
    if (!openMenu) return;
    function onClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openMenu]);

  const isActive = useCallback(
    (href: string) => pathname === href || pathname.startsWith(`${href}/`),
    [pathname],
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <nav
        ref={navRef}
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-8"
      >
        <Wordmark />

        {/* Desktop navigation. */}
        <ul className="ml-4 hidden items-center gap-1 lg:flex">
          <li>
            <NavLink href="/platform" active={isActive("/platform")}>
              Platform
            </NavLink>
          </li>
          <li>
            <Dropdown
              id="solutions"
              label="Solutions"
              items={SOLUTIONS}
              open={openMenu === "solutions"}
              onToggle={() => setOpenMenu((v) => (v === "solutions" ? null : "solutions"))}
              active={isActive("/solutions")}
            />
          </li>
          <li>
            <NavLink href="/ai-intelligence" active={isActive("/ai-intelligence")}>
              AI Intelligence
            </NavLink>
          </li>
          <li>
            <Dropdown
              id="resources"
              label="Resources"
              items={RESOURCES}
              open={openMenu === "resources"}
              onToggle={() => setOpenMenu((v) => (v === "resources" ? null : "resources"))}
              active={isActive("/resources")}
            />
          </li>
          <li>
            <NavLink href="/security" active={isActive("/security")}>
              Security
            </NavLink>
          </li>
        </ul>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Link
            href="/login"
            className="rounded-control px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-hovered hover:text-content"
          >
            Login
          </Link>
          <ButtonLink href="/contact">Request access</ButtonLink>
        </div>

        {/* Mobile trigger. */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="ml-auto inline-flex size-10 items-center justify-center rounded-control text-muted transition-colors hover:bg-hovered hover:text-content lg:hidden"
        >
          {mobileOpen ? <IconClose size={20} /> : <IconMenu size={20} />}
        </button>
      </nav>

      {/* Mobile panel. Rendered in flow rather than as an overlay so opening
          it never shifts the page underneath. */}
      {mobileOpen ? (
        <div id="mobile-nav" className="border-t border-line bg-surface lg:hidden">
          <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
            <ul className="space-y-1">
              {DIRECT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="block rounded-control px-3 py-2.5 text-base font-medium text-content hover:bg-hovered"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <MobileGroup title="Solutions" items={SOLUTIONS} />
            <MobileGroup title="Resources" items={RESOURCES} />

            <div className="flex flex-col gap-3 border-t border-line pt-6">
              <ButtonLink href="/contact" className="w-full justify-center">
                Request access
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" className="w-full justify-center">
                Login
              </ButtonLink>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-control px-3 py-2 text-sm font-medium transition-colors ${
        active ? "text-primary" : "text-muted hover:bg-hovered hover:text-content"
      }`}
    >
      {children}
    </Link>
  );
}

function Dropdown({
  id,
  label,
  items,
  open,
  onToggle,
  active,
}: {
  id: string;
  label: string;
  items: MenuLink[];
  open: boolean;
  onToggle: () => void;
  active: boolean;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        className={`inline-flex items-center gap-1 rounded-control px-3 py-2 text-sm font-medium transition-colors ${
          active || open ? "text-primary" : "text-muted hover:bg-hovered hover:text-content"
        }`}
      >
        {label}
        <IconChevronDown
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div
          id={`${id}-menu`}
          className="absolute left-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-card border border-line bg-surface p-1.5 shadow-raised"
        >
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-control px-3 py-2.5 transition-colors hover:bg-hovered"
                >
                  <span className="block text-sm font-medium text-content">{item.label}</span>
                  {item.description ? (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {item.description}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MobileGroup({ title, items }: { title: string; items: MenuLink[] }) {
  return (
    <div>
      <p className="px-3 text-xs font-semibold uppercase tracking-wider text-subtle">{title}</p>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-control px-3 py-2.5 text-base font-medium text-content hover:bg-hovered"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
