import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "amber";

const styles: Record<Variant, string> = {
  primary:
    "bg-term text-white border-term-deep hover:bg-term-deep active:translate-y-px",
  secondary:
    "bg-panel text-ink border-line-strong hover:border-ink hover:bg-sunken active:translate-y-px",
  ghost:
    "bg-transparent text-ink-soft border-transparent hover:text-ink hover:bg-sunken",
  danger:
    "bg-danger-wash text-danger border-danger/40 hover:bg-danger hover:text-white",
  amber:
    "bg-amber text-white border-amber hover:brightness-95 active:translate-y-px",
};

export function RetroButton({
  children,
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}) {
  const sizeCls =
    size === "sm"
      ? "h-8 px-3 text-xs"
      : size === "lg"
        ? "h-11 px-6 text-sm"
        : "h-9 px-4 text-sm";

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-control border font-medium tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${sizeCls} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
