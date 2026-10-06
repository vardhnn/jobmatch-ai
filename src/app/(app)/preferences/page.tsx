"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel, SectionHeader, MonoLabel } from "@/components/ui/panel";
import { RetroButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/states";
import {
  sanitizePreferences,
  FRESHNESS_OPTIONS,
  MAX_COMPANIES,
  MAX_LOCATIONS,
  MAX_ROLES,
  SALARY_CURRENCIES,
  SALARY_PERIODS,
  type PreferencesIssue,
  type PreferencesState,
} from "@/lib/preferences-schema";

/** Salary + commute are edited as text (blank = unset) and normalized on save. */
type FormState = Omit<PreferencesState, "salaryMin" | "salaryMax" | "maxCommuteMinutes"> & {
  salaryMin: string;
  salaryMax: string;
  maxCommuteMinutes: string;
};

const EMPTY: FormState = {
  desiredRoles: [],
  workArrangement: "ANY",
  preferredLocations: [],
  locationFlexibility: "SELECTED_ONLY",
  willingToRelocate: false,
  maxCommuteMinutes: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "USD",
  salaryPeriod: "ANNUAL",
  includeJobsWithoutSalary: true,
  employmentTypes: ["FULL_TIME"],
  experienceLevels: ["MID"],
  preferredCompanies: [],
  excludedCompanies: [],
  postedWithinDays: 14,
  includeRelatedTitles: true,
  removeDuplicates: true,
  preferDirectApply: true,
  includeJobsWithoutSalarySearch: true,
};

const WORK_ARRANGEMENT_OPTIONS = [
  { value: "REMOTE", label: "REMOTE", hint: "Work from anywhere" },
  { value: "HYBRID", label: "HYBRID", hint: "Split office / home" },
  { value: "ONSITE", label: "ONSITE", hint: "On location" },
  { value: "ANY", label: "ANY", hint: "No preference" },
] as const;

const LOCATION_FLEXIBILITY_OPTIONS = [
  { value: "SELECTED_ONLY", label: "LISTED ONLY", hint: "Only the locations below" },
  { value: "COUNTRY", label: "ANYWHERE IN COUNTRY", hint: "Widen within your country" },
  { value: "WORLDWIDE", label: "WORLDWIDE", hint: "Any country — e.g. remote" },
] as const;

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: "FULL TIME",
  PART_TIME: "PART TIME",
  INTERNSHIP: "INTERNSHIP",
  CONTRACT: "CONTRACT",
  TEMPORARY: "TEMPORARY",
};

const EXPERIENCE_LABELS: Record<string, string> = {
  ENTRY: "ENTRY / FRESHER",
  JUNIOR: "JUNIOR (0–2 YRS)",
  MID: "MID (2–5 YRS)",
  SENIOR: "SENIOR (5+ YRS)",
  LEAD: "LEAD / STAFF",
  PRINCIPAL: "PRINCIPAL / DIRECTOR",
};

const ROLE_SUGGESTIONS = [
  "Full Stack Developer",
  "Backend Engineer",
  "Frontend Engineer",
  "Machine Learning Engineer",
  "Data Scientist",
  "Data Analyst",
  "DevOps Engineer",
  "Cloud Engineer",
  "Software Engineer",
  "Mobile App Developer",
  "QA Engineer",
  "Product Manager",
];

const inputCls =
  "w-full rounded-control border border-line-strong bg-sunken px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-term";

const chipCls =
  "inline-flex items-center gap-1.5 rounded-control border border-line bg-sunken px-2.5 py-1 text-xs text-ink";

function toForm(data: PreferencesState & {
  salaryMin: number | null;
  salaryMax: number | null;
  maxCommuteMinutes: number | null;
}): FormState {
  return {
    ...data,
    salaryMin: data.salaryMin === null ? "" : String(data.salaryMin),
    salaryMax: data.salaryMax === null ? "" : String(data.salaryMax),
    maxCommuteMinutes: data.maxCommuteMinutes === null ? "" : String(data.maxCommuteMinutes),
  };
}

