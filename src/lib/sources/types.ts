/**
 * Job source contracts.
 *
 * Every adapter normalizes its provider's payload into `RawJob` so the search
 * pipeline never has to know which board a job came from.
 */

export type WorkArrangement = "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN";

export type RawJob = {
  /** Provider-native id, unique within the source. */
  sourceJobId: string;
  title: string;
  company: string;
  location: string | null;
  workArrangement: WorkArrangement;
  employmentType: string | null;
  experienceLevel: string | null;
  description: string | null;
  /** Tags/categories the board already provides — cheap skill hints. */
  tags: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  /** Raw pay text exactly as published; never invented. */
  salaryOriginal: string | null;
  postedDate: Date | null;
  applicationUrl: string | null;
  /** True when the posting is hosted by the employer (preferDirectApply). */
  directApply: boolean;
};

export type SourceQuery = {
  /** Free-text query, usually a generated role query. */
  text: string;
  location?: string | null;
  remoteOnly?: boolean;
};

export type SourceFetchResult = {
  jobs: RawJob[];
  /** Non-fatal problem worth surfacing in the run summary. */
  warning?: string;
};

export type SourceFetchError = {
  code: string;
  message: string;
};

export type SourceAdapter = {
  key: string;
  label: string;
  /** Whether the adapter can run at all with the current env. */
  isConfigured: () => boolean;
  /** Short note shown on the sources page. */
  configureHint: string;
  /** Attribution required by the provider's terms (e.g. RemoteOK). */
  attribution?: string;
  fetchJobs: (query: SourceQuery) => Promise<SourceFetchResult>;
};

/** Strip HTML from board descriptions — they are all HTML-heavy. */
export function stripHtml(html: string | null | undefined, maxLen = 6000): string | null {
  if (!html) return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLen) : null;
}

/** Best-effort work-arrangement inference from location/title text. */
export function inferArrangement(
  location: string | null | undefined,
  extra?: string | null,
): WorkArrangement {
  const hay = `${location ?? ""} ${extra ?? ""}`.toLowerCase();
  if (/\bremote\b|anywhere|worldwide|distributed/.test(hay)) return "REMOTE";
  if (/\bhybrid\b/.test(hay)) return "HYBRID";
  if (location && location.trim()) return "ONSITE";
  return "UNKNOWN";
}

export function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
