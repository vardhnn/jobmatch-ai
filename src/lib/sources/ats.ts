"use server-only";

import {
  inferArrangement,
  stripHtml,
  type RawJob,
  type SourceAdapter,
  type SourceFetchResult,
  type SourceQuery,
  type WorkArrangement,
} from "./types";

/**
 * Employer ATS boards — the sanctioned replacement for Indeed/Naukri.
 *
 * ── Why this exists instead of scraping Indeed and Naukri ────────────────
 * Verified live against production endpoints:
 *   • `in.indeed.com`          → HTTP 403, body is a captcha/"enable JS" page
 *   • `naukri.com/jobsearch`  → HTTP 301 straight to the homepage
 *   • `naukri.com/gateway/…`  → HTTP 404
 * Those are network-level blocks, not a missing feature, so reading them
 * server-side would mean building detection-evasion. We don't.
 *
 * Almost every posting those portals list is syndicated from the employer's
 * own applicant-tracking system, and those DO publish open, documented,
 * unauthenticated feeds. Pulling straight from the employer gets the same
 * job — with the real description and a first-party apply URL — without
 * fighting an anti-bot wall or republishing someone else's board.
 *
 * ── Registry ─────────────────────────────────────────────────────────────
 * Company slugs below were each confirmed to return a live board during
 * development. Indian-market employers are
 * listed first because that is where this app is used. A slug that later goes
 * private yields a 404 and is skipped — a dead token degrades one board, it
 * does not fail the source.
 */

export type AtsProvider = "ashby" | "lever" | "smartrecruiters";

export type AtsBoard = {
  provider: AtsProvider;
  /** Board slug on that ATS host. */
  company: string;
  /** Employer display name, when the board slug is not the brand. */
  display?: string;
};

/**
 * Verified-live board registry. Keep this short and honest rather than long
 * and aspirational — every entry costs a request on every run.
 */
export const ATS_BOARD_TOKENS: AtsBoard[] = [
  // Indian market
  { provider: "lever", company: "paytm", display: "Paytm" },
  { provider: "smartrecruiters", company: "Swiggy", display: "Swiggy" },
  { provider: "smartrecruiters", company: "freshworks", display: "Freshworks" },
  { provider: "lever", company: "meesho", display: "Meesho" },
  { provider: "lever", company: "mindtickle", display: "Mindtickle" },
  { provider: "smartrecruiters", company: "mindtickle", display: "Mindtickle" },
  { provider: "lever", company: "cred", display: "CRED" },
  // Remote-friendly global boards
  { provider: "ashby", company: "notion", display: "Notion" },
  { provider: "ashby", company: "supabase", display: "Supabase" },
  { provider: "ashby", company: "linear", display: "Linear" },
  { provider: "ashby", company: "posthog", display: "PostHog" },
  { provider: "ashby", company: "zapier", display: "Zapier" },
  { provider: "ashby", company: "jellyfish", display: "Jellyfish" },
];

/** How many boards one search term touches, to bound a single run's latency. */
const MAX_BOARDS_PER_QUERY = 6;

/**
 * SmartRecruiters' list endpoint omits the apply URL, and a job with no way to
 * apply is close to worthless to a job seeker. Its detail endpoint does carry
 * `applyUrl`, so we hydrate a bounded number of them after relevance
 * filtering — not before, so the extra calls are spent only on jobs we keep.
 */
const SR_ENRICH_LIMIT = 8;
const SR_ENRICH_CONCURRENCY = 4;

const UA = "JobMatchAI/1.0 (+personal job search)";

/**
 * Per-provider budgets, set from measured response times rather than a guess:
 *   Ashby            ~0.4–0.9s  → 8s is generous
 *   SmartRecruiters  ~0.5–1.5s  → 10s is generous
 *   Lever            ~0.8–25s   → Paytm alone measured 25.3s
 * A single flat ceiling plus a retry turned one slow board into a 65-second
 * source, which would eat a manual run whole. Budgeting per provider keeps the
 * fast boards instant and only gives the slow one the headroom it needs.
 */
const PROVIDER_TIMEOUT_MS: Record<AtsProvider, number> = {
  ashby: 8_000,
  smartrecruiters: 10_000,
  lever: 25_000,
};

/** Hard ceiling for the whole source, regardless of how the boards behave. */
const ATS_DEADLINE_MS = 35_000;

/** Detail hydration is a bonus, not a requirement — keep it cheap. */
const ENRICH_TIMEOUT_MS = 12_000;

