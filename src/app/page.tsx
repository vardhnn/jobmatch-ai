import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { listAdapters } from "@/lib/sources";
import { DEFAULT_ENABLED_KEYS } from "@/lib/sources";
import { getSessionUser } from "@/lib/auth";
import { config, publicConfig } from "@/lib/config";
import { Panel, MonoLabel } from "@/components/ui/panel";
import { LandingNav } from "@/components/landing/landing-nav";
import { MotionObserver } from "@/components/landing/motion-observer";
import { GridCursor } from "@/components/shell/grid-cursor";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { RetroButton } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "JobMatch AI — Find jobs that actually fit you",
  description:
    "Upload your resume once. JobMatch AI searches every enabled job board each day, scores each posting against your profile with an explainable decision engine, and shows you only the jobs worth your time.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "JobMatch AI — Find jobs that actually fit you",
    description:
      "Your personal AI job hunter. Resume in, ranked jobs out — with the reasoning shown.",
    type: "website",
  },
};

/** Static by default; re-render hourly so adapter/configuration drift shows up. */
export const revalidate = 3600;

const STEPS = [
  {
    n: "01",
    icon: "▤",
    title: "Upload your resume",
    body: "PDF or DOCX. The parser pulls your skills, roles, dates and education into a structured profile you can edit afterwards.",
  },
  {
    n: "02",
    icon: "⚙",
    title: "Set what you want",
    body: "Target roles, locations, salary floor, work arrangement, seniority and how fresh a posting must be. Companies you never want to see again go on an exclusion list.",
  },
  {
    n: "03",
    icon: "≣",
    title: "Get a ranked shortlist",
    body: "Every enabled board is queried daily, duplicates are collapsed, and each posting is scored. You open a list — not an inbox of 400.",
  },
] as const;

const SUB_SCORES = [
  { label: "Skills", weight: 35 },
  { label: "Role", weight: 25 },
  { label: "Experience", weight: 15 },
  { label: "Location", weight: 10 },
  { label: "Salary", weight: 10 },
  { label: "Employment", weight: 5 },
] as const;

const THRESHOLDS = [
  { label: "STRONG", range: "80 – 100", tone: "var(--dot-ok)" },
  { label: "POTENTIAL", range: "60 – 79", tone: "var(--amber)" },
  { label: "LOW", range: "0 – 59", tone: "var(--muted)" },
] as const;

