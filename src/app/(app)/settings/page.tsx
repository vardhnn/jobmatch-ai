import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { publicConfig } from "@/lib/config";
import { Panel, SectionHeader } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { RetroButton } from "@/components/ui/button";
import { IntelligenceLayer } from "@/components/settings/intelligence-layer";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0">
      <span className="mono-label shrink-0">{label}</span>
      <span className="min-w-0 text-right text-sm break-anywhere text-ink">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const cfg = publicConfig();
  const user = await getSessionUser();

  return (
    <div className="fade-up flex flex-col gap-8">
      <PageHeader title="Settings" eyebrow="CONFIGURATION" />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* BYOK key manager */}
        <div className="lg:col-span-2">
          <IntelligenceLayer />
        </div>

        {/* Decision engine */}
        <Panel className="p-5">
          <SectionHeader
            eyebrow="MATCHING ENGINE"
            title="Decision Layer"
            action={<StatusBadge tone="green">AUTOMATIC</StatusBadge>}
          />
          <Row
            label="ENGINE"
            value={
              "JEV (TypeSafe decision model) when your active key is an OpenRouter key — otherwise the built-in deterministic engine."
            }
          />
          <Row label="MODEL" value={<span className="font-mono-face">typesafe/jev-1.13</span>} />
          <Row label="THRESHOLDS" value={<span className="font-mono-face">STRONG ≥ 80 · POTENTIAL ≥ 60 · LOW 0–59</span>} />
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">
            The decision layer answers typed questions with probabilities — it never writes prose.
            The language model only parses text and explains results. Keeping them separate is what
            makes the reasoning reproducible.
          </p>
        </Panel>

        {/* Schedule */}
        <Panel className="p-5">
          <SectionHeader
            eyebrow="AUTOMATION"
            title="Search Schedule"
            action={<StatusBadge tone="green" pulse>DAILY</StatusBadge>}
          />
          <Row label="FREQUENCY" value="Once per day" />
          <Row label="CRON" value={<span className="font-mono-face">{cfg.searchCron}</span>} />
          <Row label="TIMEZONE" value={<span className="font-mono-face">{cfg.searchTimezone}</span>} />
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">
            The scheduler runs inside the Node server (node-cron). Because AI keys live in your
            browser, scheduled runs fetch and store new postings but do not score them — your next
            visit&apos;s search matches everything automatically. Set{" "}
            <span className="font-mono-face">DISABLE_CRON=1</span> to turn automation off.
          </p>
        </Panel>

        {/* Account */}
        <Panel className="p-5">
          <SectionHeader
            eyebrow="ACCOUNT"
            title="Your Account"
            action={<StatusBadge tone="green">ACTIVE</StatusBadge>}
          />
          <Row label="EMAIL" value={user?.email ?? "—"} />
          <Row label="NAME" value={user?.name ?? "Not set"} />
          <Row
            label="MEMBER SINCE"
            value={
              user?.createdAt
                ? new Date(user.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "—"
            }
          />
          <div className="mt-4 flex gap-2">
            <Link href="/preferences">
              <RetroButton size="sm">PREFERENCES →</RetroButton>
            </Link>
            <Link href="/sources">
              <RetroButton size="sm">SOURCES →</RetroButton>
            </Link>
          </div>
        </Panel>
      </div>

      <Panel sunken className="px-4 py-3">
        <span className="mono-label">
          APP MODE · {cfg.appMode.toUpperCase()} · MAX RESUME{" "}
          {Math.round(cfg.maxResumeBytes / 1024 / 1024)}MB · JOB-BOARD KEYS: ADZUNA{" "}
          {cfg.sources.adzuna ? "✓" : "—"} / LINKEDIN {cfg.sources.linkedin ? "✓" : "—"}
        </span>
      </Panel>
    </div>
  );
}