function boardUrl(board: AtsBoard): string {
  switch (board.provider) {
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.company)}`;
    case "lever":
      return `https://api.lever.co/v0/postings/${encodeURIComponent(board.company)}?mode=json`;
    case "smartrecruiters":
      return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.company)}/postings?limit=100`;
  }
}

async function fetchBoard(board: AtsBoard, deadlineAt: number): Promise<RawJob[]> {
  const res = await fetchWithRetry(
    boardUrl(board),
    PROVIDER_TIMEOUT_MS[board.provider],
    deadlineAt,
  );
  // A slug that has gone private, or a board we were never entitled to read.
  // Skip the board; the rest of the source carries on.
  if (!res?.ok) return [];

  const payload = (await res.json()) as unknown;
  switch (board.provider) {
    case "ashby":
      return normalizeAshby(payload, board);
    case "lever":
      return normalizeLever(payload, board);
    case "smartrecruiters":
      return normalizeSmartRecruiters(payload, board);
  }
}

/**
 * Fetch a URL with at most one retry, bounded by both a per-call timeout and
 * a shared deadline.
 *
 * These are separate third-party hosts, so a transient reset or a 503 on one
 * should not silently cost that employer's listings. The retry is skipped when
 * the deadline has no room for a second full attempt, which is what keeps one
 * slow board from stretching the source into a minute.
 */
async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  deadlineAt: number,
): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // A retry only counts if a *full* further attempt could still finish
    // inside the deadline. Starting one that we would have to abort halfway
    // just spends the remaining budget for nothing.
    const remaining = deadlineAt - Date.now();
    if (remaining < Math.min(timeoutMs, 1_000)) return null;

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
        cache: "no-store",
      });
      // A 404 means the board is gone; retrying only burns the user's time.
      if (res.ok || res.status === 404) return res;
    } catch {
      // Transport failure (reset, DNS, timeout) — fall through to the retry.
    }

    if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/* ── Normalizers ─────────────────────────────────────────────────────────── */

type AshbyPosting = {
  id?: string;
  title?: string;
  location?: string | null;
  workplaceType?: string | null;
  employmentType?: string | null;
  publishedDate?: string | null;
  jobUrl?: string | null;
  applyUrl?: string | null;
  descriptionHtml?: string | null;
  descriptionPlain?: string | null;
  department?: string | null;
  team?: string | null;
  secondaryLocations?: { location?: string; isRemote?: boolean }[];
};

export function normalizeAshby(payload: unknown, board: AtsBoard): RawJob[] {
  const jobs = (payload as { jobs?: AshbyPosting[] })?.jobs ?? [];
  return jobs
    .filter((j) => Boolean(j?.id && j?.title))
    .map((j) => {
      const title = j.title as string;
      const secondary = (j.secondaryLocations ?? [])
        .map((s) => s.location)
        .filter(Boolean)
        .join(" · ");
      const location = [j.location, secondary].filter(Boolean).join(" · ") || null;
      return {
        sourceJobId: `ashby:${board.company}:${j.id}`,
        title: title.slice(0, 200),
        company: board.display ?? board.company,
        location,
        workArrangement: arrangementFrom(j.workplaceType, location, title),
        employmentType: prettifyType(j.employmentType),
        experienceLevel: j.team ?? null,
        description: (j.descriptionPlain ?? stripHtml(j.descriptionHtml)) ?? null,
        tags: compact([j.department, j.team]),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryOriginal: null,
        postedDate: safeDate(j.publishedDate),
        // The employer's own board is exactly what `directApply` means.
        applicationUrl: j.applyUrl ?? j.jobUrl ?? null,
        directApply: true,
      } satisfies RawJob;
    });
}

type LeverPosting = {
  id?: string;
  text?: string;
  hostedUrl?: string | null;
  applyUrl?: string | null;
  descriptionPlain?: string | null;
  description?: string | null;
  createdAt?: number;
  workplaceType?: string | null;
  country?: string | null;
  categories?: {
    team?: string | null;
    location?: string | null;
    commitment?: string | null;
    allLocations?: string[] | null;
  };
};

export function normalizeLever(payload: unknown, board: AtsBoard): RawJob[] {
  const jobs = Array.isArray(payload) ? (payload as LeverPosting[]) : [];
  return jobs
    .filter((j) => Boolean(j?.id && j?.text))
    .map((j) => {
      const title = j.text as string;
      const all = j.categories?.allLocations ?? [];
      const primary = j.categories?.location ?? null;
      const location = [primary, ...all.filter((l) => l !== primary)].filter(Boolean).join(" · ") || null;
      return {
        sourceJobId: `lever:${board.company}:${j.id}`,
        title: title.slice(0, 200),
        company: board.display ?? board.company,
        location,
        workArrangement: arrangementFrom(j.workplaceType, location, title),
        employmentType: prettifyType(j.categories?.commitment),
        experienceLevel: j.categories?.team ?? null,
        description: j.descriptionPlain ?? stripHtml(j.description),
        tags: compact([j.categories?.team]),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryOriginal: null,
        // Lever publishes createdAt as epoch milliseconds.
        postedDate: j.createdAt ? safeDate(new Date(j.createdAt).toISOString()) : null,
        applicationUrl: j.applyUrl ?? j.hostedUrl ?? null,
        directApply: true,
      } satisfies RawJob;
    });
}

type SrPosting = {
  id?: string | number;
  uuid?: string;
  name?: string;
  company?: { name?: string; identifier?: string };
  releasedDate?: string | null;
  location?: { city?: string; country?: string; fullLocation?: string; remote?: boolean; hybrid?: boolean };
  typeOfEmployment?: { label?: string };
  experienceLevel?: { label?: string };
  department?: { label?: string };
  customField?: { fieldLabel?: string; valueLabel?: string }[];
};

export function normalizeSmartRecruiters(payload: unknown, board: AtsBoard): RawJob[] {
  const jobs = (payload as { content?: SrPosting[] })?.content ?? [];
  return jobs
    .filter((j) => (j?.id ?? j?.uuid) && j?.name)
    .map((j) => {
      const loc = j.location;
      // Their `fullLocation` routinely has stray commas ("Goa, , India").
      const location =
        loc?.fullLocation?.replace(/,\s*,/g, ",").replace(/^,\s*/, "").trim() ||
        [loc?.city, loc?.country].filter(Boolean).join(", ") ||
        null;

      const tags = compact((j.customField ?? []).map((f) => f.valueLabel));

      return {
        sourceJobId: `smartrecruiters:${board.company}:${j.uuid ?? j.id}`,
        title: j.name!.slice(0, 200),
        company: j.company?.name || board.display || board.company,
        location,
        workArrangement: loc?.remote ? "REMOTE" : loc?.hybrid ? "HYBRID" : "ONSITE",
        employmentType: j.typeOfEmployment?.label ?? null,
        experienceLevel: j.experienceLevel?.label ?? null,
        // The list endpoint omits the body; fetching one detail request per
        // posting would multiply latency for little ranking value, and the
        // analysis pass works from title + company + location.
        description: null,
        tags: compact([...tags, j.department?.label]).slice(0, 8),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryOriginal: null,
        postedDate: safeDate(j.releasedDate),
        // The list endpoint carries no apply link. Building one would mean
        // guessing the id, and a fabricated URL sends a job seeker to a dead
        // or someone else's page — so we report none and the UI shows NO LINK.
        // The job detail endpoint would supply it; that is one request per
        // posting and is left out of the default run.
        applicationUrl: null,
        directApply: false,
      } satisfies RawJob;
    });
}

/**
 * Hydrate SmartRecruiters postings with their real apply URL.
 *
 * Bounded by count and concurrency: these are third-party endpoints and an
 * unbounded fan-out is how a token gets revoked. A posting that cannot be
 * enriched simply keeps its null URL and renders as NO LINK.
 */
async function enrichSmartRecruiters(jobs: RawJob[], deadlineAt: number): Promise<void> {
  const targets = jobs
    .filter((j) => j.sourceJobId.startsWith("smartrecruiters:") && !j.applicationUrl)
    .slice(0, SR_ENRICH_LIMIT);
  if (!targets.length) return;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(SR_ENRICH_CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const job = targets[cursor++];
      // sourceJobId is `smartrecruiters:<boardSlug>:<uuid>`.
      const [, boardSlug, ...rest] = job.sourceJobId.split(":");
      const uuid = rest.join(":");
      if (!boardSlug || !uuid) continue;

      try {
        const res = await fetchWithRetry(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(boardSlug)}/postings/${encodeURIComponent(uuid)}`,
          ENRICH_TIMEOUT_MS,
          deadlineAt,
        );
        if (!res || !res.ok) continue;
        const detail = (await res.json()) as { applyUrl?: string; postingUrl?: string };
        const url = detail.applyUrl ?? detail.postingUrl;
        if (url) {
          job.applicationUrl = url;
          job.directApply = true;
        }
      } catch {
        // Enrichment is best-effort; a failure leaves the job without a link.
      }
    }
  });

  await Promise.all(workers);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Drop null/undefined while keeping the element type as `string`. */
