import type { ReactNode } from "react";

export type Tone = "green" | "amber" | "gray" | "red";

const toneStyles: Record<Tone, { fg: string; bg: string; border: string }> = {
  green: { fg: "var(--term-deep)", bg: "var(--term-wash)", border: "rgba(62,123,82,0.35)" },
  amber: { fg: "var(--amber)", bg: "var(--amber-wash)", border: "rgba(200,117,42,0.35)" },
  gray: { fg: "var(--ink-soft)", bg: "var(--cream)", border: "var(--line-strong)" },
  red: { fg: "var(--danger)", bg: "var(--danger-wash)", border: "rgba(168,68,60,0.35)" },
};

/** Small uppercase status pill: ● STRONG MATCH, ● CONNECTED… */
export function StatusBadge({
  children,
  tone = "gray",
  pulse = false,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  const t = toneStyles[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 font-mono-face text-[10px] font-medium tracking-[0.08em] uppercase ${className}`}
      style={{ color: t.fg, backgroundColor: t.bg, borderColor: t.border }}
    >
      <span
        className={pulse ? "pulse-dot" : ""}
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          backgroundColor: t.fg,
          display: "inline-block",
        }}
      />
      {children}
    </span>
  );
}

/** Retro status indicator dot for source/system states. */
export function StatusDot({
  state,
}: {
  state: "ok" | "warn" | "idle" | "off";
}) {
  const color =
    state === "ok"
      ? "var(--dot-ok)"
      : state === "warn"
        ? "var(--dot-warn)"
        : state === "idle"
          ? "var(--dot-idle)"
          : "var(--dot-off)";
  return (
    <span
      className={state === "idle" ? "pulse-dot" : ""}
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        backgroundColor: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}
