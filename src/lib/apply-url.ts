/**
 * Apply-link URL vetting.
 *
 * Job postings are third-party input, so `applicationUrl` is untrusted. This is
 * the single place that decides whether a destination is safe to store and to
 * render as a link.
 *
 * Deliberately framework-free (no React, no "use server-only") so both the
 * ingest pipeline and the UI component can import it.
 */

const DISALLOWED_PROTOCOLS = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:"]);

export type SafeUrl = { href: string; host: string } | null;

/**
 * Parse and vet a job's application URL.
 * Returns null when the value is missing, unparseable or not http(s).
 */
export function safeApplyUrl(raw: string | null | undefined): SafeUrl {
  const value = raw?.trim();
  if (!value) return null;

  let url: URL;
  try {
    // No base: a bare "example.com/jobs" correctly fails here rather than being
    // silently reinterpreted as a relative path.
    url = new URL(value);
  } catch {
    return null;
  }

  const protocol = url.protocol.toLowerCase();
  if (DISALLOWED_PROTOCOLS.has(protocol)) return null;
  if (protocol !== "http:" && protocol !== "https:") return null;
  if (!url.hostname) return null;

  // Strip a leading "www." so the label reads "remotive.com".
  const host = url.hostname.replace(/^www\./i, "");
  return { href: url.toString(), host };
}