function compact(values: (string | undefined | null)[]): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function arrangementFrom(
  declared: string | null | undefined,
  location: string | null,
  title: string,
): WorkArrangement {
  const d = declared?.toLowerCase() ?? "";
  if (d.includes("remote")) return "REMOTE";
  if (d.includes("hybrid")) return "HYBRID";
  if (d.includes("office") || d.includes("onsite")) return "ONSITE";
  return inferArrangement(location, title);
}

/** ATS enums are CamelCase and unhelpfully coarse; normalize to readable text. */
function prettifyType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    FullTime: "Full-time",
    PartTime: "Part-time",
    Contract: "Contract",
    Internship: "Internship",
    Temporary: "Temporary",
    Permanent: "Full-time",
  };
  const trimmed = raw.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return map[raw] ?? trimmed ?? null;
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Same loose relevance gate the other adapters use, so noise stays out. */
function matchesTerm(job: RawJob, wanted: string): boolean {
  const hay = `${job.title} ${job.company} ${job.tags.join(" ")} ${job.location ?? ""}`.toLowerCase();
  if (!wanted) return true;
  if (hay.includes(wanted)) return true;
  const terms = wanted.split(/\s+/).filter((t) => t.length > 2);
  return terms.length > 0 && terms.every((t) => hay.includes(t));
}

