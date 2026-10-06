"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Panel, SectionHeader } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { RetroButton } from "@/components/ui/button";
import { StatusBadge, StatusDot } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/states";

type Source = {
  key: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  status: string;
  statusDetail: string;
  attribution: string | null;
  configureHint: string;
};

type QueryRow = { id: string; query: string; type: string; approved: boolean };

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [queries, setQueries] = useState<QueryRow[]>([]);
  const [newQuery, setNewQuery] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [srcRes, qRes] = await Promise.all([fetch("/api/sources"), fetch("/api/search/queries")]);
    if (!srcRes.ok) {
      setError("Could not load sources.");
      setLoading(false);
      return;
    }
    setSources((await srcRes.json()).sources ?? []);
    if (qRes.ok) setQueries((await qRes.json()).queries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch {
        setError("Could not load sources.");
        setLoading(false);
      }
    })();
  }, [load]);

  async function toggleQuery(q: QueryRow) {
    setQueryBusy(true);
    try {
      const res = await fetch("/api/search/queries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: q.id, approved: !q.approved }),
      });
      if (res.ok) {
        const data = await res.json();
        setQueries((prev) => prev.map((x) => (x.id === q.id ? { ...x, approved: data.approved } : x)));
      }
    } finally {
      setQueryBusy(false);
    }
  }

  async function addQuery() {
    const text = newQuery.trim();
    if (!text) return;
    setQueryBusy(true);
    try {
      const res = await fetch("/api/search/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not add that query.");
        return;
      }
      setQueries((prev) => [...prev, { id: data.id, query: data.query, type: "CUSTOM", approved: true }]);
      setNewQuery("");
    } finally {
      setQueryBusy(false);
    }
  }

  async function toggle(source: Source) {
    setBusy(source.key);
    setError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: source.key, enabled: !source.enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not update that source.");
        return;
      }
      setSources(data.sources);
    } catch {
      setError("Network failure while updating the source.");
    } finally {
      setBusy(null);
    }
  }

  async function runSearch() {
    setRunning(true);
    setError(null);
    setRunResult(null);
    try {
      const res = await fetch("/api/search/run", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Search failed.");
        return;
      }
      const s = data.summary;
      setRunResult(
        `${s.totalFound} found · ${s.newJobs} new · ${s.duplicates} deduped · ${s.strongMatches} strong · ${s.potentialMatches} potential${s.errors.length ? ` · ${s.errors.length} issue(s)` : ""}${s.notes?.length ? ` · ${s.notes.length} note(s)` : ""}`,
      );
    } catch {
      setError("Network failure while running the search.");
    } finally {
      setRunning(false);
    }
  }

  const enabled = sources.filter((s) => s.enabled);

  return (
    <div className="fade-up flex flex-col gap-6">
      <PageHeader
        title="Job sources"
        description="Each board is queried directly through its public API and normalized into the same shape, so scoring and ranking stay identical no matter where a job came from."
        actions={
          <RetroButton
            variant="primary"
            onClick={runSearch}
            disabled={running || enabled.length === 0}
          >
            {running ? "SEARCHING..." : "RUN SEARCH"}
          </RetroButton>
        }
      />

      {error ? <ErrorBanner title="SOURCES ERROR">{error}</ErrorBanner> : null}
      {runResult ? (
        <Panel className="px-4 py-3 text-sm text-ink">
          <span className="mono-label mr-2">RUN COMPLETE</span>
          {runResult}
        </Panel>
      ) : null}

      {/* ── Search queries ──────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="SEARCH QUERIES"
          title="What it searches for"
          action={
            <span className="mono-label">
              {queries.filter((q) => q.approved).length}/{queries.length} ACTIVE
            </span>
          }
        />
        <Panel className="flex flex-col gap-3 p-5">
          {queries.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No queries yet — they are generated from your profile and preferences on the first
              search, then listed here so you can tune them.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {queries.map((q) => (
                <button
                  key={q.id}
                  onClick={() => toggleQuery(q)}
                  disabled={queryBusy}
                  className={`rounded-control border px-3 py-1.5 font-mono-face text-[11px] tracking-[0.04em] transition-colors disabled:opacity-60 ${
                    q.approved
                      ? "border-term bg-term-wash text-term-deep"
                      : "border-line-strong bg-sunken text-muted line-through"
                  }`}
                  title={q.approved ? "Click to stop searching this" : "Click to search this again"}
                >
                  {q.approved ? "" : "✕ "}
                  {q.query}
                  {q.type === "CUSTOM" ? " ★" : ""}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addQuery();
            }}
          >
            <input
              value={newQuery}
              onChange={(e) => setNewQuery(e.target.value)}
              placeholder="Add your own query — e.g. Platform Engineer"
              className="w-full rounded-control border border-line-strong bg-sunken px-3 py-2 text-sm text-ink outline-none focus:border-term"
            />
            <RetroButton type="submit" disabled={queryBusy || !newQuery.trim()}>
              + ADD
            </RetroButton>
          </form>
          <p className="text-xs leading-relaxed text-ink-soft">
            Queries are generated by AI from your profile and preferences. Switch one off and it stays
            off on later runs; ★ marks a query you added yourself.
          </p>
        </Panel>
      </section>

      {enabled.length === 0 && !loading ? (
        <Panel sunken className="px-4 py-3 text-sm text-ink-soft">
          No sources are enabled — a search would return nothing. Turn on at least one below.
        </Panel>
      ) : null}

      {loading ? (
        <Panel className="scanlines px-5 py-8">
          <div className="mono-label" style={{ color: "var(--term)" }}>
            LOADING SOURCES<span className="cursor-blink">_</span>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sources.map((s) => (
            <Panel key={s.key} className="flex flex-col gap-3 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot state={s.enabled ? "ok" : "idle"} />
                    <span className="text-base font-semibold text-ink">{s.label}</span>
                  </div>
                  <div className="mono-label mt-1">{s.key}</div>
                </div>
                <StatusBadge tone={s.configured ? (s.enabled ? "green" : "gray") : "amber"}>
                  {s.configured ? (s.enabled ? "ENABLED" : "DISABLED") : "NEEDS KEY"}
                </StatusBadge>
              </div>

              <p className="text-xs leading-relaxed text-ink-soft">{s.statusDetail}</p>

              {s.attribution ? (
                <p className="mono-label">{s.attribution.toUpperCase()}</p>
              ) : null}

              <div className="mt-auto flex items-center gap-2 pt-1">
                <RetroButton
                  size="sm"
                  variant={s.enabled ? "danger" : "primary"}
                  disabled={busy === s.key || (!s.configured && !s.enabled)}
                  onClick={() => toggle(s)}
                >
                  {busy === s.key ? "WORKING..." : s.enabled ? "DISABLE" : "ENABLE"}
                </RetroButton>
                {!s.configured ? (
                  <Link href="/settings" className="mono-label hover:text-term-deep">
                    SETUP NOTES →
                  </Link>
                ) : null}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel sunken className="px-4 py-3 text-sm leading-relaxed text-ink-soft">
        <strong className="text-ink">How the big portals are handled.</strong> LinkedIn is read
        through its unauthenticated public guest search — no account, no cookies, and no attempt to
        get around its bot checks; if it serves a challenge the source reports that and stands down.
        Indeed and Naukri are not scraped at all: both refuse server-side requests outright
        (Indeed returns 403 with a captcha, Naukri redirects to its homepage), and beating that
        would mean building detection-evasion. The{" "}
        <strong className="text-ink">ATS</strong> source gets you the same employers straight from
        their own boards instead — first-party, no blocks, and fuller descriptions. Adzuna is the
        other multi-board option: drop
        <code className="mx-1 font-mono-face text-xs">ADZUNA_APP_ID</code> and
        <code className="mx-1 font-mono-face text-xs">ADZUNA_API_KEY</code> into{" "}
        <code className="font-mono-face text-xs">.env</code> and it appears here.
      </Panel>
    </div>
  );
}
