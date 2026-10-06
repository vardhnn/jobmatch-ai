import type { ReactNode } from "react";
import { safeApplyUrl } from "@/lib/apply-url";

/**
 * Apply link.
 *
 * Renders a job's destination honestly: only vetted http(s) links become
 * anchors, the target host is shown so the user knows where they are going, and
 * a missing link degrades to a disabled state instead of vanishing.
 *
 * URL vetting itself lives in `@/lib/apply-url` so the ingest pipeline can
 * reject bad links before they ever reach the database.
 */

export function ApplyLink({
  url,
  className = "",
  label = "APPLY",
  size = "sm",
  showHost = false,
}: {
  url: string | null | undefined;
  className?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  /** Render the destination hostname under the label. */
  showHost?: boolean;
}) {
  const target = safeApplyUrl(url);

  if (!target) {
    return (
      <div className={className}>
        <span
          aria-disabled="true"
          title="This posting has no application link"
          className={`inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-control border border-line-strong bg-sunken font-medium tracking-wide text-ink-soft opacity-60 ${
            size === "sm" ? "h-8 px-3 text-xs" : size === "lg" ? "h-11 px-6 text-sm" : "h-9 px-4 text-sm"
          }`}
        >
          NO LINK
        </span>
        {showHost ? (
          <span className="mono-label mt-1 block">SOURCE PROVIDED NO URL</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <a
        href={target.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={`Opens ${target.host} in a new tab`}
        className={`inline-flex items-center justify-center gap-2 rounded-control border border-term bg-term text-ink font-medium tracking-wide transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-term ${
          size === "sm" ? "h-8 px-3 text-xs" : size === "lg" ? "h-11 px-6 text-sm" : "h-9 px-4 text-sm"
        }`}
      >
        {label} ↗
      </a>
      {showHost ? (
        <span className="mono-label mt-1 block truncate" title={target.host}>
          {target.host}
        </span>
      ) : null}
    </div>
  );
}

/** Small inline variant for dense lists and meta rows. */
export function ApplyTextLink({
  url,
  children,
}: {
  url: string | null | undefined;
  children?: ReactNode;
}) {
  const target = safeApplyUrl(url);
  if (!target) return <span className="text-ink-soft">No link provided</span>;

  return (
    <a
      href={target.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-term-deep underline underline-offset-2 hover:opacity-80"
      title={`Opens ${target.host} in a new tab`}
    >
      {children ?? target.host}
    </a>
  );
}