/** Enter-to-add multi value input with removable chips. */
function TagInput({
  values,
  onChange,
  placeholder,
  suggestions = [],
  max,
  tone = "term",
  disabled,
}: {
  values: string[];
  /** Updater form: never stale, so rapid clicks can’t drop entries. */
  onChange: (updater: (prev: string[]) => string[]) => void;
  placeholder: string;
  suggestions?: readonly string[];
  max: number;
  tone?: "term" | "danger";
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const full = values.length >= max;

  function add(raw: string) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value || full) return;
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange((prev) => (prev.some((v) => v.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]));
    setDraft("");
  }

  function remove(target: string) {
    onChange((prev) => prev.filter((x) => x !== target));
  }

  const openSuggestions = useMemo(
    () =>
      suggestions
        .filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()))
        .slice(0, 8),
    [suggestions, values],
  );

  const chipColor =
    tone === "danger" ? "border-danger/40 bg-danger-wash text-danger" : "";
  const removeColor = tone === "danger" ? "hover:text-danger" : "text-ink-soft hover:text-danger";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={draft}
          disabled={disabled || full}
          placeholder={full ? `Limit of ${max} reached` : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
            if (e.key === "Backspace" && !draft && values.length) {
              onChange((prev) => prev.slice(0, -1));
            }
          }}
        />
        <RetroButton
          variant="secondary"
          disabled={disabled || full || !draft.trim()}
          onClick={() => add(draft)}
        >
          + ADD
        </RetroButton>
      </div>

      {openSuggestions.length && !full ? (
        <div className="flex flex-wrap gap-1.5">
          {openSuggestions.map((s) => (
            <button
              key={s}
              onClick={() => add(s)}
              disabled={disabled}
              className="mono-label rounded-control border border-dashed border-line-strong px-2 py-0.5 text-ink-soft hover:border-term hover:text-term-deep"
            >
              + {s}
            </button>
          ))}
        </div>
      ) : null}

      {values.length ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className={`${chipCls} ${chipColor}`}>
              {v}
              <button
                onClick={() => remove(v)}
                disabled={disabled}
                className={removeColor}
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <span className="mono-label text-muted">NONE YET</span>
      )}
    </div>
  );
}

