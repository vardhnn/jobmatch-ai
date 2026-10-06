import { createHash } from "crypto";

/**
 * Canonical identity for a posting across boards.
 *
 * The same job syndicated on two sites must collapse into one Job row with two
 * JobSourceRecords. The apply URL is the strongest signal (tracking params and
 * trailing slashes stripped); without one we fall back to normalized
 * company + title.
 */
export function dedupeKeyFor(job: {
  title: string;
  company: string;
  applicationUrl: string | null;
}): string {
  const url = job.applicationUrl?.trim().toLowerCase() ?? "";
  if (url) {
    const clean = url.split("?")[0].replace(/\/+$/, "");
    return `url:${createHash("sha1").update(clean).digest("hex").slice(0, 24)}`;
  }
  const title = job.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const company = job.company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `tc:${createHash("sha1").update(`${company}::${title}`).digest("hex").slice(0, 24)}`;
}