export const atsAdapter: SourceAdapter = {
  key: "ats",
  label: "Company ATS boards (Ashby / Lever / SmartRecruiters)",
  configureHint: "No key needed — official public company job feeds.",
  attribution: "Listings published by employers on their own ATS boards",
  isConfigured: () => true,

  async fetchJobs(query: SourceQuery): Promise<SourceFetchResult> {
    const wanted = query.text.trim().toLowerCase();
    const boards = pickBoards(query);
    // One deadline covers board fetches and link hydration together, so this
    // source can never exceed it no matter which host misbehaves.
    const deadlineAt = Date.now() + ATS_DEADLINE_MS;

    // Boards run in parallel so the cost is the slowest one, not the sum —
    // but they are separate third-party services, so the count is capped and
    // each board has its own budget.
    const results = await Promise.all(
      boards.map(async (board) => {
        try {
          return await fetchBoard(board, deadlineAt);
        } catch {
          return [] as RawJob[];
        }
      }),
    );

    const all = results.flat();
    const jobs = all.filter((j) => matchesTerm(j, wanted)).slice(0, 60);

    // Fill in the links SmartRecruiters withheld, now that we know which
    // postings actually survive filtering.
    await enrichSmartRecruiters(jobs, deadlineAt);

    const deadBoards = boards.filter((b, i) => results[i].length === 0).map((b) => b.company);

    let warning: string | undefined;
    if (jobs.length === 0) {
      warning = deadBoards.length
        ? `ats: no matching roles on ${deadBoards.length} board(s) (${deadBoards.slice(0, 4).join(", ")})${deadBoards.length > 4 ? "…" : ""}.`
        : "ats: boards returned nothing for this term.";
    }

    return { jobs, warning };
  },
};

/**
 * Choose which boards to query for a term.
 *
 * Board slugs are fixed, so there is no server-side search to send the term
 * to — the choice is about locality. A location-bearing run favours the
 * Indian boards; a remote run favours the remote-first global ones.
 */
function pickBoards(query: SourceQuery): AtsBoard[] {
  const loc = (query.location ?? "").toLowerCase();
  const prefersIndia = !loc || /india|bangalore|bengaluru|pune|mumbai|delhi|hyderabad|chennai|gurugram|noida|ahmedabad|indore|kolkata|coimbatore|trichy/.test(loc);

  const india = ATS_BOARD_TOKENS.filter(
    (b) => b.company === "paytm" || b.company === "swiggy" || b.company.toLowerCase() === "freshworks" || b.company === "meesho" || b.company === "mindtickle" || b.company === "cred",
  );
  const global = ATS_BOARD_TOKENS.filter((b) => !india.includes(b));

  const ordered = prefersIndia ? [...india, ...global] : [...global, ...india];
  return ordered.slice(0, MAX_BOARDS_PER_QUERY);
}