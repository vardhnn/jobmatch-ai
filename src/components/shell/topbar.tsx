"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteNav } from "./nav";
import { StatusDot } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useTheme } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

type Me = { user: { id: string; email: string }; profile: { name: string | null } | null };

type Note = {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  createdAt: string;
};

function initials(email: string, name: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  }
  return email.slice(0, 2).toUpperCase();
}

/**
 * Site header: brand, primary navigation, system status, notification bell and
 * the account menu (profile info, settings, dark mode, logout).
 *
 * Responsive contract — one row at every width:
 *   - `>= lg`  nav sits inline beside the brand.
 *   - `< lg`   nav collapses behind a menu button, so the header never wraps to
 *              two or three rows on a phone (that used to cost ~140px of
 *              vertical space on every single page).
 *
 * Labels appear in exactly one place at a time: the inline nav on desktop, the
 * menu panel on mobile. Each page's own `<h1>` is the page title.
 */
export function Topbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { theme, toggle } = useTheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, noteRes] = await Promise.all([fetch("/api/auth/me"), fetch("/api/notifications")]);
        if (!cancelled && meRes.ok) setMe((await meRes.json()) as Me);
        if (!cancelled && noteRes.ok) {
          const data = await noteRes.json();
          setNotes(data.notifications ?? []);
          setUnread(data.unread ?? 0);
        }
      } catch {
        // menu still works without account details
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openBell() {
    const next = !bellOpen;
    setBellOpen(next);
    if (!next || unread === 0) return;
    // Opening the inbox is the read receipt.
    const res = await fetch("/api/notifications", { method: "PATCH" });
    if (res.ok) {
      setUnread(0);
      setNotes((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }

  // Close the bell on outside click / Escape.
  useEffect(() => {
    if (!bellOpen) return;
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBellOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [bellOpen]);

  // Close the account menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const doLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setConfirmLogout(false);
      // Land on the public page rather than a login form: someone who just
      // signed out still needs to understand what this product is.
      router.replace("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }, [router]);

  const email = me?.user.email ?? "";
  const displayName = me?.profile?.name?.trim() || email.split("@")[0] || "Account";
  const avatar = initials(email || "?", me?.profile?.name ?? null);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6 lg:gap-4 lg:px-8 lg:py-3">
          {/* Mobile nav toggle — the only way nav is reached below lg. */}
          <button
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
            aria-controls="site-mobile-nav"
            className="-ml-1 shrink-0 rounded-control border border-line-strong px-2.5 py-1.5 font-mono-face text-sm lg:hidden"
          >
            {navOpen ? "✕" : "☰"}
          </button>

          <Link
            href="/dashboard"
            className="shrink-0 font-mono-face text-sm font-bold tracking-[0.12em]"
          >
            JOBMATCH<span style={{ color: "var(--term)" }}>_AI</span>
          </Link>

          {/* Inline nav on desktop only; below lg this collapses into the menu. */}
          <SiteNav className="hidden lg:flex lg:flex-1" />

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-2 sm:flex">
            <StatusDot state="ok" />
            <span className="mono-label">SYSTEM READY</span>
          </span>

          <ThemeToggle />

          <div className="relative" ref={bellRef}>
            <button
              onClick={openBell}
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              aria-expanded={bellOpen}
              className="relative rounded-control border border-line-strong px-2.5 py-1.5 font-mono-face text-xs hover:bg-sunken"
            >
              ◉
              {unread > 0 ? (
                <span
                  className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono-face text-[9px] font-bold text-white"
                  style={{ backgroundColor: "var(--danger)" }}
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </button>

            {bellOpen ? (
              <div className="fade-up absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-line-strong bg-panel shadow-[0_10px_40px_rgba(0,0,0,0.25)]">
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <span className="mono-label">NOTIFICATIONS</span>
                  <Link
                    href="/notifications"
                    onClick={() => setBellOpen(false)}
                    className="mono-label hover:text-term-deep"
                  >
                    VIEW ALL →
                  </Link>
                </div>
                {notes.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-ink-soft">
                    Nothing yet — run a search and the summary lands here.
                  </div>
                ) : (
                  <div className="max-h-80 divide-y divide-line overflow-y-auto">
                    {notes.slice(0, 6).map((n) => (
                      <div key={n.id} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: n.read ? "var(--line-strong)" : "var(--term)" }}
                          />
                          <span className="truncate text-sm text-ink">{n.title}</span>
                          <span className="mono-label ml-auto shrink-0">
                            {new Date(n.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{n.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Account menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              className="flex items-center gap-2 rounded-control border border-line-strong py-1 pr-2 pl-1 hover:bg-sunken"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-control font-mono-face text-[11px] font-bold text-white"
                style={{ backgroundColor: "var(--term)" }}
              >
                {avatar}
              </span>
              <span className="mono-label hidden max-w-28 truncate sm:inline">{displayName}</span>
              <span className="mono-label text-[9px]">▾</span>
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="fade-up absolute right-0 z-50 mt-2 w-[min(16rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-line-strong bg-panel shadow-[0_10px_40px_rgba(0,0,0,0.25)]"
              >
                <div className="border-b border-line bg-sunken px-4 py-3">
                  <div className="truncate text-sm font-semibold text-ink">{displayName}</div>
                  <div className="truncate font-mono-face text-[11px] text-ink-soft">
                    {email || "—"}
                  </div>
                </div>

                {/* Account-level settings live here, not in the site nav. */}
                <div className="py-1">
                  <Link
                    href="/settings"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-ink-soft hover:bg-sunken hover:text-ink"
                  >
                    <span className="w-4 text-center font-mono-face text-xs">☰</span>
                    SETTINGS
                  </Link>
                </div>

                <div className="py-1">
                  <button
                    role="menuitem"
                    onClick={toggle}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-ink-soft hover:bg-sunken hover:text-ink"
                  >
                    <span className="w-4 text-center font-mono-face text-xs">
                      {theme === "dark" ? "☾" : "☀"}
                    </span>
                    {theme === "dark" ? "DARK MODE · ON" : "DARK MODE · OFF"}
                    <span className="mono-label ml-auto text-[9px]">TOGGLE</span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmLogout(true);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-danger-wash"
                    style={{ color: "var(--danger)" }}
                  >
                    <span className="w-4 text-center font-mono-face text-xs">⏻</span>
                    LOG OUT
                  </button>
                </div>
              </div>
            ) : null}
            </div>
          </div>
        </div>

        {/* Mobile nav panel — replaces the inline nav below lg. */}
        {navOpen ? (
          <div
            id="site-mobile-nav"
            className="fade-up border-t border-line bg-panel lg:hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <SiteNav
              className="mx-auto w-full max-w-6xl flex-col items-stretch gap-0.5 px-4 py-3 sm:px-6 lg:px-8"
              onNavigate={() => setNavOpen(false)}
              variant="stacked"
            />
          </div>
        ) : null}
      </header>

      <ConfirmDialog
        open={confirmLogout}
        title="Log out of JobMatch AI?"
        body={
          <>
            You will need to sign in again to run searches and see matches. Your profile,
            preferences and saved jobs stay on this device&rsquo;s account.
          </>
        }
        confirmLabel="LOG OUT"
        cancelLabel="STAY SIGNED IN"
        busy={loggingOut}
        onConfirm={doLogout}
        onCancel={() => setConfirmLogout(false)}
      />
    </>
  );
}
