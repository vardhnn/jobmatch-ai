"use server-only";

import { prisma } from "@/lib/db";
import { fetchFromSource, getAdapter, listAdapters, DEFAULT_ENABLED_KEYS, ALL_SOURCE_KEYS } from "@/lib/sources";
import type { RawJob } from "@/lib/sources";
import { generateQueriesForUser } from "./search-query-service";
import { matchJobForUser } from "./job-matching-service";
import { buildDecisionInputs } from "./profile-inputs";
import { dedupeKeyFor } from "./dedupe";
import { safeApplyUrl } from "@/lib/apply-url";

/**
 * Search service — the daily pipeline.
 *
 * queries → enabled sources → normalize → dedupe (removeDuplicates) →
 * freshness filter → excluded-company filter → upsert Job + JobSourceRecord →
 * AI analysis (cached) → JEV decision (cached) → run summary + notification.
 *
 * One source failing never fails the run: errors are collected per source and
 * surfaced in the run summary.
 */

const MAX_JOBS_ANALYZED = 12; // per run — keeps a manual search fast and cheap
const MATCH_CONCURRENCY = 6; // parallel analysis+decision calls
const RUN_BUDGET_MS = 150_000; // stop matching (not storing) past this
const TERMS_PER_SOURCE = 2; // how many query terms each source receives per run

export type SearchRunSummary = {
  runId: string;
  queries: string[];
  queryProvider: string;
  sourcesTried: number;
  totalFound: number;
  newJobs: number;
  duplicates: number;
  analyzed: number;
  strongMatches: number;
  potentialMatches: number;
  lowMatches: number;
  hidden: number;
  errors: { source: string; code: string; message: string }[];
  /**
   * Non-fatal observations (e.g. "Arbeitnow filters client-side"). Kept out of
   * `errors` so a successful run does not present advisories as failures.
   */
  notes: string[];
  /** The slice of `queries` that was actually sent to the sources this run. */
  searchedTerms: string[];
  finishedAt: string;
};