export default async function LandingPage() {
  // This page is the public front door. A signed-in visitor has no use for
  // marketing copy, so send them straight to the product; everyone else gets
  // the landing page. `getSessionUser` returns early without a database query
  // when there is no session cookie, so anonymous visitors stay cheap.
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const cfg = publicConfig();

  // Dynamic, derived from real config rather than hard-coded marketing copy.
  const adapters = listAdapters();
  const liveSources = adapters.filter((a) => a.isConfigured());

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <MotionObserver />
      <GridCursor />

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:gap-x-6 lg:px-8">
          <Link href="/" className="shrink-0 font-mono-face text-sm font-bold tracking-[0.12em]">
            JOBMATCH<span style={{ color: "var(--term)" }}>_AI</span>
          </Link>

          <LandingNav />

          {/* CTAs collapse with the nav on very small screens; the theme
              toggle stays at every width because it is the one control a
              visitor is most likely to want on a marketing page. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <div className="hidden items-center gap-2 sm:flex">
              <Link href="/login">
                <RetroButton size="sm">SIGN IN</RetroButton>
              </Link>
              <Link href="/login">
                <RetroButton size="sm" variant="primary">
                  GET STARTED
                </RetroButton>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:px-8 lg:pt-24">
          <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
            <div className="min-w-0">
              <MonoLabel className="reveal mb-4 block" data-reveal style={{ "--reveal-delay": "0ms" } as CSSProperties}>
                PERSONAL AI JOB HUNTER
                <span className="cursor-blink" style={{ color: "var(--term)" }}>
                  _
                </span>
              </MonoLabel>

              <h1
                className="reveal text-3xl font-semibold tracking-tight break-words sm:text-4xl lg:text-5xl"
                data-reveal
                style={{ "--reveal-delay": "70ms" } as CSSProperties}
              >
                Stop reading 400 job listings.
                <br />
                <span style={{ color: "var(--term-deep)" }}>Read the 6 that fit.</span>
              </h1>

              <p
                className="reveal mt-5 max-w-xl text-base leading-relaxed break-words text-ink-soft sm:text-lg"
                data-reveal
                style={{ "--reveal-delay": "140ms" } as CSSProperties}
              >
                Upload your resume once. JobMatch AI searches every board you enable, scores each
                posting against your profile with an{" "}
                <strong className="font-semibold text-ink">explainable</strong> decision engine,
                and shows its reasoning — so you know why a job made the list.
              </p>

              <div
                className="reveal mt-8 flex flex-wrap items-center gap-3"
                data-reveal
                style={{ "--reveal-delay": "210ms" } as CSSProperties}
              >
                <Link href="/login">
                  <RetroButton size="lg" variant="primary">
                    START FREE →
                  </RetroButton>
                </Link>
                <a href="#how">
                  <RetroButton size="lg">SEE HOW IT WORKS</RetroButton>
                </a>
              </div>

              <dl
                className="reveal mt-10 grid grid-cols-4 gap-x-3 gap-y-5 sm:gap-x-6"
                data-reveal
                style={{ "--reveal-delay": "280ms" } as CSSProperties}
              >
                {[
                  { k: `${liveSources.length}`, v: "boards wired up" },
                  { k: "6", v: "weighted sub-scores" },
                  { k: "Daily", v: "automatic search" },
                  { k: "100%", v: "reasoning shown" },
                ].map((s) => (
                  <div key={s.v} className="min-w-0">
                    <dt className="font-mono-face text-lg font-bold sm:text-2xl" style={{ color: "var(--term-deep)" }}>
                      {s.k}
                    </dt>
                    <dd className="mono-label-tight mt-1">{s.v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Terminal-style preview panel */}
            <div className="reveal min-w-0" data-reveal style={{ "--reveal-delay": "180ms" } as CSSProperties}>
              <Panel className="float-slow hover-lift overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line bg-sunken px-4 py-2.5">
                  <StatusDotInline />
                  <span className="mono-label ml-1">MATCH_ENGINE — LIVE OUTPUT</span>
                </div>
                <div className="space-y-3 p-4 font-mono-face text-xs sm:text-[13px]">
                  <Line k="QUERY" v="Senior Backend Engineer · Bengaluru" />
                  <Line k="FOUND" v="49 postings across 4 boards" />
                  <div className="pt-1">
                    <div className="mono-label mb-2">WEIGHTED SCORE</div>
                    {SUB_SCORES.map((s, i) => (
                      <Bar key={s.label} label={s.label} weight={s.weight} index={i} />
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                    <span className="mono-label">VERDICT</span>
                    <span className="flex items-center gap-2">
                      <span
                        className="rounded-control px-2 py-0.5 text-[11px] font-bold"
                        style={{ backgroundColor: "var(--term-wash)", color: "var(--term-deep)" }}
                      >
                        SHOW
                      </span>
                      <span className="text-ink-soft">73% · POTENTIAL</span>
                    </span>
                  </div>
                  <p className="border-t border-line pt-3 leading-relaxed text-ink-soft">
                    <span style={{ color: "var(--term)" }}>→</span> Your Python and FastAPI overlap is
                    strong; location scored low because the role is onsite in Pune.
                  </p>
                </div>
              </Panel>
            </div>
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────── */}
        <section id="how" className="scroll-mt-20 border-y border-line bg-panel">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <MonoLabel className="reveal mb-2 block" data-reveal>
              HOW IT WORKS
            </MonoLabel>
            <h2
              className="reveal max-w-2xl text-2xl font-semibold tracking-tight break-words sm:text-3xl"
              data-reveal
              style={{ "--reveal-delay": "70ms" } as CSSProperties}
            >
              Three steps, then it runs on its own.
            </h2>

            <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {STEPS.map((s, i) => (
                <li
                  key={s.n}
                  className="reveal min-w-0"
                  data-reveal
                  style={{ "--reveal-delay": `${i * 110}ms` } as CSSProperties}
                >
                  <Panel className="hover-lift h-full p-5">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line-strong font-mono-face text-sm"
                        style={{ color: "var(--term)" }}
                      >
                        {s.icon}
                      </span>
                      <span className="mono-label">{s.n}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold break-words">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed break-words text-ink-soft">{s.body}</p>
                  </Panel>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Engine ────────────────────────────────────────────── */}
        <section id="engine" className="scroll-mt-20">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
              <div className="min-w-0">
                <MonoLabel className="reveal mb-2 block" data-reveal>
                  WHY IT&rsquo;S DIFFERENT
                </MonoLabel>
                <h2
                  className="reveal text-2xl font-semibold tracking-tight break-words sm:text-3xl"
                  data-reveal
                  style={{ "--reveal-delay": "70ms" } as CSSProperties}
                >
                  A score you can argue with.
                </h2>
                <p
                  className="reveal mt-4 text-sm leading-relaxed break-words text-ink-soft sm:text-base"
                  data-reveal
                  style={{ "--reveal-delay": "140ms" } as CSSProperties}
                >
                  Most job tools hand you a percentage and ask for trust. JobMatch splits every
                  match into weighted parts, then tells you which ones dragged the score down. A
                  73% that is really &ldquo;perfect skills, wrong city&rdquo; is a very different
                  decision from a 73% that is &ldquo;half the stack missing&rdquo; — and you can
                  see which one you&rsquo;re looking at.
                </p>

                <div className="mt-7 space-y-3">
                  {THRESHOLDS.map((t, i) => (
                    <div
                      key={t.label}
                      className="reveal hover-lift flex items-center justify-between gap-3 rounded-control border border-line bg-panel px-4 py-2.5"
                      data-reveal
                      style={{ "--reveal-delay": `${i * 90}ms` } as CSSProperties}
                    >
                      <span className="flex items-center gap-2.5 font-mono-face text-xs">
                        <span
                          aria-hidden
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: t.tone }}
                        />
                        {t.label}
                      </span>
                      <span className="font-mono-face text-xs text-ink-soft">{t.range}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="reveal min-w-0" data-reveal style={{ "--reveal-delay": "160ms" } as CSSProperties}>
                <Panel className="hover-lift p-5">
                  <div className="mono-label mb-4">CURRENT CONFIGURATION</div>
                  <dl className="space-y-3 text-sm">
                    <CfgRow label="Decision engine" value="JEV (TypeSafe) · deterministic fallback" ok />
                    <CfgRow label="Decision model" value="typesafe/jev-1.13" ok />
                    <CfgRow label="Language model" value="Your own key (BYOK)" ok />
                    <CfgRow
                      label="Supported providers"
                      value="OpenAI-compatible · Anthropic · Gemini"
                      ok
                    />
                    <CfgRow label="Search schedule" value={`${cfg.searchCron} (${cfg.searchTimezone})`} ok />
                  </dl>
                  <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-ink-soft">
                    You bring the model: add an API key from any major provider — or any custom
                    OpenAI-compatible endpoint, including local models — in Settings after signing
                    up. The decision engine answers typed questions with probabilities and never
                    writes prose; the language model only parses text and explains results.
                  </p>
                </Panel>
              </div>
            </div>
          </div>
        </section>

        {/* ── Sources ───────────────────────────────────────────── */}
        <section id="sources" className="scroll-mt-20 border-y border-line bg-panel">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <MonoLabel className="reveal mb-2 block" data-reveal>
              JOB SOURCES
            </MonoLabel>
            <h2
              className="reveal max-w-2xl text-2xl font-semibold tracking-tight break-words sm:text-3xl"
              data-reveal
              style={{ "--reveal-delay": "70ms" } as CSSProperties}
            >
              Real boards, queried the way they allow.
            </h2>
            <p
              className="reveal mt-4 max-w-2xl text-sm leading-relaxed break-words text-ink-soft"
              data-reveal
              style={{ "--reveal-delay": "140ms" } as CSSProperties}
            >
              Each source is normalised into one shape, so scoring stays identical no matter where a
              posting came from. Nothing here is a demo feed — every listing below came back from a
              live endpoint.
            </p>

            <ul className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {adapters.map((a, i) => {
                const configured = a.isConfigured();
                const onByDefault = DEFAULT_ENABLED_KEYS.includes(a.key);
                return (
                  <li
                    key={a.key}
                    className="reveal min-w-0"
                    data-reveal
                    style={{ "--reveal-delay": `${(i % 3) * 80}ms` } as CSSProperties}
                  >
                    <Panel className="hover-lift flex h-full items-start gap-3 p-4">
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: configured ? "var(--term)" : "var(--dot-off)" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium break-words">{a.label}</span>
                          {configured ? (
                            <span className="mono-label" style={{ color: "var(--term-deep)" }}>
                              {onByDefault ? "ON BY DEFAULT" : "AVAILABLE"}
                            </span>
                          ) : (
                            <span className="mono-label">NEEDS KEY</span>
                          )}
                        </div>
                        <p className="mono-label mt-1 leading-relaxed break-words">
                          {configured ? (a.attribution ?? a.label) : a.configureHint}
                        </p>
                      </div>
                    </Panel>
                  </li>
                );
              })}
            </ul>

            <p
              className="reveal mt-6 max-w-3xl text-xs leading-relaxed break-words text-ink-soft"
              data-reveal
            >
              <strong className="font-semibold text-ink">LinkedIn</strong> is read through its
              unauthenticated public guest search — no account, no cookies, and no attempt to get
              around its bot checks; if it serves a challenge the source reports that and stands
              down. <strong className="font-semibold text-ink">Indeed and Naukri are not scraped
              at all</strong>: both refuse server-side requests outright (Indeed returns 403 with
              a captcha, Naukri redirects to its homepage), and working around that would mean
              building detection-evasion. Those same employers are reached instead through the ATS
              source, straight from their own boards — first-party, unblocked, and with fuller
              descriptions than an aggregator copy.
            </p>
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <Panel className="scanlines relative overflow-hidden p-8 text-center sm:p-12">
            <div className="sheen" aria-hidden />
            <MonoLabel className="reveal relative mb-3 block" data-reveal>
              NO CREDIT CARD · NO SALES PITCH
            </MonoLabel>
            <h2
              className="reveal relative mx-auto max-w-2xl text-2xl font-semibold tracking-tight break-words sm:text-3xl"
              data-reveal
              style={{ "--reveal-delay": "70ms" } as CSSProperties}
            >
              Point it at your resume.
            </h2>
            <p
              className="reveal relative mx-auto mt-4 max-w-xl text-sm leading-relaxed break-words text-ink-soft"
              data-reveal
              style={{ "--reveal-delay": "140ms" } as CSSProperties}
            >
              Upload a resume, set your preferences, and the first ranked shortlist is a search
              away.
            </p>
            <div
              className="reveal relative mt-8 flex flex-wrap items-center justify-center gap-3"
              data-reveal
              style={{ "--reveal-delay": "210ms" } as CSSProperties}
            >
              <Link href="/login">
                <RetroButton size="lg" variant="primary">
                  START FREE →
                </RetroButton>
              </Link>
              <Link href="/login">
                <RetroButton size="lg">I ALREADY HAVE AN ACCOUNT</RetroButton>
              </Link>
            </div>
          </Panel>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-line bg-panel">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-7 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <div className="font-mono-face text-xs font-bold tracking-[0.12em]">
              JOBMATCH<span style={{ color: "var(--term)" }}>_AI</span>
            </div>
            <p className="mt-1 text-xs break-words text-ink-soft">
              Personal AI job discovery · {config.appMode} mode
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1.5">
            <a href="#how" className="text-xs text-ink-soft hover:text-term-deep">
              How it works
            </a>
            <a href="#engine" className="text-xs text-ink-soft hover:text-term-deep">
              Engine
            </a>
            <a href="#sources" className="text-xs text-ink-soft hover:text-term-deep">
              Sources
            </a>
            <Link href="/login" className="text-xs text-ink-soft hover:text-term-deep">
              Sign in
            </Link>
          </nav>
          <p className="mono-label md:text-right">RESUME IN · RANKED JOBS OUT</p>
        </div>
      </footer>
    </div>
  );
}

/* ── Small local presentational pieces ───────────────────────── */

function StatusDotInline() {
  return (
    <span
      aria-hidden
      className="pulse-dot inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: "var(--dot-ok)" }}
    />
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="mono-label shrink-0">{k}</span>
      <span className="min-w-0 break-anywhere text-ink">{v}</span>
    </div>
  );
}

function Bar({
  label,
  weight,
  index,
}: {
  label: string;
  weight: number;
  /** Drives the staggered fill so bars don't all snap in at once. */
  index: number;
}) {
  // Deterministic pseudo-values so the illustration is stable between renders.
  const value = Math.max(12, 100 - weight - (label.length % 3) * 9);
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {/* Fixed label column: without a shared width, longer labels
          ("Experience") push into the bar and the row stops lining up. */}
      <span className="w-20 shrink-0 truncate sm:w-24" title={label}>
        {label}
      </span>
      <span className="bar-track h-1.5 min-w-0 flex-1 rounded-sm">
        <span
          className="bar-fill"
          style={
            {
              "--bar-w": `${value}%`,
              "--bar-delay": `${420 + index * 90}ms`,
            } as CSSProperties
          }
        />
      </span>
      <span className="w-16 shrink-0 whitespace-nowrap text-right text-ink-soft sm:w-20">
        {value} · {weight}%
      </span>
    </div>
  );
}

function CfgRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2.5 last:border-b-0 last:pb-0">
      <dt className="mono-label shrink-0">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: ok ? "var(--dot-ok)" : "var(--dot-warn)" }}
        />
        <span className="min-w-0 break-anywhere font-mono-face text-xs">{value}</span>
      </dd>
    </div>
  );
}
