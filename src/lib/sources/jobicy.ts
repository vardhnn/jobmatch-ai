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
 * Jobicy — https://jobicy.com/api/v2/remote-jobs
 * Public, no API key, remote roles. Supports tag/count filters; the free tier
 * caps a response at 50 jobs.
 */

type JobicyJob = {
  id: number | string;
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: number | string;
};

export const jobicyAdapter: SourceAdapter = {
  key: "jobicy",
  label: "Jobicy",
  configureHint: "No key needed — public API.",
  attribution: "Jobs via Jobicy",
  isConfigured: () => true,

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const params = new URLSearchParams({ count: "50" });
    // Jobicy's `tag` filter is a taxonomy slug, so we only send it when the
    // generated query is a single simple word (e.g. "backend").
    const single = query.text.trim().toLowerCase();
    if (single && /^[a-z]+$/.test(single)) params.set("tag", single);
    if (query.location) {
      const geo = geoFromLocation(query.location);
      if (geo) params.set("geo", geo);
    }

    const res = await fetch(`https://jobicy.com/api/v2/remote-jobs?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "JobMatchAI/1.0" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) {
      // Jobicy returns a helpful JSON error body on a bad slug — surface it.
      const detail = await res.text().catch(() => "");
      throw new Error(`Jobicy responded ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`);
    }

    const data = (await res.json()) as { jobs?: JobicyJob[] };
    const wanted = query.text.trim().toLowerCase();

    const jobs: RawJob[] = (data.jobs ?? [])
      .filter((j) => j?.jobTitle && j?.companyName)
      .filter((j) => !wanted || matches(j, wanted))
      .slice(0, 50)
      .map((j) => ({
        sourceJobId: String(j.id),
        title: j.jobTitle.slice(0, 200),
        company: j.companyName.slice(0, 160),
        location: j.jobGeo?.trim() || null,
        workArrangement: inferArrangement(j.jobGeo, "remote"),
        employmentType: (j.jobType ?? [])[0] ?? null,
        experienceLevel: j.jobLevel ?? null,
        description: stripHtml(j.jobDescription ?? j.jobExcerpt),
        tags: j.jobIndustry ?? [],
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryOriginal: null,
        postedDate: toDate(j.pubDate),
        applicationUrl: j.url ?? null,
        directApply: false,
      }));

    return { jobs };
  },
};

function matches(j: JobicyJob, wanted: string): boolean {
  const hay = `${j.jobTitle} ${j.companyName} ${(j.jobIndustry ?? []).join(" ")} ${j.jobExcerpt ?? ""}`.toLowerCase();
  if (hay.includes(wanted)) return true;
  const terms = wanted.split(/\s+/).filter((t) => t.length > 2);
  return terms.length > 0 && terms.every((t) => hay.includes(t));
}

function toDate(v: number | string | undefined): Date | null {
  if (!v) return null;
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Map a city to Jobicy's published geoSlug values; unknown cities → null. */
function geoFromLocation(location: string): string | null {
  const l = location.toLowerCase();
  // Slugs come from https://jobicy.com/api/v2/remote-jobs?get=locations
  const table: [RegExp, string][] = [
    // Jobicy has no `india` slug — the whole subcontinent lives under `apac`.
    [/\bindia\b|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|chennai|gurugram|noida/, "apac"],
    [/\b(pakistan|bangladesh|sri lanka|nepal)\b/, "apac"],
    [/\bunited states\b|\busa\b|\bu\.s\.|new york|san francisco|seattle|austin|chicago|boston/, "usa"],
    [/\buk\b|united kingdom|london|manchester|edinburgh/, "uk"],
    [/\bgermany\b|berlin|munich|hamburg/, "germany"],
    [/\bcanada\b|toronto|vancouver/, "canada"],
    [/\baustralia\b|sydney|melbourne/, "australia"],
    [/\bnetherlands\b|amsterdam/, "netherlands"],
    [/\bspain\b|madrid|barcelona/, "spain"],
    [/\bfrance\b|paris/, "france"],
    [/\bpoland\b|warsaw/, "poland"],
    [/\bbrazil\b|sao paulo/, "brazil"],
    [/\bireland\b|dublin/, "ireland"],
    [/\bsweden\b|stockholm/, "sweden"],
  ];
  for (const [re, geo] of table) if (re.test(l)) return geo;
  return null;
}
