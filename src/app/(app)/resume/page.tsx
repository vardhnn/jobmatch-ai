"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, SectionHeader } from "@/components/ui/panel";
import { RetroButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorBanner, EmptyState } from "@/components/ui/states";
import { RetroProgress } from "@/components/ui/progress";
import { getActiveProfile, aiFetch, type AiProfile } from "@/lib/client/ai-keys";

type ResumeStatus = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  parseError: string | null;
  createdAt: string;
};

type ProfileCounts = {
  skills: number;
  experiences: number;
  education: number;
  projects: number;
} | null;

const CHECK_STEPS = [
  "Extracting text",
  "Detecting skills",
  "Understanding experience",
  "Building candidate profile",
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ResumePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [resume, setResume] = useState<ResumeStatus | null>(null);
  const [counts, setCounts] = useState<ProfileCounts>(null);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseStep, setParseStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [justUploaded, setJustUploaded] = useState(false);
  const [profile, setProfile] = useState<AiProfile | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/resume/parse");
      if (res.ok) {
        const data = await res.json();
        setResume(data.resume ?? null);
        setCounts(data.profileCounts ?? null);
      }
    } catch {
      // non-fatal; page still usable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setProfile(getActiveProfile());
        const res = await fetch("/api/resume/parse");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setResume(data.resume ?? null);
          setCounts(data.profileCounts ?? null);
        }
      } catch {
        // non-fatal; page still usable
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Checklist animation while parsing (server does the real work).
  useEffect(() => {
    if (!parsing) return;
    const timer = setInterval(() => {
      setParseStep((s) => (s < CHECK_STEPS.length - 1 ? s + 1 : s));
    }, 1400);
    return () => clearInterval(timer);
  }, [parsing]);

  async function uploadFile(file: File) {
    setError(null);
    setUploading(true);
    setUploadProgress(0);
    setJustUploaded(false);

    // Fake progress ticks (fetch has no upload progress in-browser).
    const tick = setInterval(() => setUploadProgress((p) => Math.min(90, p + 12)), 180);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Upload failed. Please try again.");
        return;
      }
      setUploadProgress(100);
      setJustUploaded(true);
      await loadStatus();
      // Auto-parse right after a successful upload.
      await runParse();
    } catch {
      setError("Network failure — could not upload the file.");
    } finally {
      clearInterval(tick);
      setUploading(false);
    }
  }

  async function runParse() {
    setError(null);
    setParseStep(0);
    setParsing(true);
    try {
      const res = await aiFetch("/api/resume/parse", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          data?.error === "AI_NOT_CONFIGURED"
            ? data?.message ?? "Add your AI key in Settings → Intelligence Layer to parse resumes."
            : data?.message ?? "AI parsing failed. You can retry or edit your profile manually.",
        );
        return;
      }
      router.refresh();
      await loadStatus();
    } catch {
      setError("Network failure during AI parsing.");
    } finally {
      setParsing(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  const isParsed = resume?.status === "PARSED" && counts !== null;

  return (
    <div className="fade-up flex flex-col gap-6">
      <PageHeader
        title="Resume"
        actions={
          resume ? (
            <StatusBadge
              tone={resume.status === "PARSED" ? "green" : resume.status === "FAILED" ? "red" : "amber"}
              pulse={resume.status === "PARSING" || resume.status === "EXTRACTING" || uploading || parsing}
            >
              {parsing
                ? "AI PARSING"
                : resume.status === "EXTRACTED"
                  ? "TEXT EXTRACTED · NOT PARSED"
                  : resume.status}
            </StatusBadge>
          ) : null
        }
      />

      {error ? <ErrorBanner title="RESUME PROBLEM">{error}</ErrorBanner> : null}

      {/* Current resume status */}
      {resume && !loading ? (
        <Panel className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono-face text-lg" style={{ color: "var(--term)" }}>
              ▤
            </span>
            <div>
              <div className="text-sm font-medium text-ink">{resume.fileName}</div>
              <div className="mono-label">
                {formatBytes(resume.sizeBytes)} · UPLOADED{" "}
                {new Date(resume.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isParsed && counts ? (
              <span className="mono-label mr-2 hidden sm:inline">
                {counts.skills} SKILLS · {counts.experiences} ROLES · {counts.education} EDU ·{" "}
                {counts.projects} PROJECTS
              </span>
            ) : null}
            <Link href="/profile">
              <RetroButton size="sm" variant="primary">
                VIEW PROFILE →
              </RetroButton>
            </Link>
          </div>
        </Panel>
      ) : null}

      {/* Upload area */}
      <section>
        <SectionHeader
          eyebrow="STEP 1"
          title={resume ? "Replace resume" : "Upload your resume"}
          action={<span className="mono-label">PDF / DOCX · MAX 10MB</span>}
        />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragging ? "border-term bg-term-wash" : "border-line-strong bg-panel hover:bg-sunken"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
          <span className="font-mono-face text-2xl" style={{ color: "var(--term)" }}>
            ⇪
          </span>
          <div className="text-sm font-medium text-ink">
            {uploading ? "UPLOADING..." : "Drag & drop your resume here"}
          </div>
          <div className="mono-label">or click to browse · PDF / DOCX</div>
          {uploading ? (
            <div className="mt-3 w-full max-w-xs">
              <RetroProgress value={uploadProgress} />
            </div>
          ) : null}
        </div>
      </section>

      {/* Analysis terminal */}
      {parsing ? (
        <Panel className="scanlines px-5 py-4">
          <div className="mono-label mb-3" style={{ color: "var(--term)" }}>
            ANALYZING RESUME...
          </div>
          <div className="flex flex-col gap-2">
            {CHECK_STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-2 font-mono-face text-xs">
                <span style={{ color: i <= parseStep ? "var(--term)" : "var(--dot-off)" }}>
                  {i < parseStep ? "[✓]" : i === parseStep ? "[●]" : "[ ]"}
                </span>
                <span className={i <= parseStep ? "text-ink" : "text-ink-soft"}>{step}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {/* Parsed summary → next step */}
      {isParsed && counts && !parsing ? (
        <Panel sunken className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm text-ink-soft">
            Profile built{justUploaded ? " from your resume" : ""} — review and edit it anytime.
          </div>
          <Link href="/profile">
            <RetroButton size="sm">REVIEW PROFILE →</RetroButton>
          </Link>
        </Panel>
      ) : null}

      {/* Empty state when nothing uploaded */}          {!resume && !loading ? (
        <EmptyState
          code="NO RESUME"
          title="No resume uploaded yet"
          body="Drop a PDF or DOCX above. JobMatch AI extracts your skills, experience, education and projects into an editable profile — nothing is sent to your target job boards."
        />
      ) : null}

      {!profile && !loading ? (
        <Panel sunken className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm text-ink-soft">
            No AI key configured — uploads work, but AI parsing needs a key.
          </span>
          <Link href="/settings">
            <RetroButton size="sm" variant="primary">
              CONFIGURE AI →
            </RetroButton>
          </Link>
        </Panel>
      ) : null}

      {/* Parse failure recovery */}
      {resume?.status === "FAILED" ? (
        <Panel className="px-4 py-3">
          <div className="mb-2 text-sm font-medium text-ink">Last parse failed</div>
          {resume.parseError ? (
            <p className="mb-3 text-xs leading-relaxed text-ink-soft">{resume.parseError}</p>
          ) : null}
          <div className="flex gap-2">
            <RetroButton size="sm" variant="primary" onClick={runParse} disabled={parsing}>
              RETRY AI PARSE
            </RetroButton>
            <Link href="/profile">
              <RetroButton size="sm">EDIT PROFILE MANUALLY</RetroButton>
            </Link>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
