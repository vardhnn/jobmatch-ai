"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Panel, SectionHeader } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { ApplyLink } from "@/components/ui/apply-link";
import { RetroButton } from "@/components/ui/button";
import { StatusBadge, StatusDot } from "@/components/ui/badge";
import { ErrorBanner, EmptyState } from "@/components/ui/states";
import { RetroProgress } from "@/components/ui/progress";

type SubScores = {
  skills: number | null;
  experience: number | null;
  role: number | null;
  location: number | null;
  salary: number | null;
  employment: number | null;
};

type TopMatch = {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  overall: number;
  category: string;
  provider: string;
  applicationUrl: string | null;
  subScores: SubScores;
};

type Dashboard = {
  stats: { newToday: number; strong: number; potential: number; low: number; unread: number; averageScore: number | null };
  readiness: {
    hasResume: boolean;
    hasProfile: boolean;
    hasPreferences: boolean;
    skillCount: number;
    desiredRoles: string[];
    postedWithinDays: number;
  };
  engines: {
    aiModel: string;
    aiFallbacks: string[];
    aiProvider: string;
    decisionModel: string;
    decisionProvider: string;
  };
  lastRun: {
    id: string;
    status: string;
    trigger: string;
    startedAt: string;
    finishedAt: string | null;
    totalFound: number;
    newJobs: number;
    duplicates: number;
    analyzed: number;
    sourcesTried: number;
    strongMatches: number;
    potentialMatches: number;
    queries: string[];
    searchedTerms: string[];
    errors: { source: string; code: string; message: string }[];
    notes: string[];
  } | null;
  recentRuns: {
    id: string;
    status: string;
    trigger: string;
    startedAt: string;
    newJobs: number;
    totalFound: number;
    strongMatches: number;
    potentialMatches: number;
  }[];
  topMatches: TopMatch[];
};

type RunSummary = {
  newJobs: number;
  totalFound: number;
  duplicates: number;
  analyzed: number;
  strongMatches: number;
  potentialMatches: number;
  sourcesTried: number;
  queries: string[];
  /** The subset of `queries` actually sent to the sources. */
  searchedTerms?: string[];
  errors: { source: string; message: string }[];
  /** Non-fatal advisories — shown separately so they never read as failures. */
  notes?: string[];
  /** Present only on the live response, used to stamp the panel. */
  startedAt?: string;
};

const CATEGORY_TONE = { STRONG: "green", POTENTIAL: "amber", LOW: "gray" } as const;

type StoredRun = NonNullable<Dashboard["lastRun"]>;

/** Reshape a persisted run into the same shape the live run endpoint returns. */
function storedRunToSummary(r: StoredRun): RunSummary {
  return {
    newJobs: r.newJobs,
    totalFound: r.totalFound,
    duplicates: r.duplicates,
    analyzed: r.analyzed,
    strongMatches: r.strongMatches,
    potentialMatches: r.potentialMatches,
    sourcesTried: r.sourcesTried,
    queries: r.queries,
    searchedTerms: r.searchedTerms,
    errors: r.errors.map((e) => ({ source: e.source, message: e.message })),
    notes: r.notes,
    startedAt: r.startedAt,
  };
}

const DIMENSIONS: [keyof SubScores, string, number][] = [
  ["skills", "SKILLS", 0.35],
  ["role", "ROLE", 0.25],
  ["experience", "EXPERIENCE", 0.15],
  ["location", "LOCATION", 0.1],
  ["salary", "SALARY", 0.1],
  ["employment", "EMPLOYMENT", 0.05],
];

function StatTile({ label, value, tone = "ink" }: { label: string; value: string | number; tone?: string }) {
  return (
    // Padding and type scale down below `sm` because the mobile grid is four
    // across: at 320px a four-column tile is ~66px wide, and the desktop
    // padding alone would leave no room for the label.
    <Panel className="px-2.5 py-2.5 sm:px-4 sm:py-3">
      <div className="mono-label-tight">{label}</div>
      <div
        className="mt-1 font-mono-face text-xl font-bold sm:text-2xl"
        style={{ color: `var(--${tone})` }}
      >
        {value}
      </div>
    </Panel>
  );
}

