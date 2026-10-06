import type { CSSProperties, ReactNode } from "react";

/** Old-school UI panel: thin border, slight radius, subtle shadow. */
export function Panel({
  children,
  className = "",
  sunken = false,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  sunken?: boolean;
  as?: "div" | "section" | "article" | "aside";
}) {
  return (
    <Tag
      className={`rounded-card border border-line ${
        sunken ? "bg-sunken" : "bg-panel"
      } shadow-[0_1px_2px_rgba(28,27,24,0.06)] ${className}`}
    >
      {children}
    </Tag>
  );
}

/**
 * Small uppercase monospace label used above sections and fields.
 *
 * Accepts `style` and arbitrary data attributes so callers can drive
 * scroll-reveal staggering without wrapping the label in a throwaway element.
 */
export function MonoLabel({
  children,
  className = "",
  style,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  [key: `data-${string}`]: unknown;
}) {
  return (
    <span className={`mono-label ${className}`} style={style} {...rest}>
      {children}
    </span>
  );
}

/** Section header: mono eyebrow + sans title + optional right-side slot. */
export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <div className="mono-label mb-1">{eyebrow}</div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}
