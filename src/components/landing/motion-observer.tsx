"use client";

import { useEffect } from "react";

/**
 * Scroll-reveal driver for the landing page.
 *
 * Deliberately renders nothing and holds no React state. It flips DOM
 * attributes directly, which keeps three properties the alternatives lose:
 *
 *  - No hydration mismatch: there is no markup to disagree about.
 *  - No re-render: the server component tree is never touched.
 *  - Graceful degradation: the page stays fully readable if this never runs.
 *
 * `js-motion` is added synchronously inside the effect so CSS can tell "JS is
 * available" from "JS is absent". Without that flag the reveal styles could
 * never hide anything, and a no-JS visitor would be left staring at a blank
 * page waiting for a script that will never arrive.
 */
export function MotionObserver() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js-motion");

    const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (targets.length === 0) return;

    // No IntersectionObserver (or motion already reduced): show everything
    // immediately rather than leaving the visitor with hidden content.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      targets.forEach((el) => el.setAttribute("data-shown", ""));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // Reveal once, then stop watching — a card that re-animates every
          // time it scrolls past is exhausting rather than smooth.
          entry.target.setAttribute("data-shown", "");
          observer.unobserve(entry.target);
        }
      },
      {
        // Fire a little before the element reaches the bottom edge so motion is
        // already underway by the time it is comfortable to look at.
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.12,
      },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return null;
}