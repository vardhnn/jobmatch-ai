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
 * Remotive — https://remotive.com/api/remote-jobs
 * Public, no API key, remote roles worldwide.
 */

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
};

export const remotiveAdapter: SourceAdapter = {
  key: "remotive",
  label: "Remotive",
  configureHint: "No key needed — public API.",
  attribution: "Jobs via Remotive",
  isConfigured: () => true,

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const params = new URLSearchParams({ limit: "50" });
    if (query.text) params.set("search", query.text);
    if (query.remoteOnly) params.set("remote", "true");

    const url = `https://remotive.com/api/remote-jobs?${params}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "JobMatchAI/1.0" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Remotive responded ${res.status}`);

    const data = (await res.json()) as { jobs?: RemotiveJob[] };
    const jobs: RawJob[] = (data.jobs ?? [])
      .filter((j) => j?.title && j?.company_name)
      .map((j) => {
        const salary = j.salary?.trim() || null;
        const numbers = salary ? [...salary.matchAll(/[\d][\d,\.]*/g)].map((m) => toInt(m[0])) : [];
        const valid = numbers.filter((n): n is number => n !== null);
        return {
          sourceJobId: String(j.id),
          title: j.title.slice(0, 200),
          company: j.company_name.slice(0, 160),
          location: j.candidate_required_location?.trim() || null,
          workArrangement: inferArrangement(j.candidate_required_location, "remote"),
          employmentType: j.job_type ?? null,
          experienceLevel: null,
          description: stripHtml(j.description),
          tags: [...(j.tags ?? []), ...(j.category ? [j.category] : [])],
          salaryMin: valid[0] ?? null,
          salaryMax: valid[1] ?? null,
          salaryCurrency: currencyFromText(salary),
          salaryPeriod: null,
          salaryOriginal: salary,
          postedDate: j.publication_date ? new Date(j.publication_date) : null,
          applicationUrl: j.url ?? null,
          directApply: false,
        } satisfies RawJob;
      });

    return { jobs };
  },
};

function currencyFromText(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/\b(USD|EUR|GBP|INR|CAD|AUD|SGD|CHF|SEK|NOK|DKK|ZAR|BRL)\b/i);
  return m ? m[1].toUpperCase() : null;
}
