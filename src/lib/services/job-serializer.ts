import type { Prisma } from "@prisma/client";
import { getAdapter } from "@/lib/sources";

/**
 * Shared shape for a match row plus its job (and where it was found), used by
 * the jobs list and the job detail endpoints.
 */
export type MatchWithJob = Prisma.JobMatchGetPayload<{
  include: { job: { include: { sourceRecords: { include: { source: true } } } } };
}>;

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export function sourceLabel(key: string): string {
  return getAdapter(key)?.label ?? key;
}

/** Flatten a match + job into the payload the UI renders. */
export function serializeMatch(m: MatchWithJob) {
  return {
    matchId: m.id,
    jobId: m.jobId,
    title: m.job.title,
    company: m.job.company,
    location: m.job.location,
    remoteType: m.job.remoteType,
    employmentType: m.job.employmentType,
    experienceLevel: m.job.experienceLevel,
    salaryMin: m.job.salaryMin,
    salaryMax: m.job.salaryMax,
    salaryCurrency: m.job.salaryCurrency,
    salaryOriginal: m.job.salaryOriginal,
    postedDate: m.job.postedDate,
    applicationUrl: m.job.applicationUrl,
    description: m.job.description,
    overall: m.overall,
    category: m.category,
    decision: m.decision,
    subScores: {
      skills: m.skillsScore,
      experience: m.experienceScore,
      role: m.roleScore,
      location: m.locationScore,
      salary: m.salaryScore,
      employment: m.employmentScore,
    },
    matchingSkills: parse<string[]>(m.matchingSkills, []),
    missingSkills: parse<string[]>(m.missingSkills, []),
    niceToHaveSkills: parse<string[]>(m.niceToHaveSkills, []),
    explanation: m.explanation,
    provider: m.provider,
    matchedAt: m.updatedAt,
    firstSeenAt: m.job.createdAt,
    requiredSkills: parse<string[]>(m.job.requiredSkills, []),
    sources: [
      ...new Map(m.job.sourceRecords.map((r) => [r.source.key, sourceLabel(r.source.key)])).entries(),
    ].map(([key, label]) => ({ key, label })),
  };
}

export type SerializedMatch = ReturnType<typeof serializeMatch>;
