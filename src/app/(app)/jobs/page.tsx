"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { ApplyLink } from "@/components/ui/apply-link";
import { RetroButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner } from "@/components/ui/states";

type SubScores = Record<string, number | null>;

type JobRow = {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryOriginal: string | null;
  postedDate: string | null;
  applicationUrl: string | null;
  overall: number;
  category: string;
  decision: string;
  subScores: SubScores;
  matchingSkills: string[];
  missingSkills: string[];
  explanation: string | null;
  provider: string;
  sources: { key: string; label: string }[];
};

const CATEGORIES = [
  { value: "ALL", label: "ALL MATCHES" },
  { value: "STRONG", label: "STRONG" },
  { value: "POTENTIAL", label: "POTENTIAL" },
  { value: "LOW", label: "LOW" },
] as const;

const CATEGORY_TONE = { STRONG: "green", POTENTIAL: "amber", LOW: "gray" } as const;

function scoreColor(v: number) {
  return v >= 80 ? "var(--term)" : v >= 60 ? "var(--amber)" : "var(--danger)";
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const PAGE = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(PAGE) });
    if (category !== "ALL") params.set("category", category);
    if (includeHidden) params.set("includeHidden", "1");
    if (query.trim()) params.set("q", query.trim());
    const res = await fetch(`/api/jobs?${params}`);
    if (!res.ok) {
      setError("Could not load jobs.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setJobs(data.jobs ?? []);
    setTotal(data.total ?? 0);
    setHasMore(Boolean(data.hasMore));
    setLoading(false);
  }, [category, includeHidden, query]);

  async function loadMore() {
    setLoadingMore(true);
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(jobs.length) });
    if (category !== "ALL") params.set("category", category);
    if (includeHidden) params.set("includeHidden", "1");
    if (query.trim()) params.set("q", query.trim());
    const res = await fetch(`/api/jobs?${params}`);
    if (res.ok) {
      const data = await res.json();
      // Guard against duplicates if a new match shifted the page between clicks.
      setJobs((prev) => {
        const seen = new Set(prev.map((j) => j.jobId));
        return [...prev, ...(data.jobs ?? []).filter((j: JobRow) => !seen.has(j.jobId))];
      });
      setTotal(data.total ?? 0);
      setHasMore(Boolean(data.hasMore));
    }
    setLoadingMore(false);
  }

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch {
        setError("Could not load jobs.");
        setLoading(false);
      }
    })();
  }, [load]);

  const grouped = useMemo(() => {
    const order = { STRONG: 0, POTENTIAL: 1, LOW: 2 } as Record<string, number>;
    return [...jobs].sort((a, b) => (order[a.category] ?? 3) - (order[b.category] ?? 3) || b.overall - a.overall);
  }, [jobs]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: jobs.length, STRONG: 0, POTENTIAL: 0, LOW: 0 };
    for (const j of jobs) c[j.category] = (c[j.category] ?? 0) + 1;
    return c;
  }, [jobs]);

  return (
    <div className="fade-up flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Every posting the decision engine chose to show, ranked by overall fit."
      />

      {error ? <ErrorBanner title="JOBS ERROR">{error}</ErrorBanner> : null}

      {/* Filters */}
      <Panel className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`rounded-control border px-3 py-1.5 font-mono-face text-[11px] tracking-[0.06em] uppercase transition-colors ${
                category === c.value
                  ? "border-term bg-term text-white"
                  : "border-line-strong bg-sunken text-ink-soft hover:border-term hover:text-term-deep"
              }`}
            >
              {c.label}
              <span className="ml-1.5 opacity-70">{counts[c.value] ?? 0}</span>
            </button>
          ))}

          <label className="ml-auto flex items-center gap-2 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(e) => setIncludeHidden(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--term)]"
            />
            Show filtered-out jobs
          </label>
          <span className="mono-label">
            {total} {total === 1 ? "MATCH" : "MATCHES"}
          </span>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, company or location…"
            className="w-full rounded-control border border-line-strong bg-sunken px-3 py-2 text-sm text-ink outline-none focus:border-term"
          />
          <RetroButton type="submit">SEARCH</RetroButton>
        </form>
      </Panel>

      {loading ? (
        <Panel className="scanlines px-5 py-8">
          <div className="mono-label" style={{ color: "var(--term)" }}>
            LOADING JOBS<span className="cursor-blink">_</span>
          </div>
        </Panel>
      ) : grouped.length === 0 ? (
        <EmptyState
          code="NO JOBS"
          title="Nothing matches yet"
          body="Run a search from the dashboard to pull fresh postings from your enabled sources."
        >
          <Link href="/dashboard">
            <RetroButton variant="primary">GO TO DASHBOARD</RetroButton>
          </Link>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {grouped.map((job) => (
            <Panel key={job.jobId} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/jobs/${job.jobId}`}
                      className="text-base font-semibold text-ink hover:text-term-deep"
                    >
                      {job.title}
                    </Link>
                    {job.decision === "HIDE" ? (
                      <StatusBadge tone="red">FILTERED OUT</StatusBadge>
                    ) : null}
                    {job.remoteType === "REMOTE" ? <StatusBadge tone="green">REMOTE</StatusBadge> : null}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
                    <span className="font-medium text-ink">{job.company}</span>
                    {job.location ? <span>{job.location}</span> : null}
                    {job.employmentType ? <span>· {job.employmentType}</span> : null}
                    {job.salaryOriginal ? <span>· {job.salaryOriginal}</span> : null}
                    {job.sources.length ? (
                      <span className="mono-label">· VIA {job.sources.map((s) => s.label).join(", ")}</span>
                    ) : null}
                  </div>

                  {job.matchingSkills.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {job.matchingSkills.slice(0, 8).map((s) => (
                        <span
                          key={s}
                          className="rounded-control border border-line bg-sunken px-2 py-0.5 font-mono-face text-[10px] text-term-deep"
                        >
                          ✓ {s}
                        </span>
                      ))}
                      {job.missingSkills.slice(0, 4).map((s) => (
                        <span
                          key={s}
                          className="rounded-control border border-line bg-sunken px-2 py-0.5 font-mono-face text-[10px] text-muted"
                        >
                          ✕ {s}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="font-mono-face text-3xl font-bold" style={{ color: scoreColor(job.overall) }}>
                    {job.overall}
                  </div>
                  <StatusBadge tone={CATEGORY_TONE[job.category as keyof typeof CATEGORY_TONE] ?? "gray"}>
                    {job.category}
                  </StatusBadge>
                  <div className="mono-label">BY {job.provider.toUpperCase()}</div>
                  <ApplyLink url={job.applicationUrl} showHost />
                </div>
              </div>

              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-2">
                  <span className="mono-label w-16 shrink-0">SKILLS</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-sunken">
                    <div
                      className="h-full"
                      style={{
                        width: `${job.subScores.skills ?? 0}%`,
                        backgroundColor: "var(--term)",
                      }}
                    />
                  </div>
                  <span className="mono-label w-10 text-right">{job.subScores.skills ?? "N/A"}</span>
                </div>
              </div>

              <div className="mt-3">
                <Link href={`/jobs/${job.jobId}`} className="mono-label hover:text-term-deep">
                  WHY THIS MATCH →
                </Link>
              </div>
            </Panel>
          ))}

          {hasMore ? (
            <div className="flex justify-center pt-2">
              <RetroButton onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "LOADING..." : `LOAD ${Math.min(PAGE, total - jobs.length)} MORE`}
              </RetroButton>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
