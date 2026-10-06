"use client";

import { useTheme } from "./theme-provider";

/**
 * Always-visible dark/light toggle.
 *
 * The account menu already carried a dark-mode row, but a switch you have to
 * open a menu to find is not a toggle — it is a hidden setting. This puts it
 * in both headers, one tap from anywhere, and keeps the menu row as the
 * discoverable path for people who look there first.
 *
 * The glyph shows the theme you would switch *to* (moon in light mode, sun in
 * dark), while the accessible name states the same thing in words, so the two
 * can never contradict each other.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line-strong font-mono-face text-sm leading-none hover:bg-sunken ${className}`}
    >
      {/* Sun in light mode, moon in dark — the icon shows what you'd switch TO. */}
      <span aria-hidden>{isDark ? "☀" : "☾"}</span>
    </button>
  );
}