/** Horizontal breakdown of the six weighted sub-scores. */
function ScoreBars({ subScores }: { subScores: SubScores }) {
  return (
    <div className="flex flex-col gap-1.5">
      {DIMENSIONS.map(([key, label, weight]) => {
        const value = subScores[key];
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="mono-label w-20 shrink-0 sm:w-24">{label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-sm border border-line bg-sunken">
              {value === null ? (
                <div className="h-full w-full" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 3px, var(--line) 3px, var(--line) 6px)" }} />
              ) : (
                <div
                  className="h-full"
                  style={{
                    width: `${value}%`,
                    backgroundColor:
                      value >= 75 ? "var(--term)" : value >= 50 ? "var(--amber)" : "var(--danger)",
                  }}
                />
              )}
            </div>
            <span className="mono-label w-12 shrink-0 text-right">
              {value === null ? "N/A" : value}
            </span>
            <span className="mono-label w-10 shrink-0 text-right">{Math.round(weight * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/dashboard");
    if (res.ok) setData(await res.json());
    else setError("Could not load the dashboard.");
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch {
        setError("Could not load the dashboard.");
        setLoading(false);
      }
    })();
  }, [load]);

  async function runSearch() {
    setRunning(true);
    setError(null);
    setRun(null);
    try {
      const res = await fetch("/api/search/run", { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.message ?? "Search failed.");
        return;
      }
      setRun(payload.summary);
      await load();
    } catch {
      setError("Network failure while running the search.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="fade-up">
        <h1 className="mb-6 text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
        <Panel className="scanlines px-5 py-8">
          <div className="mono-label" style={{ color: "var(--term)" }}>
            LOADING DASHBOARD<span className="cursor-blink">_</span>
          </div>
        </Panel>
      </div>
    );
  }

  const ready = data?.readiness;
  // A live run is shown exactly as it returned; on a cold load we fall back to
  // the stored run so a refresh never silently drops the explanation.
  const shownRun = run ?? (data?.lastRun ? storedRunToSummary(data.lastRun) : null);
  const steps = [
    { label: "Upload resume", done: Boolean(ready?.hasResume), href: "/resume" },
    { label: `${ready?.skillCount ?? 0} skills parsed`, done: Boolean(ready?.hasProfile), href: "/profile" },
    {
      label: ready?.desiredRoles.length ? ready.desiredRoles.slice(0, 2).join(", ") : "Set preferences",
      done: Boolean(ready?.hasPreferences),
      href: "/preferences",
    },
  ];
  const readyCount = steps.filter((s) => s.done).length;

  return (
    <div className="fade-up flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description={
          ready?.hasPreferences
            ? `Searching ${ready.postedWithinDays}-day-old roles for ${ready.desiredRoles.join(", ")}.`
            : "Set your preferences to start ranking real jobs."
        }
        actions={
          <>
            <RetroButton onClick={load} disabled={running}>
              REFRESH
            </RetroButton>
            <RetroButton variant="primary" onClick={runSearch} disabled={running}>
              {running ? "SEARCHING..." : "RUN SEARCH NOW"}
            </RetroButton>
          </>
        }
      />

      {error ? <ErrorBanner title="DASHBOARD ERROR">{error}</ErrorBanner> : null}

      {/* ── Setup checklist ─────────────────────────────────────────── */}
      <Panel className="px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="mono-label">SETUP · {readyCount}/3 COMPLETE</span>
          <StatusBadge tone={readyCount === 3 ? "green" : "amber"} pulse={readyCount < 3}>
            {readyCount === 3 ? "READY TO MATCH" : "ACTION NEEDED"}
          </StatusBadge>
        </div>
        <RetroProgress value={(readyCount / 3) * 100} />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {steps.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="flex items-center gap-2 rounded-control border border-line bg-sunken px-3 py-2 text-sm text-ink-soft hover:border-term hover:text-ink"
            >
              <StatusDot state={s.done ? "ok" : "idle"} />
              <span className="break-anywhere">{s.label}</span>
              {!s.done ? <span className="mono-label ml-auto">SETUP →</span> : null}
            </Link>
          ))}
        </div>
      </Panel>

      {/* ── Stats ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-6">
        <StatTile label="NEW TODAY" value={data?.stats.newToday ?? 0} tone="term" />
        <StatTile label="STRONG" value={data?.stats.strong ?? 0} tone="term" />
        <StatTile label="POTENTIAL" value={data?.stats.potential ?? 0} tone="amber" />
        <StatTile label="LOW" value={data?.stats.low ?? 0} tone="muted" />
        <StatTile label="AVG SCORE" value={data?.stats.averageScore ?? "—"} />
        <StatTile label="UNREAD" value={data?.stats.unread ?? 0} />
      </div>

      {/* ── Run result ──────────────────────────────────────────────── */}
      {running ? (
        <Panel className="scanlines px-5 py-6">
          <div className="mono-label" style={{ color: "var(--term)" }}>
            QUERYING SOURCES → ANALYZING → JEV DECISIONS<span className="cursor-blink">_</span>
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            This fans out across your enabled boards, then asks JEV to score each new posting.
          </p>
        </Panel>
      ) : null}

      {shownRun ? (
        <Panel className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="mono-label">
              {run ? "RUN SUMMARY" : "LAST RUN SUMMARY"} ·{" "}
              {shownRun.startedAt ? new Date(shownRun.startedAt).toLocaleString() : "just now"}
            </span>
            <StatusBadge tone={shownRun.errors.length ? "amber" : shownRun.newJobs === 0 ? "gray" : "green"}>
              {shownRun.sourcesTried} SOURCES · {shownRun.analyzed} ANALYZED
            </StatusBadge>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
            {[
              ["FOUND", shownRun.totalFound],
              ["NEW", shownRun.newJobs],
              ["DEDUPED", shownRun.duplicates],
              ["STRONG", shownRun.strongMatches],
              ["POTENTIAL", shownRun.potentialMatches],
            ].map(([label, value]) => (
              <div
                key={label as string}
                className="rounded-control border border-line bg-sunken px-2 py-2 sm:px-3"
              >
                <div className="mono-label-tight">{label}</div>
                <div className="font-mono-face text-base font-bold sm:text-lg">{value}</div>
              </div>
            ))}
          </div>
          {shownRun.queries.length ? (
            <>
              <p className="mt-3 text-xs text-ink-soft">
                <span className="mono-label">SEARCHED · </span>
                {(shownRun.searchedTerms?.length
                  ? shownRun.searchedTerms
                  : shownRun.queries
                ).join(" · ")}
              </p>
              {shownRun.searchedTerms?.length &&
              shownRun.searchedTerms.length < shownRun.queries.length ? (
                <p className="mt-1 text-xs text-ink-soft">
                  <span className="mono-label">ROTATES NEXT · </span>
                  {shownRun.queries
                    .filter((q) => !shownRun.searchedTerms!.includes(q))
                    .join(" · ")}
                </p>
              ) : null}
            </>
          ) : null}

          {/* A run that found plenty but added nothing is the confusing case —
              say so explicitly instead of leaving the user to wonder why the
              list looks identical. */}
          {shownRun.totalFound > 0 && shownRun.newJobs === 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-ink-soft">
              All {shownRun.totalFound} postings were already known — the same jobs came back and
              dedupe suppressed them. Your shortlist is unchanged because nothing genuinely new
              matched, not because the search failed.
              {shownRun.searchedTerms?.length &&
              shownRun.queries.some((q) => !shownRun.searchedTerms!.includes(q))
                ? " Each run searches a rotating slice of your query terms, so the remaining terms are covered over the next few runs."
                : ""}
            </p>
          ) : null}

          {shownRun.errors.length ? (
            <ul className="mt-3 flex flex-col gap-1">
              {shownRun.errors.map((e, i) => (
                <li key={i} className="text-xs" style={{ color: "var(--danger)" }}>
                  ▲ {e.source}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}

          {shownRun.notes?.length ? (
            <ul className="mt-3 flex flex-col gap-1">
              {shownRun.notes.map((n, i) => (
                <li key={i} className="text-xs text-ink-soft">
                  • {n}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      {/* ── Top matches ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="TOP MATCHES"
          title="Ranked for you"
          action={
            <Link href="/jobs" className="mono-label hover:text-term-deep">
              VIEW ALL →
            </Link>
          }
        />
        {!data?.topMatches.length ? (
          <EmptyState
            code="NO MATCHES YET"
            title="No jobs have been matched yet"
            body={
              ready?.hasPreferences
                ? "Run a search to pull fresh postings and score them with JEV."
                : "Set your preferences first, then run a search."
            }
          >
            {ready?.hasPreferences ? (
              <RetroButton variant="primary" onClick={runSearch} disabled={running}>
                RUN SEARCH NOW
              </RetroButton>
            ) : (
              <Link href="/preferences">
                <RetroButton variant="primary">SET PREFERENCES</RetroButton>
              </Link>
            )}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {data.topMatches.map((m) => (
              <Panel key={m.jobId} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/jobs/${m.jobId}`} className="block truncate text-base font-semibold text-ink hover:text-term-deep">
                      {m.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                      <span>{m.company}</span>
                      {m.location ? <span>· {m.location}</span> : null}
                      <StatusBadge tone={CATEGORY_TONE[m.category as keyof typeof CATEGORY_TONE] ?? "gray"}>
                        {m.overall}% · {m.category}
                      </StatusBadge>
                      <span className="mono-label">BY {m.provider.toUpperCase()}</span>
                    </div>
                  </div>
                  <ApplyLink url={m.applicationUrl} showHost />
                </div>
                <div className="mt-3">
                  <ScoreBars subScores={m.subScores} />
                </div>
              </Panel>
            ))}
          </div>
        )}
      </section>

      {/* ── Engines + history ───────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader eyebrow="ENGINES" title="What is deciding" />
          <Panel className="flex flex-col gap-3 p-5">
            <Row label="DECISION ENGINE" value={`${data?.engines.decisionProvider} · ${data?.engines.decisionModel}`} ok={data?.engines.decisionProvider === "jev"} />
            <Row label="AI MODEL" value={data?.engines.aiModel ?? "—"} ok={Boolean(data?.engines.aiProvider === "openrouter")} />
            <Row
              label="FALLBACKS"
              value={data?.engines.aiFallbacks?.join(" → ") ?? "none"}
              ok={Boolean(data?.engines.aiFallbacks?.length)}
            />
            <p className="text-xs leading-relaxed text-ink-soft">
              JEV answers typed questions (fit category, six sub-scores, show/hide) through
              OpenRouter&rsquo;s Decisions API. The chat model only parses text and writes
              explanations — when the primary model is rate-limited the chain above takes over.
            </p>
          </Panel>
        </section>

        <section>
          <SectionHeader eyebrow="HISTORY" title="Recent runs" />
          {!data?.recentRuns.length ? (
            <EmptyState code="NO RUNS" title="No searches yet" body="Run your first search to populate the board." />
          ) : (
            <Panel className="divide-y divide-line">
              {data.recentRuns.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <StatusDot state={r.status === "COMPLETED" ? "ok" : r.status === "RUNNING" ? "warn" : "off"} />
                  <span className="font-mono-face text-xs text-ink-soft">
                    {new Date(r.startedAt).toLocaleString()}
                  </span>
                  <span className="mono-label">{r.trigger}</span>
                  <span className="ml-auto text-ink-soft">
                    {r.newJobs} new / {r.totalFound} ·{" "}
                    <span style={{ color: "var(--term)" }}>{r.strongMatches} strong</span> ·{" "}
                    <span style={{ color: "var(--amber)" }}>{r.potentialMatches} potential</span>
                  </span>
                </div>
              ))}
            </Panel>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <StatusDot state={ok ? "ok" : "warn"} />
      {/* Stacked on narrow screens: a fixed-width label plus a long model id
          cannot share a 390px row without forcing horizontal scroll. */}
      <span className="mono-label shrink-0 sm:w-32">{label}</span>
      <span className="font-mono-face text-xs break-anywhere text-ink">{value}</span>
    </div>
  );
}
