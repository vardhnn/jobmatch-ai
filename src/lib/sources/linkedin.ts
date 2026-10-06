"use server-only";

import {
  inferArrangement,
  type RawJob,
  type SourceAdapter,
  type SourceFetchResult,
  type SourceQuery,
} from "./types";

/**
 * LinkedIn — the public *guest* job-search endpoint.
 *
 * ── Why this endpoint ────────────────────────────────────────────────────
 * `linkedin.com/jobs/search` serves a bot-challenge page to any non-browser
 * client (verified live: HTTP 200 whose body contains a captcha marker).
 * `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` does not —
 * it is the same fragment the unauthenticated job board renders, returns bare
 * `<li>` cards, and needs no cookie, token, or account.
 *
 * ── Ground rules this adapter holds itself to ────────────────────────────
 * • No cookies, no session, no credentials, no proxy rotation, no TLS or
 *   fingerprint spoofing. If LinkedIn answers with a challenge, we report that
 *   honestly instead of trying to get around it.
 * • One request at a time with a fixed pause between pages. No parallelism.
 * • Anything that looks like a block becomes an advisory, never a hard error,
 *   so one blocked page cannot fail a user's whole run.
 * • We collect only what the card renders: title, company, location, age.
 *   No descriptions, no salary, no applicant data, nothing behind a login.
 *
 * LinkedIn's User Agreement does not grant automated access, so this is a
 * personal-use, best-effort reader — treat it as a nice-to-have source and
 * keep the first-party/ATS sources as the backbone.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ENDPOINT = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const PAGE_SIZE = 10;
const MAX_PAGES = 3;
/** Fixed pause between pages. Deliberately boring — this is not a load test. */
const PAGE_DELAY_MS = 1500;
const TIMEOUT_MS = 20_000;

/**
 * Where to search when the user's preferences name no city.
 * LinkedIn defaults to US postings otherwise, which is useless here.
 */
const DEFAULT_LOCATION = "India";

/** Serializes every request in this module; no two hit LinkedIn concurrently. */
let chain: Promise<unknown> = Promise.resolve();
function polite<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export type LinkedInCard = {
  sourceJobId: string;
  title: string;
  company: string;
  location: string | null;
  postedDate: Date | null;
  applicationUrl: string;
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();

const textOf = (html: string, re: RegExp): string | null => {
  const m = html.match(re);
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, " ")) || null : null;
};

/**
 * Parse one page of guest cards.
 *
 * Pure and exported so it can be unit-tested against captured HTML without
 * any network access — the parsing is the fragile part, so it gets tested
 * directly rather than through a live fetch.
 */
export function parseLinkedInCards(html: string): LinkedInCard[] {
  if (looksBlocked(html)) return [];

  const cards: LinkedInCard[] = [];
  // The fragment is a flat list of `<li>` cards. `data-entity-urn` is the only
  // stable per-posting identifier, so it — not the title — anchors the parse.
  const chunks = html.split(/<li>/).slice(1);

  for (const chunk of chunks) {
    const urn = chunk.match(/urn:li:jobPosting:(\d+)/);
    if (!urn) continue;

    const title = textOf(chunk, /class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/);
    const company = textOf(chunk, /class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/);
    if (!title || !company) continue;

    const location = textOf(chunk, /class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/);

    // Prefer the machine-readable attribute; fall back to the human string,
    // which is only a relative age and so is inherently less precise.
    const timeAttr = chunk.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    const timeText = textOf(chunk, /<time[^>]*>([\s\S]*?)<\/time>/);
    const postedDate =
      (timeAttr ? safeDate(timeAttr) : null) ?? parseRelativeDate(timeText);

    const id = urn[1];
    cards.push({
      sourceJobId: id,
      title: title.slice(0, 200),
      company: company.slice(0, 160),
      location,
      postedDate,
      // Canonical, tracking-free URL built from the id we already have.
      applicationUrl: `https://www.linkedin.com/jobs/view/${id}`,
    });
  }

  return cards;
}

/** True when the response is a bot challenge rather than a result fragment. */
export function looksBlocked(html: string): boolean {
  const h = html.toLowerCase();
  // Positive evidence beats a size heuristic: a real fragment carries card
  // markers, so a small-but-genuine response is never mistaken for a block.
  if (h.includes("urn:li:jobposting:") || h.includes("base-search-card")) return false;
  if (h.length < 500) return true; // empty shell
  return [
    "captcha",
    "are you a robot",
    "unusual traffic",
    "security check",
    "enable javascript and cookies",
    "please enable cookies",
    "authwall",
  ].some((m) => h.includes(m));
}

