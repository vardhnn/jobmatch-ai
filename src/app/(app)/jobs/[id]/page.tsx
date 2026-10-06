"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Panel, SectionHeader } from "@/components/ui/panel";
import { RetroButton } from "@/components/ui/button";
import { ApplyLink } from "@/components/ui/apply-link";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/states";

type JobDetail = {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryOriginal: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedDate: string | null;
  applicationUrl: string | null;
  description: string | null;
  overall: number;
  category: string;
  decision: string;
  subScores: Record<string, number | null>;
  matchingSkills: string[];
  missingSkills: string[];
  niceToHaveSkills: string[];
  requiredSkills: string[];
  explanation: string | null;
  provider: string;
  firstSeenAt: string;
  sources: { key: string; label: string }[];
  analysis: {
    responsibilities: string[];
    experienceRequirement: string | null;
    educationRequirement: string | null;
    seniority: string | null;
    remoteType: string | null;
    provider: string;
  } | null;
};

const CATEGORY_TONE = { STRONG: "green", POTENTIAL: "amber", LOW: "gray" } as const;

const DIMENSIONS: [string, string, number][] = [
  ["skills", "SKILLS", 0.35],
  ["role", "ROLE", 0.25],
  ["experience", "EXPERIENCE", 0.15],
  ["location", "LOCATION", 0.1],
  ["salary", "SALARY", 0.1],
  ["employment", "EMPLOYMENT", 0.05],
];

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = use(params);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) {
      setError(res.status === 404 ? "That job is not in your match list." : "Could not load this job.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setJob(data.job);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch {
        setError("Could not load this job.");
        setLoading(false);
      }
    })();
  }, [load]);

  if (loading) {
    return (
      <Panel className="scanlines px-5 py-8">
        <div className="mono-label" style={{ color: "var(--term)" }}>
          LOADING JOB<span className="cursor-blink">_</span>
        </div>
      </Panel>
    );
  }

  if (error || !job) {
    return (
      <div className="fade-up flex flex-col gap-4">
        <ErrorBanner title="JOB ERROR">{error ?? "Job not found."}</ErrorBanner>
        <Link href="/jobs">
          <RetroButton>← BACK TO JOBS</RetroButton>
        </Link>
      </div>
    );
  }

  const scoreColor =
    job.overall >= 80 ? "var(--term)" : job.overall >= 60 ? "var(--amber)" : "var(--danger)";

  return (
    <div className="fade-up flex flex-col gap-6">
      <Link href="/jobs" className="mono-label hover:text-term-deep">
        ← ALL JOBS
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mono-label mb-1 truncate">{job.company}</div>
          <h1 className="text-xl font-semibold break-words tracking-tight sm:text-2xl lg:text-[28px]">
            {job.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            {job.location ? <span>{job.location}</span> : null}
            {job.employmentType ? <span>· {job.employmentType}</span> : null}
            {job.experienceLevel ? <span>· {job.experienceLevel}</span> : null}
            {job.remoteType !== "UNKNOWN" ? (
              <StatusBadge tone={job.remoteType === "REMOTE" ? "green" : "gray"}>
                {job.remoteType}
              </StatusBadge>
            ) : null}
            {job.sources.length ? (
              <span className="mono-label">· VIA {job.sources.map((s) => s.label).join(", ")}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-mono-face text-4xl font-bold" style={{ color: scoreColor }}>
              {job.overall}
            </div>
            <StatusBadge tone={CATEGORY_TONE[job.category as keyof typeof CATEGORY_TONE] ?? "gray"}>
              {job.category}
            </StatusBadge>
          </div>
          <ApplyLink url={job.applicationUrl} size="lg" showHost />
        </div>
      </div>

      {/* Explainability */}
      <section>
        <SectionHeader
          eyebrow="WHY THIS MATCH"
          title="Decision breakdown"
          action={<span className="mono-label">ENGINE · {job.provider.toUpperCase()}</span>}
        />
        <Panel className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-2">
            {DIMENSIONS.map(([key, label, weight]) => {
              const value = job.subScores[key] ?? null;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="mono-label w-20 shrink-0 sm:w-24">{label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-sm border border-line bg-sunken">
                    {value === null ? (
                      <div
                        className="h-full w-full"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(45deg, transparent, transparent 4px, var(--line) 4px, var(--line) 8px)",
                        }}
                      />
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
                  <span className="mono-label w-12 text-right">{value === null ? "N/A" : value}</span>
                  <span className="mono-label w-10 text-right">×{Math.round(weight * 100)}%</span>
                </div>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SkillList title="YOU HAVE" items={job.matchingSkills} tone="ok" />
            <SkillList title="MISSING" items={job.missingSkills} tone="bad" />
            <SkillList title="NICE TO HAVE" items={job.niceToHaveSkills} tone="neutral" />
          </div>

          {job.explanation ? (
            <div className="rounded-control border border-line bg-sunken px-4 py-3 text-sm leading-relaxed text-ink">
              <div className="mono-label mb-1.5">AI EXPLANATION</div>
              {job.explanation}
            </div>
          ) : null}

          <p className="text-xs leading-relaxed text-ink-soft">
            Sub-scores are JEV&rsquo;s typed answers from the Decisions API, normalized to 0–100 and
            weighted into the overall score. Skills are exact set arithmetic against the job&rsquo;s
            requirements — nothing is guessed.
          </p>
        </Panel>
      </section>

      {/* Job facts */}
      <section>
        <SectionHeader eyebrow="POSTING" title="At a glance" />
        <Panel className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="COMPANY" value={job.company} />
          <Fact label="LOCATION" value={job.location ?? "Not stated"} />
          <Fact
            label="SALARY"
            value={
              job.salaryOriginal ??
              (job.salaryMin || job.salaryMax
                ? `${job.salaryMin ?? "?"} – ${job.salaryMax ?? "?"} ${job.salaryCurrency ?? ""}`
                : "Not disclosed")
            }
          />
          <Fact
            label="POSTED"
            value={job.postedDate ? new Date(job.postedDate).toLocaleDateString() : "Unknown"}
          />
          {job.analysis?.experienceRequirement ? (
            <Fact label="EXPERIENCE" value={job.analysis.experienceRequirement} />
          ) : null}
          {job.analysis?.seniority ? <Fact label="SENIORITY" value={job.analysis.seniority} /> : null}
          {job.analysis?.educationRequirement ? (
            <Fact label="EDUCATION" value={job.analysis.educationRequirement} />
          ) : null}
          <Fact label="FIRST SEEN" value={new Date(job.firstSeenAt).toLocaleString()} />
        </Panel>
      </section>

      {job.description ? (
        <section>
          <SectionHeader eyebrow="DESCRIPTION" title="Full posting" />
          <Panel className="max-h-[32rem] overflow-y-auto px-5 py-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-soft">
              {job.description}
            </pre>
          </Panel>
        </section>
      ) : null}

      {job.analysis?.responsibilities.length ? (
        <section>
          <SectionHeader eyebrow="RESPONSIBILITIES" title="What you'd own" />
          <Panel className="px-5 py-4">
            <ul className="flex flex-col gap-1.5">
              {job.analysis.responsibilities.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink-soft">
                  <span style={{ color: "var(--term)" }}>▸</span>
                  {r}
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono-label">{label}</div>
      <div className="mt-1 text-sm text-ink">{value}</div>
    </div>
  );
}

function SkillList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "ok" | "bad" | "neutral";
}) {
  const color =
    tone === "ok" ? "var(--term-deep)" : tone === "bad" ? "var(--danger)" : "var(--muted)";
  return (
    <div>
      <div className="mono-label mb-1.5">{title}</div>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((s) => (
            <span
              key={s}
              className="rounded-control border border-line bg-sunken px-2 py-0.5 font-mono-face text-[10px]"
              style={{ color }}
            >
              {s}
            </span>
          ))}
        </div>
      ) : (
        <span className="mono-label">NONE</span>
      )}
    </div>
  );
}
