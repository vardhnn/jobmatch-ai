import type { ReactNode } from "react";

/** Full-height empty state with a terminal vibe. Never a blank screen. */
export function EmptyState({
  code = "NO DATA",
  title,
  body,
  children,
}: {
  code?: string;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-panel px-6 py-14 text-center">
      <span className="mono-label" style={{ color: "var(--muted)" }}>
        ── {code} ──
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body ? (
        <p className="max-w-md text-sm leading-relaxed text-ink-soft">{body}</p>
      ) : null}
      {children ? <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Inline error banner — never fail silently. */
export function ErrorBanner({
  title,
  children,
  tone = "red",
}: {
  title: string;
  children?: ReactNode;
  tone?: "red" | "amber";
}) {
  const c =
    tone === "red"
      ? { bg: "var(--danger-wash)", fg: "var(--danger)", bd: "rgba(168,68,60,0.4)" }
      : { bg: "var(--amber-wash)", fg: "var(--amber)", bd: "rgba(200,117,42,0.4)" };
  return (
    <div
      className="rounded-card border px-4 py-3"
      style={{ backgroundColor: c.bg, borderColor: c.bd }}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full pulse-dot"
          style={{ backgroundColor: c.fg }}
        />
        <span
          className="font-mono-face text-[11px] font-semibold tracking-[0.08em] uppercase"
          style={{ color: c.fg }}
        >
          {title}
        </span>
      </div>
      {children ? (
        <div className="mt-1 text-sm leading-relaxed text-ink-soft">{children}</div>
      ) : null}
    </div>
  );
}
