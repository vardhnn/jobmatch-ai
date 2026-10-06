"use server-only";

import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { getDecisionProvider } from "@/lib/jev";
import { buildDecisionInputs } from "./profile-inputs";

/**
 * JobMatchingService — the cached match pipeline.
 *
 * Cost-control invariants (spec §45):
 *  - Job analysis: AI once per unique job content (contentHash), stored in JobAnalysis.
 *  - Match: decision computed once per user+job+inputHash, stored in JobMatch.
 *  - Explanation: generated once, cached on the match row.
 * Repeated page loads never re-call the model.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

type AnalyzeOutcome = { cached: boolean; analysisId: string };

/** Analyze a job once; reuse the cached analysis when content is unchanged. */
export async function analyzeJobCached(jobId: string): Promise<AnalyzeOutcome | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const contentHash = sha256(
    JSON.stringify([job.title, job.company, job.location, job.description ?? "", job.salaryOriginal]),
  );

  const existing = await prisma.jobAnalysis.findUnique({ where: { jobId } });
  if (existing && existing.contentHash === contentHash) {
    return { cached: true, analysisId: existing.id };
  }

  const ai = getAIProvider();
  const result = await ai.analyzeJob({
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description ?? "",
    salaryOriginal: job.salaryOriginal,
  });


  const providerName = (ai as { lastProviderName?: string }).lastProviderName ?? ai.name;

  const saved = await prisma.jobAnalysis.upsert({
    where: { jobId },
    update: {
      contentHash,
      requiredSkills: JSON.stringify(result.requiredSkills),
      preferredSkills: JSON.stringify(result.preferredSkills),
      responsibilities: JSON.stringify(result.responsibilities),
      experienceRequirement: result.experienceRequirement,
      educationRequirement: result.educationRequirement,
      seniority: result.seniority,
      employmentType: result.employmentType,
      remoteType: result.remoteType,
      location: result.location,
      salaryMin: result.salaryMin,
      salaryMax: result.salaryMax,
      salaryCurrency: result.salaryCurrency,
      provider: providerName,
    },
    create: {
      jobId,
      contentHash,
      requiredSkills: JSON.stringify(result.requiredSkills),
      preferredSkills: JSON.stringify(result.preferredSkills),
      responsibilities: JSON.stringify(result.responsibilities),
      experienceRequirement: result.experienceRequirement,
      educationRequirement: result.educationRequirement,
      seniority: result.seniority,
      employmentType: result.employmentType,
      remoteType: result.remoteType,
      location: result.location,
      salaryMin: result.salaryMin,
      salaryMax: result.salaryMax,
      salaryCurrency: result.salaryCurrency,
      provider: providerName,
    },
  });

  return { cached: false, analysisId: saved.id };
}

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export type MatchOutcome = {
  overall: number;
  category: string;
  decision: string;
  subScores: Record<string, number | null>;
  matchingSkills: string[];
  missingSkills: string[];
  niceToHaveSkills: string[];
  explanation: string;
  provider: string;
  fromCache: boolean;
};

/**
 * Compute (or load cached) match for one user+job. Missing salary/location,
 * missing analysis and missing profile all degrade gracefully — matching
 * never crashes on incomplete data.
 */
