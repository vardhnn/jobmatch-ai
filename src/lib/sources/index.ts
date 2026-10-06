"use server-only";

import { adzunaAdapter } from "./adzuna";
import { arbeitnowAdapter } from "./arbeitnow";
import { atsAdapter } from "./ats";
import { himalayasAdapter } from "./himalayas";
import { jobicyAdapter } from "./jobicy";
import { linkedinAdapter } from "./linkedin";
import { museAdapter } from "./muse";
import { remoteokAdapter } from "./remoteok";
import { remotiveAdapter } from "./remotive";
import type { SourceAdapter, SourceFetchError, SourceFetchResult, SourceQuery } from "./types";

/**
 * Job source registry.
 *
 * Every board the app can pull from is listed here with its own adapter.
 *
 * On the big three portals:
 *   • LinkedIn  — read via its *unauthenticated public guest* endpoint, which
 *     is the same fragment the logged-out job board renders. No cookies, no
 *     account, no evasion. Best-effort; see `linkedin.ts`.
 *   • Indeed    — HTTP 403 with a captcha page for every server-side request.
 *   • Naukri    — 301s to the homepage; its JSON gateway 404s.
 * Indeed and Naukri are therefore NOT scraped: getting past those blocks
 * means building detection-evasion, which we don't do. Instead `ats.ts` pulls
 * the same employers straight from their own boards (Ashby/Lever/
 * SmartRecruiters), which is first-party, documented, and carries better
 * data than an aggregator copy.
 */
const ADAPTERS: SourceAdapter[] = [
  remotiveAdapter,
  himalayasAdapter,
  jobicyAdapter,
  remoteokAdapter,
  museAdapter,
  arbeitnowAdapter,
  adzunaAdapter,
  atsAdapter,
  linkedinAdapter,
];

export const ALL_SOURCE_KEYS = ADAPTERS.map((a) => a.key);

/** Which sources should be ON for a brand-new account. */
export const DEFAULT_ENABLED_KEYS = ["remotive", "himalayas", "jobicy", "ats", "linkedin"];

export function getAdapter(key: string): SourceAdapter | null {
  return ADAPTERS.find((a) => a.key === key) ?? null;
}

export function listAdapters(): SourceAdapter[] {
  return ADAPTERS;
}

/** Safe single-source fetch: never throws, always reports a structured error. */
export async function fetchFromSource(
  key: string,
  query: SourceQuery,
): Promise<{ jobs: SourceFetchResult["jobs"]; warning?: string; error?: SourceFetchError }> {
  const adapter = getAdapter(key);
  if (!adapter) {
    return { jobs: [], error: { code: "UNKNOWN_SOURCE", message: `No adapter for "${key}".` } };
  }
  if (!adapter.isConfigured()) {
    return {
      jobs: [],
      error: {
        code: "NOT_CONFIGURED",
        message: `${adapter.label} needs credentials that are not set.`,
      },
    };
  }
  try {
    const result = await adapter.fetchJobs(query);
    return { jobs: result.jobs, warning: result.warning };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jobs: [],
      error: { code: "FETCH_FAILED", message: `${adapter.label}: ${message}` },
    };
  }
}

export type { RawJob, SourceAdapter, SourceFetchResult, SourceQuery } from "./types";
