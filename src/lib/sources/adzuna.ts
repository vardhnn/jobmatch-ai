"use server-only";

import { config } from "@/lib/config";
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
 * Adzuna — https://api.adzuna.com/v1/api/jobs/{country}/search/{page}
 * Needs a free app_id/api_key pair (developer.adzuna.com). Aggregates thousands
 * of boards (including LinkedIn, Indeed and Naukri listings), so it is the
 * highest-value source once the key is present.
 */

type AdzunaJob = {
  id: string;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  description?: string;
  created?: string;
  redirect_url?: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_minimum?: boolean;
  contract_type?: string;
  contract_time?: string;
  category?: { label?: string };
  keyterms?: string[];
};

export const adzunaAdapter: SourceAdapter = {
  key: "adzuna",
  label: "Adzuna",
  configureHint: "Requires ADZUNA_APP_ID + ADZUNA_API_KEY from developer.adzuna.com.",
  attribution: "Jobs via Adzuna",
  isConfigured: () => Boolean(config.sources.adzuna.appId && config.sources.adzuna.apiKey),

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const { appId, apiKey } = config.sources.adzuna;
    if (!appId || !apiKey) throw new Error("Adzuna credentials are not configured");

    const country = countryFor(query.location);
    const currency = CURRENCY_BY_COUNTRY[country] ?? "GBP";
    const params = new URLSearchParams({
      app_id: appId,
      app_key: apiKey,
      results_per_page: "50",
    });
    if (query.text) params.set("what", query.text);
    if (query.location) params.set("where", query.location);
    if (query.remoteOnly) params.set("remote", "1");

    // Adzuna's edge is picky, and its failure mode is a generic HTML page with
    // HTTP 400 rather than a JSON error. Three things must be exactly right:
    //
    //   1. The `/search/` segment — omitting it returns UNKNOWN_METHOD.
    //   2. Spaces as %20, not "+" (URLSearchParams' default).
    //   3. `content-type` with a HYPHEN, and a literal "/" — the documented
    //      `content_type` (underscore) form is rejected with the HTML error
    //      page, and URLSearchParams would encode the slash as %2F.
    const encoded = params.toString().replace(/\+/g, "%20");
    const qs = `${encoded}&content-type=application/json`;
    const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${qs}`;
    const data = await fetchWithBackoff(url);
    const jobs: RawJob[] = (data.results ?? [])
      .filter((j) => j?.title && j?.company?.display_name)
      .slice(0, 50)
      .map((j) => {
        const location = j.location?.display_name ?? null;
        const min = toInt(j.salary_min);
        const max = toInt(j.salary_max);
        return {
          sourceJobId: String(j.id),
          title: j.title.slice(0, 200),
          company: (j.company?.display_name ?? "Unknown").slice(0, 160),
          location,
          workArrangement: inferArrangement(location, j.contract_type),
          employmentType: [j.contract_type, j.contract_time].filter(Boolean).join(" ") || null,
          experienceLevel: null,
          description: stripHtml(j.description),
          tags: [...(j.keyterms ?? []), ...(j.category?.label ? [j.category.label] : [])],
          salaryMin: min,
          salaryMax: max,
          salaryCurrency: currency,
          salaryPeriod: "ANNUAL",
          salaryOriginal: min || max ? `${min ?? "?"} – ${max ?? "?"} ${currency}` : null,
          postedDate: j.created ? new Date(j.created) : null,
          applicationUrl: j.redirect_url ?? null,
          directApply: false,
        } satisfies RawJob;
      });

    return { jobs };
  },
};

/**
 * Adzuna's free tier throttles aggressively and answers with an HTML error
 * page (and a misleading 400 status) rather than a clean 429. Retry a couple of
 * times with backoff, and surface a readable message instead of raw HTML.
 */
async function fetchWithBackoff(
  url: string,
  attempts = 3,
): Promise<{ results?: AdzunaJob[] }> {
  let lastMessage = "Adzuna request failed";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "JobMatchAI/1.0" },
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      });

      const text = await res.text();
      const isJson = text.trimStart().startsWith("{");

      if (res.ok && isJson) {
        return JSON.parse(text) as { results?: AdzunaJob[] };
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(`Adzuna rejected the credentials (HTTP ${res.status}).`);
      }

      // Adzuna answers a malformed query and a throttled one with the SAME
      // generic HTML page + HTTP 400, so the two are indistinguishable from the
      // response alone. A JSON body is a genuine API-level error worth showing;
      // the HTML page means "request shape or rate limit" — name both causes
      // rather than guessing at one.
      lastMessage = isJson
        ? `Adzuna error ${res.status}: ${text.slice(0, 160)}`
        : `Adzuna returned an HTML error page (HTTP ${res.status}). This is either free-tier ` +
          `throttling or a rejected query shape — retrying, but if it persists check the ` +
          `request format against https://developer.adzuna.com/docs`;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Adzuna rejected")) throw err;
      lastMessage = err instanceof Error ? err.message : String(err);
    }

    if (attempt < attempts) {
      // Adzuna's free tier needs multi-second gaps between requests, so the
      // backoff is deliberately slow (≈5s, ≈15s).
      await new Promise((r) => setTimeout(r, 5000 * 3 ** (attempt - 1)));
    }
  }

  throw new Error(lastMessage);
}

/** Adzuna reports salaries in the local currency of the country partition. */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  in: "INR",
  de: "EUR",
  fr: "EUR",
  gb: "GBP",
  ca: "CAD",
  au: "AUD",
  nl: "EUR",
  es: "EUR",
  it: "EUR",
  pl: "PLN",
};

/** Adzuna is partitioned by country; pick one from the preferred location. */
function countryFor(location: string | null | undefined): string {
  const l = (location ?? "").toLowerCase();
  if (/\b(india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|chennai|gurugram|noida)\b/.test(l)) {
    return "in";
  }
  if (/\b(germany|berlin|munich|hamburg)\b/.test(l)) return "de";
  if (/\b(france|paris)\b/.test(l)) return "fr";
  if (/\b(uk|united kingdom|london|manchester|edinburgh)\b/.test(l)) return "gb";
  if (/\b(canada|toronto|vancouver)\b/.test(l)) return "ca";
  if (/\b(australia|sydney|melbourne)\b/.test(l)) return "au";
  if (/\b(netherlands|amsterdam)\b/.test(l)) return "nl";
  if (/\b(spain|madrid|barcelona)\b/.test(l)) return "es";
  if (/\b(italy|milan|rome)\b/.test(l)) return "it";
  if (/\b(poland|warsaw)\b/.test(l)) return "pl";
  return "gb";
}
