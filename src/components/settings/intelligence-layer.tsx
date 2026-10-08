"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel, SectionHeader, MonoLabel } from "@/components/ui/panel";
import { RetroButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/states";
import {
  UI_PROVIDER_PRESETS,
  listProfiles,
  getActiveProfile,
  saveProfile,
  deleteProfile,
  setActiveProfile,
  getPreset,
  type AiProfile,
} from "@/lib/client/ai-keys";

type Draft = {
  id?: string;
  label: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
};

const emptyDraft = (provider: string): Draft => ({
  label: "",
  provider,
  model: getPreset(provider)?.placeholderModel ?? "",
  baseUrl: getPreset(provider)?.baseUrl ?? "",
  apiKey: "",
});

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; latencyMs: number }
  | { status: "error"; message: string };

/**
 * Settings → Intelligence Layer: the BYOK key manager.
 *
 * Profiles live only in this browser's localStorage; the active one is sent
 * to the server per AI request. Multiple providers can be saved and switched,
 * and each can be verified with one real "test connection" call.
 */
export function IntelligenceLayer() {
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [showKey, setShowKey] = useState(false);
  const [mounted, setMounted] = useState(false);

  const refresh = () => {
    const list = listProfiles();
    setProfiles(list);
    setActiveId(getActiveProfile()?.id ?? null);
  };

  useEffect(() => {
    // localStorage is unavailable during SSR: load profiles in a microtask so
    // the effect body itself never calls setState synchronously.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      refresh();
      setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const preset = draft ? getPreset(draft.provider) : null;
  const needsBaseUrl = draft?.provider === "custom-openai";
  const optionalBaseUrl =
    draft && preset?.baseUrl && preset.protocol === "openai-compatible" && !needsBaseUrl;

  function startAdd() {
    setDraft(emptyDraft("openrouter"));
    setError(null);
    setTest({ status: "idle" });
  }

  function startEdit(p: AiProfile) {
    setDraft({
      id: p.id,
      label: p.label,
      provider: p.provider,
      model: p.model,
      baseUrl: p.baseUrl ?? "",
      apiKey: p.apiKey,
    });
    setError(null);
    setTest({ status: "idle" });
  }

  function onProviderChange(provider: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            provider,
            model: getPreset(provider)?.placeholderModel ?? "",
            baseUrl: getPreset(provider)?.baseUrl ?? "",
          }
        : d,
    );
    setTest({ status: "idle" });
  }

  async function runTest() {
    if (!draft) return;
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: draft.provider,
          apiKey: draft.apiKey,
          model: draft.model,
          baseUrl: draft.baseUrl || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTest({ status: "error", message: data?.message ?? `Request failed (${res.status}).` });
        return;
      }
      if (data?.ok) setTest({ status: "ok", latencyMs: data.latencyMs ?? 0 });
      else setTest({ status: "error", message: data?.error ?? "Connection failed." });
    } catch {
      setTest({ status: "error", message: "Network failure while testing the connection." });
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      if (!draft.model.trim()) {
        setError("Model id is required.");
        return;
      }
      if (!draft.apiKey.trim() && getPreset(draft.provider)?.internal !== true) {
        setError("API key is required.");
        return;
      }
      saveProfile({
        id: draft.id,
        label: draft.label.trim() || getPreset(draft.provider)?.label || draft.provider,
        provider: draft.provider as AiProfile["provider"],
        model: draft.model.trim(),
        baseUrl: draft.baseUrl.trim() || null,
        apiKey: draft.apiKey.trim(),
      });
      setDraft(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function activate(id: string) {
    setActiveProfile(id);
    refresh();
  }

  function remove(id: string) {
    deleteProfile(id);
    refresh();
  }

  if (!mounted) {
    return (
      <Panel className="p-5">
        <SectionHeader eyebrow="INTELLIGENCE LAYER" title="Bring your own AI key" />
        <MonoLabel>LOADING…</MonoLabel>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <SectionHeader
        eyebrow="INTELLIGENCE LAYER"
        title="Bring your own AI key"
        action={
          <StatusBadge tone={profiles.length && activeId ? "green" : "amber"}>
            {profiles.length && activeId ? `${profiles.length} SAVED` : "NO KEY"}
          </StatusBadge>
        }
      />

      <p className="mb-4 text-sm leading-relaxed text-ink-soft">
        JobMatch uses your own API key for resume parsing, job analysis, search queries and match
        explanations. Keys are stored <strong className="text-ink">only in this browser</strong> —
        never on the server — and are sent per request. Any OpenAI-compatible endpoint works,
        including local models.
      </p>

      {/* Saved profiles */}
      {profiles.length ? (
        <div className="mb-4 flex flex-col gap-2">
          {profiles.map((p) => {
            const meta = getPreset(p.provider);
            const active = p.id === activeId;
            return (
              <div
                key={p.id}
                className={`flex flex-wrap items-center gap-2 rounded-control border px-3 py-2.5 ${
                  active ? "border-term bg-term-wash" : "border-line bg-sunken"
                }`}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: active ? "var(--term)" : "var(--dot-off)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium text-ink">{p.label}</span>
                    <span className="font-mono-face text-xs break-anywhere text-ink-soft">
                      {p.provider}/{p.model}
                    </span>
                    {active ? <StatusBadge tone="green">ACTIVE</StatusBadge> : null}
                  </div>
                  <div className="mono-label mt-0.5">
                    KEY ••••{p.apiKey.slice(-4)} {meta ? `· ${meta.label}` : ""}
                    {p.baseUrl ? ` · ${p.baseUrl}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!active ? (
                    <RetroButton size="sm" onClick={() => activate(p.id)}>
                      ACTIVATE
                    </RetroButton>
                  ) : null}
                  <RetroButton size="sm" onClick={() => startEdit(p)}>
                    EDIT
                  </RetroButton>
                  <RetroButton size="sm" variant="danger" onClick={() => remove(p.id)}>
                    DELETE
                  </RetroButton>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mb-4 rounded-control border border-dashed border-line-strong bg-sunken px-4 py-6 text-center">
          <p className="text-sm text-ink-soft">
            No AI key yet — matching, resume parsing and explanations are paused until you add one.
          </p>
        </div>
      )}

      {!draft ? (
        <RetroButton variant="primary" onClick={startAdd}>
          + ADD API KEY
        </RetroButton>
      ) : (
        <div className="rounded-card border border-line-strong bg-sunken p-4">
          <div className="mono-label mb-3">{draft.id ? "EDIT PROFILE" : "NEW PROFILE"}</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <MonoLabel>PROVIDER</MonoLabel>
              <select
                value={draft.provider}
                onChange={(e) => onProviderChange(e.target.value)}
                className="h-10 rounded-control border border-line-strong bg-panel px-3 text-sm outline-none focus:border-term"
              >
                {UI_PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <MonoLabel>LABEL (OPTIONAL)</MonoLabel>
              <input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={preset?.label ?? "My key"}
                className="h-10 rounded-control border border-line-strong bg-panel px-3 text-sm outline-none focus:border-term"
              />
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <MonoLabel>MODEL ID</MonoLabel>
              <input
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder={preset?.placeholderModel ?? "model-id"}
                className="h-10 rounded-control border border-line-strong bg-panel px-3 font-mono-face text-sm outline-none focus:border-term"
              />
            </label>

            {needsBaseUrl || optionalBaseUrl ? (
              <label className="flex flex-col gap-1 sm:col-span-2">
                <MonoLabel>{needsBaseUrl ? "BASE URL (REQUIRED)" : "BASE URL (OPTIONAL OVERRIDE)"}</MonoLabel>
                <input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder={preset?.baseUrl ?? "https://your-endpoint.example.com/v1"}
                  className="h-10 rounded-control border border-line-strong bg-panel px-3 font-mono-face text-sm outline-none focus:border-term"
                />
                <span className="text-xs text-ink-soft">
                  Must be https:// unless it points at localhost/127.0.0.1.
                </span>
              </label>
            ) : null}

            <label className="flex flex-col gap-1 sm:col-span-2">
              <MonoLabel>API KEY</MonoLabel>
              <div className="flex gap-2">
                <input
                  type={showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  autoComplete="off"
                  placeholder="sk-…"
                  className="h-10 w-full rounded-control border border-line-strong bg-panel px-3 font-mono-face text-sm outline-none focus:border-term"
                />
                <RetroButton type="button" size="sm" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? "HIDE" : "SHOW"}
                </RetroButton>
              </div>
              {preset?.docsUrl ? (
                <a
                  href={preset.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mono-label hover:text-term-deep"
                >
                  GET A {preset.label.toUpperCase()} KEY ↗
                </a>
              ) : null}
            </label>
          </div>

          {error ? (
            <div className="mt-3">
              <ErrorBanner title="CANNOT SAVE">{error}</ErrorBanner>
            </div>
          ) : null}

          {test.status === "ok" ? (
            <p className="mt-3 text-sm" style={{ color: "var(--term-deep)" }}>
              ✓ Connection OK · {test.latencyMs}ms
            </p>
          ) : null}
          {test.status === "error" ? (
            <div className="mt-3">
              <ErrorBanner title="CONNECTION FAILED">{test.message}</ErrorBanner>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <RetroButton variant="primary" onClick={save} disabled={busy}>
              {busy ? "SAVING..." : draft.id ? "SAVE CHANGES" : "SAVE KEY"}
            </RetroButton>
            <RetroButton onClick={runTest} disabled={test.status === "testing" || busy}>
              {test.status === "testing" ? "TESTING..." : "TEST CONNECTION"}
            </RetroButton>
            <RetroButton
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              CANCEL
            </RetroButton>
          </div>
        </div>
      )}

      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-soft">
        Security: keys stay in this browser&apos;s localStorage and are used server-side only for
        the duration of each request. Clearing site data removes them. When the active key is an{" "}
        <strong className="text-ink">OpenRouter</strong> key, the JEV decision engine scores your
        matches; other providers use the built-in deterministic engine. The scheduled nightly
        search fetches new postings without a key; matching happens on your next visit.
      </p>

      <div className="mt-3">
        <Link href="/dashboard" className="mono-label hover:text-term-deep">
          BACK TO DASHBOARD →
        </Link>
      </div>
    </Panel>
  );
}
