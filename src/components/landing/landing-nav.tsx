"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SECTIONS = [
  { label: "How it works", href: "#how" },
  { label: "Why it's different", href: "#engine" },
  { label: "Sources", href: "#sources" },
];

/**
 * Landing-page section nav.
 *
 * Client-side only because collapsing links behind a toggle needs state. Kept as
 * a small island so the rest of the landing page stays a server component with
 * no hydration cost.
 *
 * At `sm` and up the links sit inline in one row; below that they collapse into
 * a toggle. Wrapping them instead — which is what this did originally — pushed
 * the header to three rows on a 320px screen.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);

  // Close the panel if the viewport grows past the breakpoint, otherwise the
  // inline links and the open panel would both be in the DOM.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <>
      <nav
        aria-label="Sections"
        className="order-last hidden w-full items-center sm:order-none sm:flex sm:w-auto"
      >
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {SECTIONS.map((s) => (
            <li key={s.href}>
              <a href={s.href} className="text-sm text-ink-soft transition-colors hover:text-ink">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="landing-mobile-nav"
        className="-ml-1 shrink-0 rounded-control border border-line-strong px-2.5 py-1.5 font-mono-face text-sm sm:hidden"
      >
        {open ? "✕" : "☰"}
      </button>

      {open ? (
        <div
          id="landing-mobile-nav"
          className="fade-up order-last w-full border-t border-line pt-2 sm:hidden"
        >
          <ul className="flex flex-col">
            {SECTIONS.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-control px-2 py-2.5 text-sm text-ink-soft hover:bg-sunken hover:text-ink"
                >
                  {s.label}
                </a>
              </li>
            ))}
            <li className="mt-1 border-t border-line pt-2 sm:hidden">
              <Link
                href="/login"
                className="block rounded-control px-2 py-2.5 text-sm font-medium text-term-deep hover:bg-sunken"
              >
                Sign in →
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </>
  );
}
