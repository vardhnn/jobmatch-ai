"use client";

import { useEffect } from "react";

/**
 * Cursor-reactive background grid.
 *
 * The app's blueprint grid is painted on `body` via `background-image`. This
 * adds a second layer that brightens the grid lines around the pointer and
 * fades out with distance — the grid appears to light up as you move through
 * it, which is the cheapest possible way to make a static background feel
 * alive without adding any DOM weight to the page.
 *
 * Performance constraints, all deliberate:
 *  - Writes only two CSS custom properties on `document.documentElement`, so
 *    the browser recomposites a gradient instead of re-laying-out the page.
 *  - Pointer moves are coalesced into one rAF per frame. A high-frequency mouse
 *    can fire far more events than frames; updating per event would queue work
 *    the browser then has to discard.
 *  - Disabled entirely on coarse pointers (no hover, so nothing to react to)
 *    and under `prefers-reduced-motion`, where a follow-the-cursor effect is
 *    motion the user did not ask for.
 *
 * Rendered as a fixed, pointer-transparent overlay so it costs no layout and
 * never intercepts a click.
 */
export function GridCursor() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || calm.matches) return;

    const root = document.documentElement;
    let frame = 0;
    let pendingX = 0;
    let pendingY = 0;

    const paint = () => {
      frame = 0;
      root.style.setProperty("--mx", `${pendingX}px`);
      root.style.setProperty("--my", `${pendingY}px`);
    };

    const onMove = (event: PointerEvent) => {
      pendingX = event.clientX;
      pendingY = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--mx");
      root.style.removeProperty("--my");
    };
  }, []);

  return <div className="cursor-grid" aria-hidden="true" />;
}