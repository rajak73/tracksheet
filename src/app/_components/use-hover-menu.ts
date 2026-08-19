"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";

/**
 * How long the menu waits after the pointer leaves before it closes.
 *
 * A menu that shuts the instant the pointer crosses its edge is the classic
 * frustration: moving from the trigger down into the panel takes the cursor
 * over a sliver of nothing, and without a grace period the destination
 * disappears on the way. Long enough to forgive that, short enough not to feel
 * stuck open.
 */
const CLOSE_DELAY_MS = 220;

/**
 * Open-on-hover for a menu, with every non-hover way in still working.
 *
 * ── Why this is a hook and not two copies ─────────────────────────────────
 * The instructor's top-bar chip and the manager's sidebar chip look nothing
 * alike — one is a white pill on a light bar, the other a row on the navy
 * sidebar that opens upward — but the BEHAVIOUR is meant to be identical, and
 * it drifted: the instructor's opened on hover, the manager's only on click.
 * Presentation stays in each component; the timing, the focus handling and the
 * Escape key live here once.
 *
 * ── Hover is the convenience, never the mechanism ─────────────────────────
 * Hover alone would make the menu unreachable on a phone, which has no hover,
 * and unusable from a keyboard. So clicking still toggles, focus entering the
 * block still opens, focus leaving it closes, and Escape closes.
 *
 * ── No backdrop element, deliberately ────────────────────────────────────
 * The usual way to dismiss a menu is a full-screen invisible button behind it.
 * That is incompatible with hover, and it was the bug: the backdrop sat INSIDE
 * the hovered block, so once the menu opened the pointer was over a descendant
 * no matter where it moved, `onMouseLeave` never fired, and the menu stayed
 * open until something was clicked — while the backdrop swallowed the first
 * click on every nav link underneath it. Dismissal is a `pointerdown` listener
 * on the document instead, which covers mouse and touch alike and puts nothing
 * in front of the page.
 *
 * `onClosed` runs on every close, for state the menu owns beyond open/shut
 * (a submenu that should not be left hanging open for the next time).
 */
export function useHoverMenu(onClosed?: () => void) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useRef(onClosed);
  const box = useRef<HTMLDivElement | null>(null);

  // Written in an effect rather than during render — assigning to a ref while
  // rendering is impure and the compiler rejects it. Keeping the callback here
  // lets the Escape listener depend on `open` alone instead of re-binding on
  // every single render.
  useEffect(() => {
    closed.current = onClosed;
  });

  // A timer that outlives the component would call setState on nothing.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // ── Closing is decided by where the pointer IS, not by a leave event ─────
  // `onMouseLeave` on the wrapper is the obvious way to do this and it is not
  // dependable enough on its own: the panel is positioned outside the wrapper's
  // own box with a gap between them, a fast flick out can miss it, and anything
  // that swallows the event leaves the menu stuck open with a click as the only
  // way out — which is exactly what it did. So while the menu is open the
  // document is asked, on every pointer move, whether the pointer is still
  // inside the block; if it is not, the close is scheduled. The wrapper's own
  // handlers stay as the fast path.
  //
  // Only while open, and only a `contains()` per move, so this costs nothing
  // the rest of the time. Touch never fires `pointermove` without contact, so
  // it is unaffected — `pointerdown` below is what dismisses there.
  useEffect(() => {
    if (!open) return;

    const inside = (target: EventTarget | null) =>
      box.current?.contains(target as Node | null);

    const close = () => {
      if (timer.current) return; // already on its way out
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpen(false);
        closed.current?.();
      }, CLOSE_DELAY_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (inside(e.target)) {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        return;
      }
      close();
    };

    // The pointer leaving the window altogether stops firing moves, so that
    // needs saying separately.
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) close();
    };

    // Tapping or clicking elsewhere closes at once — no grace period, the
    // intent is unambiguous. `pointerdown` rather than `click` so it lands
    // before the thing underneath reacts.
    const onDown = (e: PointerEvent) => {
      if (inside(e.target)) return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setOpen(false);
      closed.current?.();
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setOpen(false);
      closed.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const cancelClose = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const openNow = () => {
    cancelClose();
    setOpen(true);
  };

  const closeNow = () => {
    cancelClose();
    setOpen(false);
    closed.current?.();
  };

  const scheduleClose = () => {
    cancelClose();
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
      closed.current?.();
    }, CLOSE_DELAY_MS);
  };

  return {
    open,
    openNow,
    closeNow,
    /** Click: open if shut, shut if open. */
    toggle: () => (open ? closeNow() : openNow()),
    /** Spread onto the element wrapping BOTH the trigger and the panel. */
    hoverProps: {
      ref: box,
      onMouseEnter: openNow,
      onMouseLeave: scheduleClose,
      onFocus: openNow,
      onBlur: (e: FocusEvent<HTMLElement>) => {
        // Focus moving anywhere inside keeps it open; leaving the whole block
        // closes it, which is what Tab-ing past it should do.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeNow();
      },
    },
  };
}
