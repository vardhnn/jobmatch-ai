import type { ReactNode } from "react";

/**
 * Responsive page header — the single component every page title uses.
 *
 * Ad-hoc `<h1 className="text-2xl">` markup kept getting three things wrong:
 *
 * - **Fixed type** — `text-2xl` is oversized on a phone and undersized on a
 *   desktop. This steps up across breakpoints instead.
 * - **Overflow** — long job titles ("Senior Backend Engineer, Payments & Risk
 *   Platform") pushed the layout wide on narrow screens. `break-words` plus
 *   `min-w-0` on the text column lets the title wrap instead.
 * - **Action crowding** — header actions sat next to the title and overlapped
 *   it on mobile. Actions now wrap onto their own row below `sm`.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className = "",
}: {
  title: ReactNode;
  /** Small uppercase monospace line above the title (company name, etc.). */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Buttons/badges. Wraps below the title on narrow viewports. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 ${className}`}>
      {/* min-w-0 lets this column shrink inside the flex row, which is what
          makes break-words work instead of overflowing. */}
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="mono-label mb-1 truncate">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl lg:text-[28px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm break-words text-ink-soft">{description}</p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      ) : null}
    </div>
  );
}
