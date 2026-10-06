"use server-only";

import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { matchJobForUser } from "./job-matching-service";

/**
 * End-to-end pipeline verification (spec requirement #10):
 * Resume → AI Profile → Job Analysis → JEV Matching → Explanation → Dashboard.
 *
 * Creates an isolated test user, seeds a representative resume text, and walks
 * the real services through every stage, asserting caching and degraded
 * fallback behavior. Safe to run repeatedly (test user is recreated).
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const SAMPLE_RESUME = `VISHNU VARDHAN
vishnu.vardhan@example.com | +91 98765 43210
linkedin.com/in/vishnu-vardhan | github.com/vishnuvardhan

SKILLS
Python, FastAPI, PostgreSQL, REST APIs, Git, Docker, React, TypeScript

EXPERIENCE
Software Engineer · Acme Corp · Jun 2023 - Present
Built REST APIs with FastAPI and PostgreSQL serving 2M requests/day.

Junior Developer · Beta Systems · Jul 2021 - May 2023
Maintained Django services and MySQL schemas.

EDUCATION
B.Tech Computer Science, JNTU Hyderabad, 2017 - 2021

PROJECTS
JobBoard Aggregator — Scraped and normalized job listings. Python, FastAPI
`;

const SAMPLE_JOBS = [
  {
    dedupeKey: "test-job-python-backend",
    title: "Python Backend Developer",
    company: "Alpha Technologies",
    location: "Hyderabad, India",
    remoteType: "HYBRID",
    employmentType: "Full-time",
    description:
      "We are looking for a Python Backend Developer with 2+ years of experience. " +
      "Required skills: Python, FastAPI, PostgreSQL, Redis, REST APIs, Git. " +
      "Nice to have: AWS, Docker, Kubernetes. Hybrid work in Hyderabad. Full-time position. " +
      "Salary: $60,000 - $90,000 per year.",
    salaryOriginal: "$60,000 - $90,000",
    salaryMin: 60000,
    salaryMax: 90000,
    salaryCurrency: "USD",
  },
  {
    dedupeKey: "test-job-ml-engineer",
    title: "Senior ML Engineer",
    company: "Beta AI Labs",
    location: "Remote",
    remoteType: "REMOTE",
    employmentType: "Full-time",
    description:
      "Senior ML Engineer role. Required: 8+ years experience, PyTorch, TensorFlow, Kubernetes, MLOps. Doctorate preferred. Remote.",
    salaryOriginal: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
  },
];

export async function verifyFullFlow(): Promise<{
  ok: boolean;
  stages: Record<string, string>;
  errors: string[];
}> {
  const stages: Record<string, string> = {};
  const errors: string[] = [];
  const email = "flow-test@jobmatch.local";

  // Isolated test user
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "scrypt:test:test",
      profile: { create: {} },
      preferences: {
        create: {
          desiredRoles: JSON.stringify(["Python Developer", "Backend Developer"]),
          preferredLocations: JSON.stringify(["Hyderabad, India"]),
          workArrangement: "ANY",
          locationFlexibility: "WORLDWIDE",
          salaryMin: 50000,
          salaryMax: 100000,
          salaryCurrency: "USD",
          employmentTypes: JSON.stringify(["FULL_TIME"]),
          experienceLevels: JSON.stringify(["ENTRY", "JUNIOR"]),
          excludedCompanies: JSON.stringify(["Excluded Corp"]),
        },
      },
    },
  });
  const profile = await prisma.candidateProfile.findUnique({ where: { userId: user.id } });

  try {
    // ── Stage 1: Resume → AI Profile ────────────────────────────
    const ai = getAIProvider();
    const parsed = await ai.parseResume(SAMPLE_RESUME);
    if (!parsed.name || parsed.skills.length === 0) {
      errors.push("Resume parsing produced no name/skills");
    } else {
      stages["1_resume_parse"] = `ok (${parsed.skills.length} skills, provider=${(ai as { lastProviderName?: string }).lastProviderName ?? ai.name})`;
    }

    // Persist into the real profile shape
    await prisma.skill.deleteMany({ where: { profileId: profile!.id } });
    await prisma.skill.createMany({
      data: parsed.skills.slice(0, 40).map((s, i) => ({
        profileId: profile!.id,
        name: s,
        category: "Other",
        sortOrder: i,
      })),
    });
    stages["1b_profile_persist"] = "ok";

    // ── Stage 2: Job Analysis (cached) ──────────────────────────
    for (const j of SAMPLE_JOBS) {
      await prisma.job.upsert({ where: { dedupeKey: j.dedupeKey }, update: {}, create: j });
    }
    const jobs = await prisma.job.findMany({ where: { dedupeKey: { in: SAMPLE_JOBS.map((j) => j.dedupeKey) } } });

    const { analyzeJobCached } = await import("./job-matching-service");
    const first = await analyzeJobCached(jobs[0].id);
    const second = await analyzeJobCached(jobs[0].id);
    if (!first || !second) {
      errors.push("Job analysis returned null");
    } else {
      stages["2_job_analysis"] = `ok (first=${first.cached ? "cached" : "computed"}, second=${second.cached ? "cached" : "computed"})`;
      if (!second.cached) errors.push("Analysis cache miss on second call");
    }

    // ── Stage 3: JEV Matching ───────────────────────────────────
    const m1 = await matchJobForUser(user.id, jobs[0].id);
    const m2 = await matchJobForUser(user.id, jobs[0].id);
    if (!m1 || !m2) {
      errors.push("Matching returned null");
    } else {
      stages["3_jev_matching"] = `ok (job1=${m1.overall}% ${m1.category} via ${m1.provider}, cached=${m2.fromCache})`;
      if (!m2.fromCache) errors.push("Match cache miss on second call");
      // The fixture requires Redis, which the sample resume does not list, so a
      // non-empty gap is a real signal rather than an artifact of how the model
      // chose to split required vs. nice-to-have skills.
      if (m1.missingSkills.length === 0) errors.push("Expected missing skills (Redis) for job1");
    }

    // ── Stage 4: Explanation (cached with match) ────────────────
    // Explanations are written only for jobs the engine would actually
    // surface (SHOW and not LOW), so a hidden fixture here is expected.
    if (m1 && m1.explanation.length > 0) {
      stages["4_explanation"] = `ok (${m1.explanation.length} chars, cached=${m2?.fromCache ?? false})`;
    } else if (m1 && (m1.decision === "HIDE" || m1.category === "LOW")) {
      stages["4_explanation"] = `skipped (${m1.decision}/${m1.category} — no explanation is generated)`;
    } else {
      errors.push("Shown job has no explanation");
    }

    // ── Stage 5: Hard exclusion forces HIDE ─────────────────────
    await prisma.job.upsert({
      where: { dedupeKey: "test-job-excluded" },
      update: {},
      create: {
        dedupeKey: "test-job-excluded",
        title: "Python Developer",
        company: "Excluded Corp",
        location: "Hyderabad, India",
        remoteType: "ONSITE",
        description: "Python, FastAPI, PostgreSQL required.",
      },
    });
    const excludedJob = await prisma.job.findUnique({ where: { dedupeKey: "test-job-excluded" } });
    const mExcl = excludedJob ? await matchJobForUser(user.id, excludedJob.id) : null;
    if (mExcl && mExcl.decision !== "HIDE") {
      errors.push(`Excluded company was not HIDE (got ${mExcl.decision})`);
    } else {
      stages["5_exclusion_hide"] = "ok";
    }

    // ── Stage 6: Missing salary/location don't crash ────────────
    const mNoSalary = await matchJobForUser(user.id, jobs[1].id);
    if (!mNoSalary) {
      errors.push("Missing-salary job crashed matching");
    } else {
      stages["6_missing_data"] = `ok (job2=${mNoSalary.overall}%, salaryScore=${mNoSalary.subScores.salary})`;
    }

    // ── Stage 7: Dashboard aggregates ───────────────────────────
    const [strong, potential, low] = await Promise.all([
      prisma.jobMatch.count({ where: { userId: user.id, category: "STRONG" } }),
      prisma.jobMatch.count({ where: { userId: user.id, category: "POTENTIAL" } }),
      prisma.jobMatch.count({ where: { userId: user.id, category: "LOW" } }),
    ]);
    const total = strong + potential + low;
    if (total < 3) errors.push(`Expected >= 3 matches on dashboard, got ${total}`);
    else stages["7_dashboard"] = `ok (strong=${strong}, potential=${potential}, low=${low})`;

    // ── Stage 8: Match invalidation when preferences change ─────
    await prisma.jobPreferences.updateMany({
      where: { userId: user.id },
      data: { salaryMax: 60000 },
    });
    const m3 = await matchJobForUser(user.id, jobs[0].id);
    if (m3 && m3.fromCache) errors.push("Preferences changed but match still served from cache");
    else stages["8_invalidation"] = "ok (prefs change → recompute)";
  } catch (err) {
    errors.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.job.deleteMany({ where: { dedupeKey: { startsWith: "test-job-" } } });
  }

  return { ok: errors.length === 0, stages, errors };
}

// Keep hash helper referenced (used by future cache extensions).
void sha256;
