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
 * RemoteOK — https://remoteok.com/api
 * Public, no API key, but its terms REQUIRE a visible link back to RemoteOK
 * and credit in the UI, so `attribution` is set and the jobs page renders it.
 */

type RemoteOkJob = {
  id: string;
  slug?: string;
  date?: string;
  epoch?: number;
  company: string;
  position: string;
  location?: string;
  tags?: string[];
  description?: string;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url?: string;
  original?: boolean;
};

export const remoteokAdapter: SourceAdapter = {
  key: "remoteok",
  label: "RemoteOK",
  configureHint: "No key needed — link back to RemoteOK is required by their terms.",
  attribution: "Jobs via RemoteOK",
  isConfigured: () => true,

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const res = await fetch("https://remoteok.com/api", {
      headers: { Accept: "application/json", "User-Agent": "JobMatchAI/1.0" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`RemoteOK responded ${res.status}`);

    const data = (await res.json()) as unknown[];
    const wanted = query.text.trim().toLowerCase();
    const locationWanted = (query.location ?? "").trim().toLowerCase();

    const jobs: RawJob[] = data
      // The first element is a legal-notice record, not a job.
      .filter((x): x is RemoteOkJob => !!x && typeof x === "object" && "position" in x)
      .filter((j) => j.position && j.company)
      .filter((j) => !wanted || `${j.position} ${j.company} ${(j.tags ?? []).join(" ")}`.toLowerCase().includes(wanted))
      .filter((j) => !locationWanted || (j.location ?? "").toLowerCase().includes(locationWanted))
      .slice(0, 50)
      .map((j) => ({
        sourceJobId: String(j.id ?? j.slug ?? j.position),
        title: j.position.slice(0, 200),
        company: j.company.slice(0, 160),
        location: j.location?.trim() || "Worldwide",
        workArrangement: inferArrangement(j.location, "remote"),
        employmentType: null,
        experienceLevel: null,
        description: stripHtml(j.description),
        tags: j.tags ?? [],
        salaryMin: toInt(j.salary_min),
        salaryMax: toInt(j.salary_max),
        salaryCurrency: "USD",
        salaryPeriod: "ANNUAL",
        salaryOriginal:
          j.salary_min || j.salary_max
            ? `${j.salary_min ?? "?"} – ${j.salary_max ?? "?"} USD`
            : null,
        postedDate: j.date ? new Date(j.date) : j.epoch ? new Date(j.epoch * 1000) : null,
        applicationUrl: j.apply_url ?? j.url ?? null,
        directApply: false,
      }));

    return {
      jobs,
      warning: "RemoteOK requires attribution — its link is rendered on every job we show from it.",
    };
  },
};
