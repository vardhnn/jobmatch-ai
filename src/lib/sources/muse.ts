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
 * The Muse — https://www.themuse.com/api/public/jobs
 * Public company directory API, no key required for light use. Strong on
 * locations, levels and categories; descriptions are HTML blobs.
 */

type MuseJob = {
  id: number;
  name: string;
  contents?: string;
  publication_date?: string;
  short_name?: string;
  locations?: { name: string }[];
  categories?: { name: string }[];
  levels?: { name: string; short_name?: string }[];
  tags?: string[];
  refs?: { landing_page?: string };
  company?: { name: string };
};

export const museAdapter: SourceAdapter = {
  key: "muse",
  label: "The Muse",
  configureHint: "No key needed — public API (be gentle with request volume).",
  attribution: "Jobs via The Muse",
  isConfigured: () => true,

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const params = new URLSearchParams({ page: "1" });
    if (query.text) params.set("search", query.text);
    if (query.location) params.set("location", query.location);

    const res = await fetch(`https://www.themuse.com/api/public/jobs?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "JobMatchAI/1.0" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`The Muse responded ${res.status}`);

    const data = (await res.json()) as { results?: MuseJob[] };
    const jobs: RawJob[] = (data.results ?? [])
      .filter((j) => j?.name && j?.company?.name)
      .slice(0, 25)
      .map((j) => {
        const location = (j.locations ?? []).map((l) => l.name).join(", ") || null;
        return {
          sourceJobId: String(j.id),
          title: j.name.slice(0, 200),
          company: (j.company?.name ?? "Unknown").slice(0, 160),
          location,
          workArrangement: inferArrangement(location),
          employmentType: null,
          experienceLevel: (j.levels ?? [])[0]?.name ?? null,
          description: stripHtml(j.contents),
          tags: [
            ...(j.categories ?? []).map((c) => c.name),
            ...(j.levels ?? []).map((l) => l.name),
          ],
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          salaryPeriod: null,
          salaryOriginal: null,
          postedDate: j.publication_date ? new Date(j.publication_date) : null,
          applicationUrl: j.refs?.landing_page ?? null,
          directApply: false,
        } satisfies RawJob;
      });

    return { jobs };
  },
};
