import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { publicConfig } from "@/lib/config";
import { getKeyStatus } from "@/lib/ai/openrouter-client";
import { Panel, SectionHeader, MonoLabel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { RetroButton } from "@/components/ui/button";

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
  const key = cfg.aiProvider === "openrouter" ? await getKeyStatus() : null;
  const thresholds = [
    { label: "STRONG", range: "80 – 100" },
    { label: "POTENTIAL", range: "60 – 79" },
    { label: "LOW", range: "0 – 59" },
  ];

  return (
    <div className="fade-up flex flex-col gap-8">
      <PageHeader title="Settings" eyebrow="CONFIGURATION" />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* AI provider */}
        <Panel className="p-5">
          <SectionHeader
            eyebrow="AI PROVIDER"
            title="Intelligence Layer"
            action={
              <StatusBadge tone={cfg.aiAvailable ? "green" : "amber"} pulse={!cfg.aiAvailable}>
                {cfg.aiAvailable ? "AVAILABLE" : "NO KEY"}
              </StatusBadge>
            }
          />
          <Row label="PROVIDER" value={<span className="font-mono-face">{cfg.aiProvider}</span>} />
          <Row label="MODEL" value={<span className="font-mono-face">{cfg.aiModel}</span>} />
          <Row
            label="FALLBACK MODELS"
            value={
              <span className="font-mono-face">
                {cfg.aiFallbackModels.length ? cfg.aiFallbackModels.join(" → ") : "none"}
              </span>
            }
          />
          <Row
            label="JSON MODE"
            value={cfg.aiJsonMode ? "response_format (auto-detected per model)" : "off"}
          />
          <Row
            label="PROVIDER ROUTING"
            value={
              cfg.aiProviderOrder.length ? (
                <span className="font-mono-face">{cfg.aiProviderOrder.join(" → ")}</span>
              ) : (
                "automatic"
              )
            }
          />
          <Row
            label="CREDENTIALS"
            value={
              cfg.aiProvider === "heuristic"
                ? "Offline heuristic engine (no key needed)"
                : cfg.aiAvailable
                  ? "OpenRouter key configured via environment"
                  : "Missing — add OPENROUTER_API_KEY to .env"
            }
          />

          {key ? (
            <>
              <div className="mt-4 flex items-center justify-between gap-3">
                <MonoLabel>OPENROUTER ACCOUNT</MonoLabel>
                <StatusBadge tone={key.byokActive ? "green" : "amber"}>
                  {key.byokActive ? "BYOK ACTIVE" : "SHARED POOL"}
                </StatusBadge>
              </div>
              <Row label="KEY" value={<span className="font-mono-face">{key.label}</span>} />
              <Row
                label="PLAN"
                value={key.isFreeTier ? "Free tier" : "Paying"}
              />
              {key.limit !== null ? (
                <Row
                  label="QUOTA LEFT"
                  value={
                    <span className="font-mono-face">
                      {key.limitRemaining?.toFixed(3) ?? "0"} / {key.limit} credits
                    </span>
                  }
                />
              ) : null}
              <Row
                label="BYOK USAGE"
                value={
                  key.byokActive
                    ? `$${(key.byokUsage ?? 0).toFixed(4)} on your own key`
                    : "No own-key integration yet"
                }
              />
              {key.expiresAt ? (
                <Row
                  label="KEY EXPIRES"
                  value={new Date(key.expiresAt).toLocaleDateString()}
                />
              ) : null}
              <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                Free models draw on a shared upstream pool and return <span className="font-mono-face">429</span>{" "}
                often, which is what the fallback chain above exists for. To get a private quota,
                attach a{" "}
                <a
                  href="https://openrouter.ai/settings/integrations"
                  target="_blank"
                  rel="noreferrer"
                  className="text-term-deep underline"
                >
                  Google AI Studio key
                </a>{" "}
                in OpenRouter — then set{" "}
                <span className="font-mono-face">OPENROUTER_PROVIDER_ORDER</span> to route to it.
              </p>
            </>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-ink-soft">
              Keys live only in server environment variables. They are never sent to the
              browser or exposed to AI models.
            </p>
          )}
        </Panel>

        {/* Decision engine */}
        <Panel className="p-5">
          <SectionHeader
            eyebrow="MATCHING ENGINE"
            title="Decision Layer"
            action={
              <StatusBadge tone={cfg.jevConfigured ? "green" : "amber"}>
                {cfg.jevConfigured ? "JEV CONNECTED" : "DEV ENGINE"}
              </StatusBadge>
            }
          />
          <Row label="ENGINE" value={<span className="font-mono-face">{cfg.decisionProvider}</span>} />
          <Row label="MODEL" value={<span className="font-mono-face">{cfg.jevModel}</span>} />
          <Row
            label="STATUS"
            value={
              cfg.decisionProvider === "jev" && cfg.jevConfigured
                ? "TypeSafeAI JEV via the OpenRouter Decisions API"
                : "Development decision engine (not JEV)"
            }
          />
          <Row
            label="ENDPOINT"
            value={<span className="font-mono-face">/api/alpha/decisions</span>}
          />
          <div className="mt-4">
            <MonoLabel className="mb-2 block">MATCH THRESHOLDS</MonoLabel>
            <div className="flex flex-col gap-1.5">
              {thresholds.map((t) => (
                <div
                  key={t.label}
                  className="flex items-center justify-between rounded-control border border-line bg-sunken px-3 py-1.5"
                >
                  <span className="font-mono-face text-xs tracking-wide">{t.label}</span>
                  <span className="font-mono-face text-xs text-ink-soft">{t.range}%</span>
                </div>
              ))}
            </div>
          </div>
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
            The scheduler runs inside the Node server (node-cron). Manual searches are always
            available from the dashboard and the sources page. Set{" "}
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
          {Math.round(cfg.maxResumeBytes / 1024 / 1024)}MB
        </span>
      </Panel>
    </div>
  );
}
