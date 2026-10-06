"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string };

/**
 * Primary destinations. Settings is deliberately absent: it is an account-level
 * concern, so it lives in the account menu next to dark mode and logout rather
 * than in the site navigation.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/jobs", label: "Jobs", icon: "≣" },
  { href: "/resume", label: "Resume", icon: "▤" },
  { href: "/profile", label: "Profile", icon: "◉" },
  { href: "/preferences", label: "Preferences", icon: "⚙" },
  { href: "/sources", label: "Sources", icon: "⇄" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Primary site navigation.
 *
 * Two presentations of the same list, never both on screen at once:
 *   - inline   — a single row beside the brand on `lg` and up.
 *   - stacked  — a full-width menu panel below `lg`, opened from the header.
 *
 * Keeping it to one row (or one menu) at every width is what stops the header
 * from wrapping to two or three rows on a phone. Neither variant is a
 * horizontally-scrolling strip, which previously pushed Sources and Settings
 * off-screen where nobody could see them.
 */
export function SiteNav({
  className = "",
  variant = "inline",
  onNavigate,
}: {
  className?: string;
  variant?: "inline" | "stacked";
  /** Called after a link is followed (used to close the mobile menu). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const stacked = variant === "stacked";

  return (
    <nav aria-label="Primary" className={className}>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={
              stacked
                ? `flex items-center gap-2.5 rounded-control px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-term-wash font-medium text-term-deep"
                      : "text-ink-soft hover:bg-sunken hover:text-ink"
                  }`
                : `flex items-center gap-1.5 rounded-control px-2.5 py-1.5 font-mono-face text-[11px] tracking-[0.06em] whitespace-nowrap uppercase transition-colors ${
                    active
                      ? "bg-term-wash font-medium text-term-deep"
                      : "text-ink-soft hover:bg-sunken hover:text-ink"
                  }`
            }
          >
            <span aria-hidden className="text-xs">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Site footer — the other half of what makes this a website rather than an app. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-panel">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div>
          <div className="font-mono-face text-xs font-bold tracking-[0.12em]">
            JOBMATCH<span style={{ color: "var(--term)" }}>_AI</span>
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            Your personal AI job hunter — resume in, ranked jobs out.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-xs text-ink-soft transition-colors hover:text-term-deep"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <p className="mono-label md:text-right">
          SMART SEARCH · INTELLIGENT MATCHING · DAILY DISCOVERY
        </p>
      </div>
    </footer>
  );
}
