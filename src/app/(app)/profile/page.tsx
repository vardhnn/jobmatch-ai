"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel, SectionHeader, MonoLabel } from "@/components/ui/panel";
import { RetroButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorBanner, EmptyState } from "@/components/ui/states";

type Experience = {
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
  technologies: string;
};
type Education = {
  institution: string;
  degree: string;
  field: string;
  startYear: string;
  graduationYear: string;
};
type Project = { name: string; description: string; technologies: string; url: string };
type Skill = { name: string; category: string };

type ProfileState = {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  portfolio: string;
  summary: string;
  experiences: Experience[];
  education: Education[];
  projects: Project[];
  skills: Skill[];
};

const EMPTY: ProfileState = {
  name: "", email: "", phone: "", linkedin: "", github: "", portfolio: "", summary: "",
  experiences: [], education: [], projects: [], skills: [],
};

const CATEGORIES = ["Programming", "Frameworks", "Libraries", "Databases", "Cloud", "DevOps", "AI_ML", "Tools", "Other"];

const inputCls =
  "w-full rounded-control border border-line-strong bg-sunken px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-term";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono-label">{label}</span>
      {children}
    </label>
  );
}

function ItemCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono-face text-xs font-semibold tracking-wide text-term-deep">{title}</span>
        <button
          onClick={onRemove}
          className="mono-label rounded-control border border-line px-2 py-0.5 hover:border-danger hover:text-danger"
        >
          REMOVE
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export default function ProfilePage() {
  const [state, setState] = useState<ProfileState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSkill, setNewSkill] = useState("");
  const [newSkillCat, setNewSkillCat] = useState("Programming");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile");
        if (res.ok) {
          const data = await res.json();
          if (data.profile) {
            setState({
              name: data.profile.name ?? "",
              email: data.profile.email ?? "",
              phone: data.profile.phone ?? "",
              linkedin: data.profile.linkedin ?? "",
              github: data.profile.github ?? "",
              portfolio: data.profile.portfolio ?? "",
              summary: data.profile.summary ?? "",
              experiences: (data.profile.experiences ?? []).map((e: Record<string, unknown>) => ({
                company: e.company ?? "", role: e.role ?? "", startDate: e.startDate ?? "",
                endDate: e.endDate ?? "", description: e.description ?? "", technologies: e.technologies ?? "",
              })),
              education: (data.profile.education ?? []).map((e: Record<string, unknown>) => ({
                institution: e.institution ?? "", degree: e.degree ?? "", field: e.field ?? "",
                startYear: e.startYear?.toString() ?? "", graduationYear: e.graduationYear?.toString() ?? "",
              })),
              projects: (data.profile.projects ?? []).map((p: Record<string, unknown>) => ({
                name: p.name ?? "", description: p.description ?? "", technologies: p.technologies ?? "", url: p.url ?? "",
              })),
              skills: (data.profile.skills ?? []).map((s: Record<string, unknown>) => ({
                name: s.name ?? "", category: s.category ?? "Other",
              })),
            });
          }
        }
      } catch {
        setError("Could not load your profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const skillsByCategory = useMemo(() => {
    const map = new Map<string, Skill[]>();
    for (const s of state.skills) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state.skills]);

  function set<K extends keyof ProfileState>(key: K, value: ProfileState[K]) {
    setState((s) => ({ ...s, [key]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...state,
          experiences: state.experiences.map((e) => ({
            ...e,
            startDate: e.startDate || null,
            endDate: e.endDate || null,
          })),
          education: state.education.map((e) => ({
            ...e,
            startYear: e.startYear ? Number(e.startYear) : null,
            graduationYear: e.graduationYear ? Number(e.graduationYear) : null,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? "Save failed. Please try again.");
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
    } catch {
      setError("Network failure — profile not saved.");
    } finally {
      setSaving(false);
    }
  }

  function addSkill() {
    const name = newSkill.trim();
    if (!name) return;
    if (state.skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setNewSkill("");
      return;
    }
    set("skills", [...state.skills, { name, category: newSkillCat }]);
    setNewSkill("");
  }

  if (loading) {
    return (
      <div className="fade-up">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Candidate Profile</h1>
        <Panel className="scanlines px-5 py-8">
          <div className="mono-label" style={{ color: "var(--term)" }}>
            LOADING PROFILE<span className="cursor-blink">_</span>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="fade-up flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Candidate Profile</h1>
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
            {saving ? "SAVING..." : "SAVE PROFILE"}
          </RetroButton>
        </div>
      </div>

      {error ? <ErrorBanner title="PROFILE ERROR">{error}</ErrorBanner> : null}

      {state.skills.length === 0 && state.experiences.length === 0 ? (
        <Panel sunken className="px-4 py-3 text-sm text-ink-soft">
          Profile looks empty — upload your{" "}
          <Link href="/resume" className="font-medium text-term-deep underline">
            resume
          </Link>{" "}
          to auto-fill it, or add entries below manually.
        </Panel>
      ) : null}

      {/* Basic information */}
      <section>
        <SectionHeader eyebrow="BASIC INFORMATION" title="Contact" />
        <Panel className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="NAME">
            <input className={inputCls} value={state.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="EMAIL">
            <input className={inputCls} type="email" value={state.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="PHONE">
            <input className={inputCls} value={state.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="LINKEDIN">
            <input className={inputCls} value={state.linkedin} onChange={(e) => set("linkedin", e.target.value)} placeholder="linkedin.com/in/..." />
          </Field>
          <Field label="GITHUB">
            <input className={inputCls} value={state.github} onChange={(e) => set("github", e.target.value)} placeholder="github.com/..." />
          </Field>
          <Field label="PORTFOLIO">
            <input className={inputCls} value={state.portfolio} onChange={(e) => set("portfolio", e.target.value)} placeholder="https://..." />
          </Field>
          <div className="sm:col-span-2">
            <Field label="SUMMARY">
              <textarea className={`${inputCls} min-h-20`} value={state.summary} onChange={(e) => set("summary", e.target.value)} />
            </Field>
          </div>
        </Panel>
      </section>

      {/* Skills */}
      <section>
        <SectionHeader
          eyebrow="SKILLS"
          title="Capabilities"
          action={<span className="mono-label">{state.skills.length} TOTAL</span>}
        />
        <Panel className="p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input
              className={`${inputCls} sm:flex-1`}
              placeholder="Add a skill (e.g. FastAPI)"
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
              }}
            />
            <select className={inputCls} value={newSkillCat} onChange={(e) => setNewSkillCat(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", "/")}
                </option>
              ))}
            </select>
            <RetroButton variant="primary" onClick={addSkill}>
              + ADD SKILL
            </RetroButton>
          </div>

          {skillsByCategory.length === 0 ? (
            <p className="text-sm text-ink-soft">No skills yet — add them above or parse a resume.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {skillsByCategory.map(([cat, skills]) => (
                <div key={cat}>
                  <MonoLabel className="mb-1.5 block">{cat.replace("_", "/")}</MonoLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map((s) => (
                      <span
                        key={s.name}
                        className="inline-flex items-center gap-1.5 rounded-control border border-line bg-sunken px-2.5 py-1 text-xs text-ink"
                      >
                        {s.name}
                        <button
                          onClick={() => set("skills", state.skills.filter((x) => x !== s))}
                          className="text-ink-soft hover:text-danger"
                          aria-label={`Remove ${s.name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      {/* Experience */}
      <section>
        <SectionHeader
          eyebrow="EXPERIENCE"
          title="Work history"
          action={
            <RetroButton
              size="sm"
              onClick={() =>
                set("experiences", [
                  ...state.experiences,
                  { company: "", role: "", startDate: "", endDate: "", description: "", technologies: "" },
                ])
              }
            >
              + ADD ROLE
            </RetroButton>
          }
        />
        {state.experiences.length === 0 ? (
          <EmptyState code="NO ENTRIES" title="No work experience added" body="Add roles manually or parse your resume." />
        ) : (
          <div className="flex flex-col gap-3">
            {state.experiences.map((exp, i) => (
              <ItemCard
                key={i}
                title={`ROLE ${String(i + 1).padStart(2, "0")}`}
                onRemove={() => set("experiences", state.experiences.filter((_, x) => x !== i))}
              >
                <Field label="COMPANY">
                  <input className={inputCls} value={exp.company} onChange={(e) => {
                    const next = [...state.experiences];
                    next[i] = { ...exp, company: e.target.value };
                    set("experiences", next);
                  }} />
                </Field>
                <Field label="ROLE">
                  <input className={inputCls} value={exp.role} onChange={(e) => {
                    const next = [...state.experiences];
                    next[i] = { ...exp, role: e.target.value };
                    set("experiences", next);
                  }} />
                </Field>
                <Field label="START (YYYY-MM)">
                  <input className={inputCls} value={exp.startDate} placeholder="2023-06" onChange={(e) => {
                    const next = [...state.experiences];
                    next[i] = { ...exp, startDate: e.target.value };
                    set("experiences", next);
                  }} />
                </Field>
                <Field label="END (BLANK = PRESENT)">
                  <input className={inputCls} value={exp.endDate} placeholder="present" onChange={(e) => {
                    const next = [...state.experiences];
                    next[i] = { ...exp, endDate: e.target.value };
                    set("experiences", next);
                  }} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="DESCRIPTION">
                    <textarea className={`${inputCls} min-h-16`} value={exp.description} onChange={(e) => {
                      const next = [...state.experiences];
                      next[i] = { ...exp, description: e.target.value };
                      set("experiences", next);
                    }} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="TECHNOLOGIES (COMMA SEPARATED)">
                    <input className={inputCls} value={exp.technologies} onChange={(e) => {
                      const next = [...state.experiences];
                      next[i] = { ...exp, technologies: e.target.value };
                      set("experiences", next);
                    }} />
                  </Field>
                </div>
              </ItemCard>
            ))}
          </div>
        )}
      </section>

      {/* Education */}
      <section>
        <SectionHeader
          eyebrow="EDUCATION"
          title="Academic background"
          action={
            <RetroButton
              size="sm"
              onClick={() =>
                set("education", [
                  ...state.education,
                  { institution: "", degree: "", field: "", startYear: "", graduationYear: "" },
                ])
              }
            >
              + ADD EDUCATION
            </RetroButton>
          }
        />
        {state.education.length === 0 ? (
          <EmptyState code="NO ENTRIES" title="No education added" body="Add institutions manually or parse your resume." />
        ) : (
          <div className="flex flex-col gap-3">
            {state.education.map((edu, i) => (
              <ItemCard
                key={i}
                title={`EDUCATION ${String(i + 1).padStart(2, "0")}`}
                onRemove={() => set("education", state.education.filter((_, x) => x !== i))}
              >
                <Field label="INSTITUTION">
                  <input className={inputCls} value={edu.institution} onChange={(e) => {
                    const next = [...state.education];
                    next[i] = { ...edu, institution: e.target.value };
                    set("education", next);
                  }} />
                </Field>
                <Field label="DEGREE">
                  <input className={inputCls} value={edu.degree} onChange={(e) => {
                    const next = [...state.education];
                    next[i] = { ...edu, degree: e.target.value };
                    set("education", next);
                  }} />
                </Field>
                <Field label="FIELD">
                  <input className={inputCls} value={edu.field} onChange={(e) => {
                    const next = [...state.education];
                    next[i] = { ...edu, field: e.target.value };
                    set("education", next);
                  }} />
                </Field>
                <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                  <Field label="START YEAR">
                    <input className={inputCls} value={edu.startYear} onChange={(e) => {
                      const next = [...state.education];
                      next[i] = { ...edu, startYear: e.target.value };
                      set("education", next);
                    }} />
                  </Field>
                  <Field label="GRADUATION YEAR">
                    <input className={inputCls} value={edu.graduationYear} onChange={(e) => {
                      const next = [...state.education];
                      next[i] = { ...edu, graduationYear: e.target.value };
                      set("education", next);
                    }} />
                  </Field>
                </div>
              </ItemCard>
            ))}
          </div>
        )}
      </section>

      {/* Projects */}
      <section>
        <SectionHeader
          eyebrow="PROJECTS"
          title="Projects"
          action={
            <RetroButton
              size="sm"
              onClick={() =>
                set("projects", [...state.projects, { name: "", description: "", technologies: "", url: "" }])
              }
            >
              + ADD PROJECT
            </RetroButton>
          }
        />
        {state.projects.length === 0 ? (
          <EmptyState code="NO ENTRIES" title="No projects added" body="Add projects manually or parse your resume." />
        ) : (
          <div className="flex flex-col gap-3">
            {state.projects.map((p, i) => (
              <ItemCard
                key={i}
                title={`PROJECT ${String(i + 1).padStart(2, "0")}`}
                onRemove={() => set("projects", state.projects.filter((_, x) => x !== i))}
              >
                <Field label="NAME">
                  <input className={inputCls} value={p.name} onChange={(e) => {
                    const next = [...state.projects];
                    next[i] = { ...p, name: e.target.value };
                    set("projects", next);
                  }} />
                </Field>
                <Field label="URL">
                  <input className={inputCls} value={p.url} onChange={(e) => {
                    const next = [...state.projects];
                    next[i] = { ...p, url: e.target.value };
                    set("projects", next);
                  }} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="DESCRIPTION">
                    <textarea className={`${inputCls} min-h-16`} value={p.description} onChange={(e) => {
                      const next = [...state.projects];
                      next[i] = { ...p, description: e.target.value };
                      set("projects", next);
                    }} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="TECHNOLOGIES (COMMA SEPARATED)">
                    <input className={inputCls} value={p.technologies} onChange={(e) => {
                      const next = [...state.projects];
                      next[i] = { ...p, technologies: e.target.value };
                      set("projects", next);
                    }} />
                  </Field>
                </div>
              </ItemCard>
            ))}
          </div>
        )}
      </section>

      {/* Sticky save bar (mobile-friendly) */}
      <div className="sticky bottom-4 z-20">
        <Panel className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="mono-label">
            {state.skills.length} SKILLS · {state.experiences.length} ROLES · {state.education.length} EDU ·{" "}
            {state.projects.length} PROJECTS
          </span>
          <RetroButton variant="primary" onClick={save} disabled={saving}>
            {saving ? "SAVING..." : "SAVE PROFILE"}
          </RetroButton>
        </Panel>
      </div>
    </div>
  );
}
