"use server-only";

import {
  inferArrangement,
  stripHtml,
  toInt,
  type RawJob,
  type SourceAdapter,
  type SourceFetchResult,
  type SourceQuery,
} from "./types";

/**
 * Himalayas — https://himalayas.app/jobs/api
 * Public, no API key, remote roles with salary data on many listings.
 */

type HimalayasJob = {
  guid?: string;
  title: string;
  companyName: string;
  description?: string;
  excerpt?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string;
  seniority?: string[];
  locationRestrictions?: string[];
  categories?: string[];
  /**
   * Unix epoch **seconds as a number**, verified live against the API. It was
   * previously typed as a string and handed straight to `new Date()`, which
   * silently produced 1970-01-21 for every listing — so the freshness filter
   * threw away this entire source while it looked perfectly healthy.
   */
  pubDate?: number | string;
  applicationLink?: string;
};

export const himalayasAdapter: SourceAdapter = {
  key: "himalayas",
  label: "Himalayas",
  configureHint: "No key needed — public API.",
  attribution: "Jobs via Himalayas",
  isConfigured: () => true,

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const params = new URLSearchParams({ limit: "50" });
    if (query.text) params.set("search", query.text);
    if (query.remoteOnly) params.set("remote", "true");

    const res = await fetch(`https://himalayas.app/jobs/api?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "JobMatchAI/1.0" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Himalayas responded ${res.status}`);

    const data = (await res.json()) as { jobs?: HimalayasJob[] };
    const locationWanted = (query.location ?? "").trim().toLowerCase();

    const jobs: RawJob[] = (data.jobs ?? [])
      .filter((j) => j?.title && j?.companyName)
      .filter((j) => !locationWanted || matchesLocation(j.locationRestrictions, locationWanted))
      .slice(0, 50)
      .map((j) => {
        const min = toInt(j.minSalary);
        const max = toInt(j.maxSalary);
        const period = j.salaryPeriod?.toUpperCase() ?? null;
        const currency = j.currency?.toUpperCase() ?? null;
        return {
          sourceJobId: j.guid ?? `${j.companyName}-${j.title}`,
          title: j.title.slice(0, 200),
          company: j.companyName.slice(0, 160),
          location: (j.locationRestrictions ?? []).join(", ") || null,
          workArrangement: inferArrangement(
            (j.locationRestrictions ?? []).join(", "),
            "remote",
          ),
          employmentType: j.employmentType ?? null,
          experienceLevel: (j.seniority ?? [])[0] ?? null,
          description: stripHtml(j.description ?? j.excerpt),
          tags: (j.categories ?? []).map((c) => c.replace(/-/g, " ")),
          salaryMin: min,
          salaryMax: max,
          salaryCurrency: currency,
          salaryPeriod: period,
          salaryOriginal: min || max ? `${min ?? "?"} – ${max ?? "?"} ${currency ?? ""} ${period ?? ""}`.trim() : null,
          postedDate: toPostedDate(j.pubDate),
          applicationUrl: j.applicationLink ?? null,
          directApply: true,
        } satisfies RawJob;
      });

    return { jobs };
  },
};

/**
 * Does any of a posting's restrictions cover the wanted place?
 *
 * Requiring the full query string to appear meant a search for
 * "Hyderabad, Telangana, India" discarded every listing whose only
 * restriction was "India" — silently emptying an otherwise working source.
 * Falling back through progressively shorter suffixes matches the wider
 * listing too, which is what someone searching that string actually wants.
 */
export function matchesLocation(
  restrictions: string[] | undefined,
  wanted: string,
): boolean {
  const w = wanted.trim().toLowerCase();
  if (!w) return true;
  const list = (restrictions ?? []).map((r) => r.toLowerCase());
  if (list.some((r) => r.includes(w))) return true;

  const parts = w.split(",").map((p) => p.trim()).filter(Boolean);
  // Try progressively broader: "city, state, country" → "state, country" → "country".
  for (let start = 1; start < parts.length; start++) {
    const candidate = parts.slice(start).join(", ");
    if (list.some((r) => r.includes(candidate))) return true;
  }
  return false;
}

/**
 * Himalayas returns epoch seconds; other feeds send ISO strings. Numbers below
 * ~1e11 are seconds (year 5138 and beyond means it is already milliseconds).
 */
export function toPostedDate(value: number | string | undefined | null): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    const ms = value < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // A numeric string still needs the seconds→ms correction.
  if (/^\d+$/.test(value)) return toPostedDate(Number(value));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
