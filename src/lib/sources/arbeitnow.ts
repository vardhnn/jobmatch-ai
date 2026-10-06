"use server-only";

import {
  inferArrangement,
  stripHtml,
  type RawJob,
  type SourceAdapter,
  type SourceFetchResult,
  type SourceQuery,
} from "./types";

/**
 * Arbeitnow — https://www.arbeitnow.com/api/job-board-api
 * Public, no API key, mostly European + remote roles. One page = ~326 jobs,
 * so we only ever pull the first page (it is sorted newest-first).
 */

type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number; // unix seconds
};

export const arbeitnowAdapter: SourceAdapter = {
  key: "arbeitnow",
  label: "Arbeitnow",
  configureHint: "No key needed — public API.",
  attribution: "Jobs via Arbeitnow",
  isConfigured: () => true,

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const params = new URLSearchParams({ page: "1" });
    if (query.text) params.set("search", query.text);

    const res = await fetch(`https://www.arbeitnow.com/api/job-board-api?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "JobMatchAI/1.0" },
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Arbeitnow responded ${res.status}`);

    const data = (await res.json()) as { data?: ArbeitnowJob[] };
    const wanted = query.text.trim().toLowerCase();
    const locationWanted = (query.location ?? "").trim().toLowerCase();

    const jobs: RawJob[] = (data.data ?? [])
      .filter((j) => j?.title && j?.company_name)
      // The endpoint has no real search, so we filter client-side.
      .filter((j) => {
        const hay = `${j.title} ${j.company_name} ${(j.tags ?? []).join(" ")}`.toLowerCase();
        const roleOk = !wanted || hay.includes(wanted) || termsMatch(hay, wanted);
        const locOk =
          !locationWanted ||
          (j.location ?? "").toLowerCase().includes(locationWanted) ||
          j.remote;
        return roleOk && locOk;
      })
      .slice(0, 50)
      .map((j) => ({
        sourceJobId: j.slug,
        title: j.title.slice(0, 200),
        company: j.company_name.slice(0, 160),
        location: j.location?.trim() || null,
        workArrangement: j.remote ? "REMOTE" : inferArrangement(j.location),
        employmentType: (j.job_types ?? [])[0] ?? null,
        experienceLevel: null,
        description: stripHtml(j.description),
        tags: j.tags ?? [],
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryOriginal: null,
        postedDate: j.created_at ? new Date(j.created_at * 1000) : null,
        applicationUrl: j.url ?? null,
        directApply: true,
      }));

    return { jobs, warning: "Arbeitnow filters client-side (its API has no search).", };
  },
};

/** Loose match: every word of the query appears somewhere in the posting. */
function termsMatch(haystack: string, query: string): boolean {
  const terms = query.split(/\s+/).filter((t) => t.length > 2);
  return terms.length > 0 && terms.every((t) => haystack.includes(t));
}