/** Radio cards — used for work arrangement and location flexibility. */
function OptionCards<T extends string>({
  options,
  value,
  onChange,
  columns = 4,
}: {
  options: readonly { value: T; label: string; hint: string }[];
  value: T;
  onChange: (next: T) => void;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div
      className={`grid gap-2 ${
        columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4"
      }`}
      role="radiogroup"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-control border px-3 py-2.5 text-left transition-colors ${
              active
                ? "border-term bg-term-wash"
                : "border-line-strong bg-sunken hover:border-line-strong hover:bg-cream"
            }`}
          >
            <span
              className={`block font-mono-face text-[11px] font-semibold tracking-[0.08em] ${
                active ? "text-term-deep" : "text-ink"
              }`}
            >
              {active ? "● " : "○ "}
              {opt.label}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{opt.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select checkbox chips. */
function ChipGroup<T extends string>({
  options,
  values,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  values: readonly T[];
  onChange: (updater: (prev: T[]) => T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = values.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            role="checkbox"
            aria-checked={active}
            onClick={() =>
              onChange((prev) =>
                prev.includes(opt.value)
                  ? prev.filter((v) => v !== opt.value)
                  : [...prev, opt.value],
              )
            }
            className={`rounded-control border px-3 py-1.5 font-mono-face text-[11px] font-medium tracking-[0.06em] transition-colors ${
              active
                ? "border-term bg-term text-white"
                : "border-line-strong bg-sunken text-ink-soft hover:border-term hover:text-term-deep"
            }`}
          >
            {active ? "✓ " : ""}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Label + description + retro toggle switch. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-control border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-line-strong"
    >
      <span
        className="mt-0.5 flex h-5 w-9 flex-shrink-0 items-center rounded-full border px-0.5 transition-colors"
        style={{
          borderColor: checked ? "var(--term-deep)" : "var(--line-strong)",
          backgroundColor: checked ? "var(--term)" : "var(--panel-sunken)",
        }}
      >
        <span
          className="h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-mono-face text-[11px] font-semibold tracking-[0.06em] text-ink">
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{description}</span>
      </span>
    </button>
  );
}

function FieldIssue({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className="font-mono-face text-[10px] tracking-[0.06em]" style={{ color: "var(--danger)" }}>
      ▲ {message.toUpperCase()}
    </span>
  );
}

export default function PreferencesPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<PreferencesIssue[]>([]);

  const issueFor = (field: string) =>
    issues.find((i) => i.field === field)?.message ?? undefined;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/preferences");
        if (res.ok) {
          const data = await res.json();
          if (data.preferences) setForm(toForm(data.preferences));
        }
      } catch {
        setError("Could not load preferences — showing defaults.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setIssues((prev) => (prev.some((i) => i.field === key) ? prev.filter((i) => i.field !== key) : prev));
  }

  /** List fields are edited through updater functions to stay race-free. */
  function editList<K extends "desiredRoles" | "preferredLocations" | "preferredCompanies" | "excludedCompanies" | "employmentTypes" | "experienceLevels">(
    key: K,
    updater: (prev: string[]) => string[],
  ) {
    setForm((f) => ({ ...f, [key]: updater(f[key] as string[]) }));
    setDirty(true);
    setIssues((prev) => (prev.some((i) => i.field === key) ? prev.filter((i) => i.field !== key) : prev));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      salaryMin: form.salaryMin.trim() === "" ? null : form.salaryMin.trim(),
      salaryMax: form.salaryMax.trim() === "" ? null : form.salaryMax.trim(),
      maxCommuteMinutes:
        form.maxCommuteMinutes.trim() === "" ? null : form.maxCommuteMinutes.trim(),
    };

    // Pre-flight with the exact same validator the API uses.
    const check = sanitizePreferences(payload);
    if (!check.data) {
      setIssues(check.issues);
      setError("Fix the highlighted fields before saving.");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (Array.isArray(data?.issues)) setIssues(data.issues as PreferencesIssue[]);
        setError(data?.message ?? "Save failed. Please try again.");
        return;
      }
      setIssues([]);
      if (data?.preferences) setForm(toForm(data.preferences));
      setSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
    } catch {
      setError("Network failure — preferences not saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="fade-up">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Job Preferences</h1>
        <Panel className="scanlines px-5 py-8">
          <div className="mono-label" style={{ color: "var(--term)" }}>
            LOADING PREFERENCES<span className="cursor-blink">_</span>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="fade-up flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Job Preferences</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            These controls drive the daily search and every JEV match score. Change them any time —
            matches recompute automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && !dirty ? (
            <StatusBadge tone="green">SAVED {savedAt}</StatusBadge>
          ) : dirty ? (
            <StatusBadge tone="amber" pulse>
              UNSAVED CHANGES
            </StatusBadge>
          ) : null}
          <RetroButton variant="primary" onClick={save} disabled={saving}>
            {saving ? "SAVING..." : "SAVE PREFERENCES"}
          </RetroButton>
        </div>
      </div>

      {error ? <ErrorBanner title="PREFERENCES ERROR">{error}</ErrorBanner> : null}

      {/* ── Roles ─────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="01 · TARGET ROLES"
          title="What you want to do"
          action={
            <span className="mono-label">
              {form.desiredRoles.length}/{MAX_ROLES} ROLES
            </span>
          }
        />
        <Panel className="flex flex-col gap-3 p-5">
          <p className="text-sm text-ink-soft">
            The more roles you add, the wider the daily search. Related titles are searched for too
            (see <span className="font-mono-face text-[11px]">SEARCH BEHAVIOUR</span>).
          </p>
          <TagInput
            values={form.desiredRoles}
            onChange={(fn) => editList("desiredRoles", fn)}
            placeholder="Add a role — e.g. Backend Engineer"
            suggestions={ROLE_SUGGESTIONS}
            max={MAX_ROLES}
          />
          <FieldIssue message={issueFor("desiredRoles")} />
        </Panel>
      </section>

      {/* ── Work arrangement ──────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="02 · WORK ARRANGEMENT" title="Where you work" />
        <Panel className="flex flex-col gap-3 p-5">
          <OptionCards
            options={WORK_ARRANGEMENT_OPTIONS}
            value={form.workArrangement}
            onChange={(v) => set("workArrangement", v)}
          />
          <FieldIssue message={issueFor("workArrangement")} />
        </Panel>
      </section>

      {/* ── Locations ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="03 · LOCATIONS"
          title="Where you can work"
          action={
            <span className="mono-label">
              {form.preferredLocations.length}/{MAX_LOCATIONS} LOCATIONS
            </span>
          }
        />
        <Panel className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-2">
            <MonoLabel>LOCATION FLEXIBILITY</MonoLabel>
            <OptionCards
              options={LOCATION_FLEXIBILITY_OPTIONS}
              value={form.locationFlexibility}
              onChange={(v) => set("locationFlexibility", v)}
              columns={3}
            />
            <FieldIssue message={issueFor("locationFlexibility")} />
          </div>

          <div className="flex flex-col gap-2">
            <MonoLabel>PREFERRED LOCATIONS</MonoLabel>
            <TagInput
              values={form.preferredLocations}
              onChange={(fn) => editList("preferredLocations", fn)}
              placeholder="Add a city — e.g. Bengaluru"
              suggestions={["Bengaluru", "Hyderabad", "Pune", "Mumbai", "Delhi NCR", "Chennai", "Gurugram"]}
              max={MAX_LOCATIONS}
            />
            <FieldIssue message={issueFor("preferredLocations")} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleRow
              label="WILLING TO RELOCATE"
              description="Count other cities in your country as acceptable, not just the listed ones."
              checked={form.willingToRelocate}
              onChange={(v) => set("willingToRelocate", v)}
            />
            <label className="flex flex-col gap-1">
              <MonoLabel>MAX COMMUTE (MINUTES)</MonoLabel>
              <input
                className={inputCls}
                type="number"
                min={5}
                max={300}
                step={5}
                placeholder="e.g. 45"
                value={form.maxCommuteMinutes}
                onChange={(e) => set("maxCommuteMinutes", e.target.value)}
              />
              <FieldIssue message={issueFor("maxCommuteMinutes")} />
            </label>
          </div>
        </Panel>
      </section>

      {/* ── Compensation ──────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="04 · COMPENSATION" title="Salary expectations" />
        <Panel className="flex flex-col gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1">
              <MonoLabel>MINIMUM</MonoLabel>
              <input
                className={inputCls}
                type="number"
                min={0}
                placeholder="800000"
                value={form.salaryMin}
                onChange={(e) => set("salaryMin", e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <MonoLabel>MAXIMUM</MonoLabel>
              <input
                className={inputCls}
                type="number"
                min={0}
                placeholder="1200000"
                value={form.salaryMax}
                onChange={(e) => set("salaryMax", e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <MonoLabel>CURRENCY</MonoLabel>
              <select
                className={inputCls}
                value={form.salaryCurrency}
                onChange={(e) => set("salaryCurrency", e.target.value)}
              >
                {SALARY_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <MonoLabel>PERIOD</MonoLabel>
              <select
                className={inputCls}
                value={form.salaryPeriod}
                onChange={(e) => set("salaryPeriod", e.target.value)}
              >
                {SALARY_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <FieldIssue message={issueFor("salaryMin") ?? issueFor("salaryMax")} />
          <ToggleRow
            label="MATCH JOBS WITHOUT A STATED SALARY"
            description="Scoring stays neutral on the salary sub-score instead of counting undisclosed pay as a miss."
            checked={form.includeJobsWithoutSalary}
            onChange={(v) => set("includeJobsWithoutSalary", v)}
          />
        </Panel>
      </section>

      {/* ── Employment & experience ───────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="05 · EMPLOYMENT" title="Type & seniority" />
        <Panel className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-2">
            <MonoLabel>EMPLOYMENT TYPE</MonoLabel>
            <ChipGroup
              options={Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => ({ value, label }))}
              values={form.employmentTypes}
              onChange={(fn) => editList("employmentTypes", fn)}
            />
            <FieldIssue message={issueFor("employmentTypes")} />
          </div>

          <div className="flex flex-col gap-2">
            <MonoLabel>EXPERIENCE LEVEL</MonoLabel>
            <ChipGroup
              options={Object.entries(EXPERIENCE_LABELS).map(([value, label]) => ({ value, label }))}
              values={form.experienceLevels}
              onChange={(fn) => editList("experienceLevels", fn)}
            />
            <FieldIssue message={issueFor("experienceLevels")} />
          </div>
        </Panel>
      </section>

      {/* ── Companies ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="06 · COMPANIES"
          title="Preferred & excluded"
          action={
            <span className="mono-label">
              {form.preferredCompanies.length}+ / {form.excludedCompanies.length}− · MAX {MAX_COMPANIES}
            </span>
          }
        />
        <Panel className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-2">
            <MonoLabel>PREFERRED EMPLOYERS</MonoLabel>
            <TagInput
              values={form.preferredCompanies}
              onChange={(fn) => editList("preferredCompanies", fn)}
              placeholder="Add a company — e.g. Razorpay"
              max={MAX_COMPANIES}
            />
          </div>
          <div className="flex flex-col gap-2">
            <MonoLabel>EXCLUDED EMPLOYERS</MonoLabel>
            <TagInput
              values={form.excludedCompanies}
              onChange={(fn) => editList("excludedCompanies", fn)}
              placeholder="Never show jobs from…"
              max={MAX_COMPANIES}
              tone="danger"
            />
            <FieldIssue message={issueFor("excludedCompanies")} />
          </div>
        </Panel>
      </section>

      {/* ── Freshness & search behaviour ──────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="07 · FRESHNESS"
          title="Job age & search behaviour"
          action={<span className="mono-label">WINDOW · {form.postedWithinDays} DAYS</span>}
        />
        <Panel className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-2">
            <MonoLabel>POSTED WITHIN</MonoLabel>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {FRESHNESS_OPTIONS.map((opt) => {
                const active = form.postedWithinDays === opt.days;
                return (
                  <button
                    key={opt.days}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set("postedWithinDays", opt.days)}
                    className={`rounded-control border px-3 py-2 font-mono-face text-[11px] font-medium tracking-[0.06em] transition-colors ${
                      active
                        ? "border-term bg-term text-white"
                        : "border-line-strong bg-sunken text-ink-soft hover:border-term hover:text-term-deep"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <FieldIssue message={issueFor("postedWithinDays")} />
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            <ToggleRow
              label="INCLUDE RELATED TITLES"
              description="Also search neighbouring job titles (e.g. Software Engineer → Developer)."
              checked={form.includeRelatedTitles}
              onChange={(v) => set("includeRelatedTitles", v)}
            />
            <ToggleRow
              label="REMOVE DUPLICATES"
              description="Collapse the same posting across sources into a single job."
              checked={form.removeDuplicates}
              onChange={(v) => set("removeDuplicates", v)}
            />
            <ToggleRow
              label="PREFER DIRECT APPLY"
              description="Rank postings with an employer-hosted application link higher."
              checked={form.preferDirectApply}
              onChange={(v) => set("preferDirectApply", v)}
            />
            <ToggleRow
              label="KEEP UNDISCLOSED-PAY JOBS"
              description="Keep jobs in the result set even when no salary is listed."
              checked={form.includeJobsWithoutSalarySearch}
              onChange={(v) => set("includeJobsWithoutSalarySearch", v)}
            />
          </div>
        </Panel>
      </section>

      <Panel sunken className="px-4 py-3 text-sm text-ink-soft">
        Next: run a search from the{" "}
        <Link href="/sources" className="font-medium text-term-deep underline">
          sources
        </Link>{" "}
        page, or head to the{" "}
        <Link href="/dashboard" className="font-medium text-term-deep underline">
          dashboard
        </Link>{" "}
        to see how these preferences rank real postings.
      </Panel>

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-20">
        <Panel className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="mono-label">
            {form.desiredRoles.length} ROLES · {form.preferredLocations.length} LOCS ·{" "}
            {form.employmentTypes.length} TYPES · {form.experienceLevels.length} LEVELS
          </span>
          <div className="flex items-center gap-2">
            {dirty ? (
              <RetroButton
                onClick={() => {
                  setForm(EMPTY);
                  setIssues([]);
                  setError(null);
                  setSavedAt(null);
                  setDirty(true);
                }}
              >
                CLEAR ALL
              </RetroButton>
            ) : null}
            <RetroButton variant="primary" onClick={save} disabled={saving}>
              {saving ? "SAVING..." : "SAVE PREFERENCES"}
            </RetroButton>
          </div>
        </Panel>
      </div>
    </div>
  );
}