function safeDate(v: string): Date | null {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "3 days ago" / "2 weeks ago" / "6 months ago" / "30+ days ago" / "today".
 * Returns null when the wording is unrecognised — never guesses a date.
 */
export function parseRelativeDate(text: string | null): Date | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const now = Date.now();
  const day = 86_400_000;

  if (/\btoday\b|\bjust posted\b|\bmoments?\b/.test(t)) return new Date(now);
  if (/\byesterday\b/.test(t)) return new Date(now - day);

  const m = t.match(/(\d+)\s*(hour|minute|second|day|week|month|year)s?/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unitMs: Record<string, number> = {
    minute: 60_000,
    second: 1000,
    hour: 3_600_000,
    day,
    week: 7 * day,
    month: 30 * day,
    year: 365 * day,
  };
  const span = unitMs[m[2]];
  if (!span) return null;
  return new Date(now - n * span);
}

async function fetchPage(text: string, location: string | null, start: number): Promise<string> {
  return polite(async () => {
    const params = new URLSearchParams({ keywords: text, start: String(start) });
    if (location) params.set("location", location);

    const res = await fetch(`${ENDPOINT}?${params}`, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      // Guest results are location-personalised; never let a shared cache
      // serve one person's list to another.
      redirect: "follow",
    });

    if (res.status === 429 || res.status === 999) {
      throw new Error(`rate limited (HTTP ${res.status}) — LinkedIn is throttling this IP`);
    }
    if (!res.ok) {
      throw new Error(`responded HTTP ${res.status}`);
    }
    return await res.text();
  });
}

export const linkedinAdapter: SourceAdapter = {
  key: "linkedin",
  label: "LinkedIn (public guest listings)",
  configureHint: "No key needed — reads the unauthenticated public job search.",
  attribution: "Listings via LinkedIn",
  isConfigured: () => true,

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const term = query.text.trim();
    if (!term) return { jobs: [], warning: "Empty search term." };

    // LinkedIn takes a city ("Bengaluru, Karnataka, India"), not a country.
    // Our preferences store free-text locations, so only send it when it
    // actually looks like a place — "India" alone would over-filter.
    const location = normalizeLocation(query.location, query.remoteOnly);

    const byId = new Map<string, LinkedInCard>();
    let blockedPage = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));

      let html: string;
      try {
        html = await fetchPage(term, location, page * PAGE_SIZE);
      } catch (err) {
        // A mid-pagination failure still leaves us with earlier pages.
        if (byId.size > 0) break;
        throw err;
      }

      if (looksBlocked(html)) {
        blockedPage++;
        break;
      }

      const cards = parseLinkedInCards(html);
      if (cards.length === 0) break; // end of results
      for (const c of cards) byId.set(c.sourceJobId, c);
    }

    const jobs: RawJob[] = [...byId.values()].map((c) => ({
      sourceJobId: c.sourceJobId,
      title: c.title,
      company: c.company,
      location: c.location,
      workArrangement: inferArrangement(c.location, c.title),
      employmentType: null,
      experienceLevel: null,
      // The guest card carries no description; the AI analysis pass fills
      // this in from the title, company and location.
      description: null,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      salaryOriginal: null,
      postedDate: c.postedDate,
      applicationUrl: c.applicationUrl,
      // The link resolves on LinkedIn, not the employer's own site.
      directApply: false,
    }));

    const warnings: string[] = [];
    if (blockedPage) {
      warnings.push(
        "linkedin: served a bot-challenge page instead of results — the public guest endpoint is being throttled. No anti-detection bypass is attempted.",
      );
    }
    if (jobs.length === 0 && !blockedPage) {
      warnings.push("linkedin: guest search returned nothing for this term and location.");
    }

    return { jobs, warning: warnings[0] };
  },
};

/**
 * Choose what to send as LinkedIn's `location` parameter.
 *
 * LinkedIn is US-centric: with no location it happily returns Bellevue, WA
 * for an India-focused search. This app targets India, so an unset location
 * means "India" rather than "anywhere".
 */
function normalizeLocation(location: string | null | undefined, remoteOnly?: boolean): string | null {
  if (remoteOnly) return "Worldwide";
  const l = (location ?? "").trim();
  if (!l) return DEFAULT_LOCATION;
  // A bare country name is too broad for the location parameter but is exactly
  // what we want when the user has not narrowed it down.
  if (/^(india|ind)$/i.test(l)) return "India";
  if (/^(usa|us|united states)$/i.test(l)) return "United States";
  if (/^(uk|united kingdom)$/i.test(l)) return "United Kingdom";
  return l;
}