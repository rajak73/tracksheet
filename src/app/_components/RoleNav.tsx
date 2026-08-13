"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

/**
 * Navigation for a role's application shell. Every entry points at a route
 * that exists — there are deliberately no `href="#"` placeholders, because a
 * link that goes nowhere is indistinguishable from a broken one.
 */
export function RoleNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-primary-subtle text-primary-text"
                : "text-muted hover:bg-hovered hover:text-content"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
