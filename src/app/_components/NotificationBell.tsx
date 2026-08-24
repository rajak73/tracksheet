"use client";

/**
 * The notification bell, shared by every shell.
 *
 * Extracted from `AppShell` when the instructor tree gained its own sidebar-less
 * shell: the bell is the same control in both, and a second copy would be a
 * second place for "mark as read" to drift.
 */

import { useEffect, useState } from "react";
import { IconButton } from "@/app/_components/ui";
import { IconBell } from "@/app/_components/icons";

type Notification = { id: string; title: string; message: string; createdAt: string };

/**
 * "Something just happened that the server may have reported on — look now."
 *
 * Dispatched by pages rather than called on the bell directly, because the bell
 * lives in the shell and the page that submits a worklog is several levels
 * below it. A missed event costs at most one poll interval.
 */
export const NOTIFY_EVENT = "tracksheet:notifications";
export const pingNotifications = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFY_EVENT));
};

/** Slow enough to be free, fast enough that nobody sits looking at a stale bell. */
const NOTIFY_POLL_MS = 30_000;

/**
 * Where the panel opens from, and what the unread ring sits against.
 *
 * `header` is the default: the bell sits at the top-right of a white bar and
 * the panel drops down under it, with a white ring cutting the unread dot out
 * from that white ground. `header-dark` opens the same way — top-right,
 * downward — for a header that is navy rather than white (the instructor
 * shell's bar), so only the ring changes, to match that ground instead.
 * `sidebar-footer` is the desktop home — the bell sits at the BOTTOM of a
 * 240px navy column, so a panel anchored to its right edge would extend
 * leftward off the screen. It opens upward and to the right instead, over the
 * content, with the same navy ring `header-dark` uses.
 */
type Placement = "header" | "header-dark" | "sidebar-footer";

export function NotificationBell({
  placement = "header",
  className,
}: {
  placement?: Placement;
  /** For the trigger, which has to suit a navy sidebar as well as a white bar. */
  className?: string;
} = {}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* ── Why this refreshes rather than reading once ─────────────────────────
   * The bell is now the channel a worklog reports through: a refused submit, a
   * line that could not be recorded, a parse that failed, a request waiting on
   * a manager. All of those happen AFTER the page was drawn — parsing runs in
   * the background — so a bell that read its list on mount and never again
   * would be the one place the answer never arrives.
   *
   * It polls on a slow interval for anything that happened elsewhere, and
   * refreshes immediately on `NOTIFY_EVENT`, which a page dispatches when it
   * has just done something the server may have had to report on. Opening the
   * panel refreshes too, because that is the moment somebody is asking.
   */
  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setItems(body.notifications ?? []);
      } catch {
        // A failed notification poll must never take the page down with it.
      }
    };

    void pull();
    const timer = setInterval(pull, NOTIFY_POLL_MS);
    const onPing = () => void pull();
    window.addEventListener(NOTIFY_EVENT, onPing);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(NOTIFY_EVENT, onPing);
    };
  }, [open]);

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
        className={className}
      >
        <span className="relative">
          <IconBell size={20} />
          {items.length > 0 ? (
            <span
              className={`absolute -right-0.5 -top-0.5 size-2 rounded-full bg-danger ring-2 ${
                placement === "header" ? "ring-surface" : "ring-sidebar-bg"
              }`}
            />
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
          <div
            className={`absolute z-20 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-line bg-surface shadow-raised ${
              placement === "sidebar-footer" ? "bottom-full left-0 mb-1" : "right-0 mt-1" // header + header-dark both open downward
            }`}
          >
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
                    {/* Line breaks are meaningful here: a worklog message
                        lists one refused line per row, and collapsing them runs
                        three separate problems into one sentence. */}
                    <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{n.message}</p>
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

/**
 * Sign-out, shared by the header `UserMenu` and the sidebar
 * `SidebarProfile`. The two look different because they sit on different
 * surfaces; the behaviour behind them must not be two implementations.
 */