export async function matchJobForUser(userId: string, jobId: string): Promise<MatchOutcome | null> {
  const [job, inputs] = await Promise.all([
    prisma.job.findUnique({ where: { id: jobId }, include: { analysis: true } }),
    buildDecisionInputs(userId),
  ]);
  if (!job) return null;

  // Input hash covers everything the decision depends on besides the job itself.
  const inputHash = sha256(
    JSON.stringify({
      skills: inputs.candidate.skills,
      levels: inputs.candidate.experienceLevels,
      years: inputs.candidate.yearsOfExperience,
      prefs: inputs.preferences,
      engine: getDecisionProvider().name,
    }),
  );

  const existing = await prisma.jobMatch.findUnique({
    where: { userId_jobId: { userId, jobId } },
  });
  // inputHash covers the candidate, preferences and engine — if none of those
  // changed, a stored verdict (SHOW *or* HIDE) is still valid. Re-deciding
  // hidden jobs on every search would burn JEV calls for nothing.
  if (existing && existing.inputHash === inputHash) {
    return {
      overall: existing.overall,
      category: existing.category,
      decision: existing.decision,
      subScores: {
        skills: existing.skillsScore,
        experience: existing.experienceScore,
        role: existing.roleScore,
        location: existing.locationScore,
        salary: existing.salaryScore,
        employment: existing.employmentScore,
      },
      matchingSkills: parse(existing.matchingSkills, []),
      missingSkills: parse(existing.missingSkills, []),
      niceToHaveSkills: parse(existing.niceToHaveSkills, []),
      explanation: existing.explanation ?? "",
      provider: existing.provider,
      fromCache: true,
    };
  }

  // Ensure analysis exists (cached inside).
  await analyzeJobCached(jobId);
  const analysis =
    (await prisma.jobAnalysis.findUnique({ where: { jobId } })) ?? null;

  const decisionInput = {
    job: {
      title: job.title,
      company: job.company,
      location: job.location,
      remoteType: analysis?.remoteType ?? job.remoteType,
      employmentType: analysis?.employmentType ?? job.employmentType,
      requiredSkills: parse<string[]>(analysis?.requiredSkills, []),
      preferredSkills: parse<string[]>(analysis?.preferredSkills, []),
      experienceRequirement: analysis?.experienceRequirement ?? null,
      seniority: analysis?.seniority ?? job.seniority ?? null,
      salaryMin: analysis?.salaryMin ?? job.salaryMin,
      salaryMax: analysis?.salaryMax ?? job.salaryMax,
      salaryCurrency: analysis?.salaryCurrency ?? job.salaryCurrency,
    },
    candidate: inputs.candidate,
    preferences: inputs.preferences,
  };

  const engine = getDecisionProvider();
  const verdict = await engine.evaluateJob(decisionInput);

  // Explanation: written once and cached, and only where it earns its cost —
  // a shown job the user may actually apply to. LOW matches show the score
  // breakdown instead, which keeps a 15-job search inside its time budget.
  let explanation = "";
  if (verdict.decision === "SHOW" && verdict.category !== "LOW") {
    const ai = getAIProvider();
    explanation = await ai.generateExplanation({
      jobTitle: job.title,
      company: job.company,
      matchSummary: {
        overall: verdict.overall,
        category: verdict.category,
        skillsScore: verdict.subScores.skills,
        experienceScore: verdict.subScores.experience,
        roleScore: verdict.subScores.role,
        locationScore: verdict.subScores.location,
        salaryScore: verdict.subScores.salary,
        employmentScore: verdict.subScores.employment,
      },
      matchingSkills: verdict.matchingSkills,
      missingSkills: verdict.missingSkills,
      niceToHaveSkills: verdict.niceToHaveSkills,
      candidateSkills: inputs.candidateSkills,
    });
  }

  await prisma.jobMatch.upsert({
    where: { userId_jobId: { userId, jobId } },
    update: {
      overall: verdict.overall,
      category: verdict.category,
      decision: verdict.decision,
      skillsScore: verdict.subScores.skills,
      experienceScore: verdict.subScores.experience,
      roleScore: verdict.subScores.role,
      locationScore: verdict.subScores.location,
      salaryScore: verdict.subScores.salary,
      employmentScore: verdict.subScores.employment,
      matchingSkills: JSON.stringify(verdict.matchingSkills),
      missingSkills: JSON.stringify(verdict.missingSkills),
      niceToHaveSkills: JSON.stringify(verdict.niceToHaveSkills),
      explanation,
      provider: engine.name,
      inputHash,
    },
    create: {
      userId,
      jobId,
      overall: verdict.overall,
      category: verdict.category,
      decision: verdict.decision,
      skillsScore: verdict.subScores.skills,
      experienceScore: verdict.subScores.experience,
      roleScore: verdict.subScores.role,
      locationScore: verdict.subScores.location,
      salaryScore: verdict.subScores.salary,
      employmentScore: verdict.subScores.employment,
      matchingSkills: JSON.stringify(verdict.matchingSkills),
      missingSkills: JSON.stringify(verdict.missingSkills),
      niceToHaveSkills: JSON.stringify(verdict.niceToHaveSkills),
      explanation,
      provider: engine.name,
      inputHash,
    },
  });

  return {
    overall: verdict.overall,
    category: verdict.category,
    decision: verdict.decision,
    subScores: verdict.subScores,
    matchingSkills: verdict.matchingSkills,
    missingSkills: verdict.missingSkills,
    niceToHaveSkills: verdict.niceToHaveSkills,
    explanation,
    provider: engine.name,
    fromCache: false,
  };
}