export async function runSearchForUser(
  userId: string,
  trigger: "MANUAL" | "SCHEDULED" = "MANUAL",
): Promise<SearchRunSummary> {
  // Counted before the new row exists, so the rotation window advances by one
  // per run and every query term eventually gets searched.
  const priorRuns = await prisma.searchRun.count({ where: { userId } });
  const run = await prisma.searchRun.create({
    data: { userId, trigger, status: "RUNNING" },
  });

  try {
    // Self-heal: pick up sources added since this account was created, and drop
    // rows for adapters that have since been removed. Checking only for an
    // empty table would leave a new source switched off forever, and checking
    // only for missing adapters would leave dead rows forever.
    const existing = await prisma.jobSource.findMany({
      where: { userId },
      select: { key: true },
    });
    const present = new Set(existing.map((r) => r.key));
    const hasOrphans = existing.some((r) => !ALL_SOURCE_KEYS.includes(r.key));
    if (existing.length === 0 || hasOrphans || ALL_SOURCE_KEYS.some((k) => !present.has(k))) {
      await ensureDefaultSources(userId);
    }

    const [queries, inputs, sources, prefsRow] = await Promise.all([
      generateQueriesForUser(userId),
      buildDecisionInputs(userId),
      prisma.jobSource.findMany({ where: { userId, enabled: true } }),
      prisma.jobPreferences.findUnique({ where: { userId } }),
    ]);

    const prefs = {
      postedWithinDays: prefsRow?.postedWithinDays ?? 14,
      excludedCompanies: inputs.preferences.excludedCompanies,
      removeDuplicates: prefsRow?.removeDuplicates ?? true,
      preferDirectApply: prefsRow?.preferDirectApply ?? true,
      includeRelatedTitles: prefsRow?.includeRelatedTitles ?? true,
      includeJobsWithoutSalarySearch: prefsRow?.includeJobsWithoutSalarySearch ?? true,
    };

    const primaryLocation = inputs.preferences.preferredLocations[0] ?? null;

    // ── 0. Query set: AI suggestions + anything the user approved ───────
    // Disabling a generated query on the sources page must actually stop it
    // being searched, so the stored query list wins over the raw AI output.
    const previousRun = await prisma.searchRun.findFirst({
      // Exclude the run we just created — otherwise "latest run" is always this
      // one (empty) and the user's query approvals would never be applied.
      where: { userId, id: { not: run.id } },
      orderBy: { startedAt: "desc" },
      include: { queries: { orderBy: { query: "asc" } } },
    });
    const approved = (previousRun?.queries ?? []).filter((q) => q.approved);
    const disabledTerms = new Set(
      (previousRun?.queries ?? []).filter((q) => !q.approved).map((q) => q.query.toLowerCase()),
    );
    const customTerms = approved.filter((q) => q.type === "CUSTOM").map((q) => q.query);
    const approvedGenerated = approved
      .filter((q) => q.type !== "CUSTOM")
      .map((q) => q.query);

    const suggested = [
      ...queries.primary,
      ...(prefs.includeRelatedTitles ? queries.related.slice(0, 2) : []),
    ];

    // With no stored list yet (first ever run) use the AI suggestions as-is.
    const searchTerms = (
      approved.length ? [...approvedGenerated, ...customTerms] : suggested
    )
      .filter(Boolean)
      .slice(0, 6);

    // Each source only gets TERMS_PER_SOURCE terms to stay inside rate limits.
    // Taking a fixed prefix meant runs 2..N re-searched the same two terms and
    // the shortlist looked frozen. Rotating the window by run number keeps each
    // run cheap while covering every term within a few days.
    const activeTerms =
      searchTerms.length <= TERMS_PER_SOURCE
        ? searchTerms
        : Array.from(
            { length: TERMS_PER_SOURCE },
            (_, i) => searchTerms[(priorRuns * TERMS_PER_SOURCE + i) % searchTerms.length],
          ).filter((t, i, arr) => arr.indexOf(t) === i);

    // ── 1. Fan out across sources ────────────────────────────────────────
    const errors: SearchRunSummary["errors"] = [];
    const warnings: string[] = [];
    /** A source can warn once per query; surface each advisory only once. */
    const noteOnce = (msg: string) => {
      if (!warnings.includes(msg)) warnings.push(msg);
    };
    const collected = new Map<string, { sourceKey: string; sourceId: string; job: RawJob }>();
    let totalFound = 0;
    let duplicates = 0;

    for (const source of sources) {
      for (const term of activeTerms) {
        const { jobs, error, warning } = await fetchFromSource(source.key, {
          text: term,
          location: primaryLocation,
          remoteOnly: inputs.preferences.workArrangement === "REMOTE",
        });
        if (error) {
          if (warning) noteOnce(`${source.key}: ${warning}`);
          if (!errors.some((e) => e.source === source.key)) {
            errors.push({ source: source.key, ...error });
          }
          continue;
        }
        if (warning) noteOnce(`${source.key}: ${warning}`);
        totalFound += jobs.length;
        for (const job of jobs) {
          const key = dedupeKeyFor(job);
          if (prefs.removeDuplicates && collected.has(key)) {
            duplicates++;
            continue;
          }
          collected.set(key, { sourceKey: source.key, sourceId: source.id, job });
        }
      }
    }

    // ── 2. Freshness + hard filters ──────────────────────────────────────
    const cutoff = Date.now() - prefs.postedWithinDays * 24 * 3600 * 1000;
    const excluded = new Set(prefs.excludedCompanies.map((c) => c.trim().toLowerCase()));

    const fresh = [...collected.values()].filter(({ job }) => {
      if (excluded.has(job.company.trim().toLowerCase())) return false;
      if (job.postedDate && job.postedDate.getTime() < cutoff) return false;
      return Boolean(job.title && job.company);
    });

    // Best candidates first so the analysis budget is spent where it matters.
    const ranked = fresh.sort((a, b) => {
      const da = a.job.postedDate?.getTime() ?? 0;
      const db = b.job.postedDate?.getTime() ?? 0;
      if (db !== da) return db - da;
      if (prefs.preferDirectApply) {
        return Number(b.job.directApply) - Number(a.job.directApply);
      }
      return 0;
    });

    // ── 3. Persist jobs ──────────────────────────────────────────────────
    let newJobs = 0;
    const toAnalyze: { jobId: string; sourceKey: string; sourceId: string; sourceJobId: string }[] = [];

    for (const { sourceKey, sourceId, job } of ranked) {
      const dedupeKey = dedupeKeyFor(job);
      const existing = await prisma.job.findUnique({ where: { dedupeKey }, select: { id: true } });
      if (existing) continue;
      newJobs++;

      const created = await prisma.job.create({
        data: {
          dedupeKey,
          title: job.title,
          company: job.company,
          location: job.location,
          remoteType: job.workArrangement,
          employmentType: job.employmentType,
          experienceLevel: job.experienceLevel,
          description: job.description,
          // Board tags are a cheap, honest skill signal until AI analysis runs.
          requiredSkills: JSON.stringify(job.tags.slice(0, 12)),
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryCurrency: job.salaryCurrency,
          salaryPeriod: job.salaryPeriod,
          salaryOriginal: job.salaryOriginal,
          postedDate: job.postedDate,
          // Vet the link at ingest, not just at render time: a board returning
          // `javascript:` must never reach the database.
          applicationUrl: safeApplyUrl(job.applicationUrl)?.href ?? null,
        },
      });

      await prisma.jobSourceRecord.upsert({
        where: { sourceId_sourceJobId: { sourceId, sourceJobId: job.sourceJobId } },
        update: { jobId: created.id, lastSeenAt: new Date() },
        create: {
          jobId: created.id,
          sourceId,
          sourceJobId: job.sourceJobId,
          title: job.title,
          company: job.company,
          location: job.location,
          applicationUrl: safeApplyUrl(job.applicationUrl)?.href ?? null,
          rawPayload: JSON.stringify(job).slice(0, 20_000),
        },
      });

      toAnalyze.push({ jobId: created.id, sourceKey, sourceId, sourceJobId: job.sourceJobId });
    }

    // ── 4. Analyze + decide (bounded parallelism) ─────────────────────────
    let analyzed = 0;
    let strongMatches = 0;
    let potentialMatches = 0;
    let lowMatches = 0;
    let hidden = 0;

    // Jobs stored earlier can still be unranked — e.g. they arrived before a
    // resume was parsed. Fold those in so a profile change actually re-scores
    // what we already have instead of only ever scoring the newest batch.
    const orphans = await prisma.job.findMany({
      where: { matches: { none: { userId } } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: MAX_JOBS_ANALYZED,
    });
    const freshIds = new Set(toAnalyze.map((t) => t.jobId));
    const queue = [
      ...toAnalyze.map((t) => t.jobId),
      ...orphans.map((o) => o.id).filter((id) => !freshIds.has(id)),
    ].slice(0, MAX_JOBS_ANALYZED);
    const deadline = Date.now() + RUN_BUDGET_MS;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(MATCH_CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length) {
        const jobId = queue[cursor++];
        // Free models throttle hard; never let one slow call hold the run open.
        if (Date.now() > deadline) {
          cursor = queue.length;
          return;
        }
        try {
          const outcome = await matchJobForUser(userId, jobId);
          if (!outcome) continue;
          analyzed++;
          if (outcome.decision === "HIDE") hidden++;
          else if (outcome.category === "STRONG") strongMatches++;
          else if (outcome.category === "POTENTIAL") potentialMatches++;
          else lowMatches++;
        } catch (err) {
          errors.push({
            source: "matching",
            code: "MATCH_FAILED",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
    await Promise.all(workers);

    // Mark jobs the user has already seen so the dashboard can hide repeats.
    const seen = await prisma.job.findMany({
      where: { id: { in: toAnalyze.map((t) => t.jobId) } },
      select: { id: true },
    });
    if (seen.length) {
      // SQLite has no createMany skipDuplicates — upsert per row instead.
      for (const s of seen) {
        await prisma.seenJob.upsert({
          where: { userId_jobId: { userId, jobId: s.id } },
          update: {},
          create: { userId, jobId: s.id },
        });
      }
    }

    const finishedAt = new Date();
    const summary: SearchRunSummary = {
      runId: run.id,
      queries: searchTerms,
      queryProvider: queries.provider,
      sourcesTried: sources.length,
      totalFound,
      newJobs,
      duplicates,
      analyzed,
      strongMatches,
      potentialMatches,
      lowMatches,
      hidden,
      errors,
      notes: warnings,
      searchedTerms: activeTerms,
      finishedAt: finishedAt.toISOString(),
    };

    await prisma.$transaction([
      prisma.searchRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          totalFound,
          newJobs,
          duplicates,
          strongMatches,
          potentialMatches,
          lowMatches,
          sourcesTried: sources.length,
          analyzed,
          sourceErrors: JSON.stringify(summary.errors),
          // Advisories are persisted too: the dashboard falls back to the last
          // stored run after a reload, and an explanation that vanishes on
          // refresh is not an explanation.
          sourceNotes: JSON.stringify(summary.notes),
          searchedQueries: JSON.stringify(summary.searchedTerms),
          finishedAt,
        },
      }),
      prisma.searchQuery.createMany({
        // Queries the user switched off stay off across runs; custom queries
        // ride along so they keep being searched. Switched-off queries are
        // still copied over (disabled) so they remain visible — and
        // re-enableable — on the next run.
        data: [
          ...searchTerms.map((q) => ({
            runId: run.id,
            query: q,
            type: customTerms.some((c) => c.toLowerCase() === q.toLowerCase())
              ? "CUSTOM"
              : "PRIMARY",
            approved: !disabledTerms.has(q.toLowerCase()),
          })),
          ...[...disabledTerms]
            .filter(
              (term) =>
                !searchTerms.some((q) => q.toLowerCase() === term) &&
                (previousRun?.queries ?? []).some((q) => q.query.toLowerCase() === term),
            )
            .map((term) => {
              const original = previousRun?.queries.find(
                (q) => q.query.toLowerCase() === term,
              );
              return {
                runId: run.id,
                query: original?.query ?? term,
                type: original?.type ?? "PRIMARY",
                approved: false,
              };
            }),
        ],
      }),
      prisma.notification.create({
        data: {
          userId,
          title:
            strongMatches + potentialMatches > 0
              ? `${strongMatches} strong, ${potentialMatches} potential matches`
              : newJobs > 0
                ? `${newJobs} new jobs found`
                : "No new postings since the last run",
          // When nothing is new, say why: the boards returned the same
          // postings and dedupe correctly suppressed them. Silence here reads
          // as a broken pipeline.
          body:
            newJobs > 0
              ? `${newJobs} new of ${totalFound} seen across ${sources.length} source${sources.length === 1 ? "" : "s"}` +
                (duplicates ? ` · ${duplicates} duplicates removed` : "") +
                (errors.length ? ` · ${errors.length} source issue(s)` : "") +
                "."
              : `All ${totalFound} postings from ${sources.length} source${sources.length === 1 ? "" : "s"} were already known — nothing new matched your preferences this run.` +
                (duplicates ? ` ${duplicates} duplicates removed.` : "") +
                (errors.length ? ` ${errors.length} source issue(s).` : ""),
          kind: "DAILY_SUMMARY",
          payload: JSON.stringify({ runId: run.id }),
        },
      }),
    ]);

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.searchRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
    await prisma.notification.create({
      data: {
        userId,
        title: "Search run failed",
        body: message.slice(0, 300),
        kind: "SOURCE_ERROR",
      },
    });
    throw err;
  }
}

/**
 * Create the default source rows for a user (called on register/seed).
 *
 * Also prunes rows whose adapter no longer exists. Orphan rows are invisible
 * in the UI but keep answering queries, and a stale row can outlive the
 * adapter that wrote it — which is how a long-gone placeholder like
 * "Awaiting credentials" kept showing under a working source.
 */
export async function ensureDefaultSources(userId: string) {
  const rows = listAdapters().map((a) => ({
    userId,
    key: a.key,
    enabled: DEFAULT_ENABLED_KEYS.includes(a.key),
    status: a.isConfigured() ? "CONNECTED" : "NOT_CONFIGURED",
    statusDetail: a.isConfigured() ? "Ready" : a.configureHint,
    config: "{}",
  }));
  for (const row of rows) {
    await prisma.jobSource.upsert({
      where: { userId_key: { userId, key: row.key } },
      update: {},
      create: row,
    });
  }

  const known = new Set(listAdapters().map((a) => a.key));
  const orphans = await prisma.jobSource.findMany({
    where: { userId },
    select: { key: true, id: true },
  });
  const occupied = new Set(
    (
      await prisma.jobSourceRecord.groupBy({
        by: ["sourceId"],
        where: { source: { userId } },
        _count: { _all: true },
      })
    ).map((r) => r.sourceId),
  );
  const stale = orphans.filter((o) => !known.has(o.key));
  // Only prune a row that still has no postings behind it. JobSourceRecord
  // has no cascade to the source, so deleting a row that still owns records
  // would strand them as orphans with no way back to a source key.
  const prunable = stale.filter((o) => !occupied.has(o.id));
  if (prunable.length) {
    await prisma.jobSource.deleteMany({
      where: { userId, id: { in: prunable.map((p) => p.id) } },
    });
  }
}

/** Source rows for the UI, annotated with adapter metadata. */
export async function describeSources(userId: string) {
  const rows = await prisma.jobSource.findMany({ where: { userId } });
  return listAdapters().map((adapter) => {
    const row = rows.find((r) => r.key === adapter.key);
    const configured = adapter.isConfigured();
    return {
      key: adapter.key,
      label: adapter.label,
      enabled: row?.enabled ?? false,
      configured,
      status: configured ? (row?.enabled ? "CONNECTED" : "READY") : "NOT_CONFIGURED",
      // Derived from the adapter, never from the stored row: a row can
      // outlive the adapter that wrote it and carry a hint that is now wrong
      // (a removed placeholder's "Awaiting credentials" under a live source).
      statusDetail: configured ? "Ready" : adapter.configureHint,
      attribution: adapter.attribution ?? null,
      configureHint: adapter.configureHint,
    };
  });
}

export { getAdapter, dedupeKeyFor };
