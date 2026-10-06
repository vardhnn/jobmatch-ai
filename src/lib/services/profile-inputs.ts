"use server-only";

import { prisma } from "@/lib/db";
import type { DecisionInput } from "@/lib/jev/types";
import { candidateYears } from "@/lib/jev/heuristics";

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/**
 * Load the user's candidate profile + preferences and shape them into the
 * structured inputs consumed by the AI query generator and the JEV
 * decision engine. Missing data degrades to empty/defaults — never throws.
 */
export async function buildDecisionInputs(userId: string): Promise<{
  candidate: DecisionInput["candidate"];
  candidateSkills: string[];
  preferences: DecisionInput["preferences"];
  profileSummary: string;
  hasProfile: boolean;
}> {
  const [profile, prefsRow] = await Promise.all([
    prisma.candidateProfile.findUnique({
      where: { userId },
      include: {
        skills: true,
        experiences: { orderBy: { sortOrder: "asc" } },
        education: true,
        projects: true,
      },
    }),
    prisma.jobPreferences.findUnique({ where: { userId } }),
  ]);

  const desiredRoles = parse<string[]>(prefsRow?.desiredRoles, []);
  const preferredLocations = parse<string[]>(prefsRow?.preferredLocations, []);
  const employmentTypes = parse<string[]>(prefsRow?.employmentTypes, ["FULL_TIME"]);
  const experienceLevels = parse<string[]>(prefsRow?.experienceLevels, ["ENTRY"]);
  const preferredCompanies = parse<string[]>(prefsRow?.preferredCompanies, []);
  const excludedCompanies = parse<string[]>(prefsRow?.excludedCompanies, []);

  const candidateSkills = (profile?.skills ?? []).map((s) => s.name);
  const years = profile
    ? candidateYears(profile.experiences.map((e) => ({ startDate: e.startDate, endDate: e.endDate })))
    : null;

  const summaryBits: string[] = [];
  if (profile?.name) summaryBits.push(`Name: ${profile.name}`);
  if (profile?.summary) summaryBits.push(profile.summary);
  if (profile?.experiences.length) {
    summaryBits.push(
      `Experience: ${profile.experiences.map((e) => `${e.role} at ${e.company}`).join("; ")}`,
    );
  }
  if (profile?.education.length) {
    summaryBits.push(
      `Education: ${profile.education.map((e) => `${e.degree} ${e.field ?? ""} — ${e.institution}`).join("; ")}`,
    );
  }
  if (candidateSkills.length) summaryBits.push(`Skills: ${candidateSkills.join(", ")}`);

  return {
    candidate: {
      skills: candidateSkills,
      experienceLevels,
      seniority: profile?.experiences[0]?.role ?? null,
      yearsOfExperience: years,
    },
    candidateSkills,
    preferences: {
      desiredRoles,
      workArrangement: prefsRow?.workArrangement ?? "ANY",
      preferredLocations,
      locationFlexibility: prefsRow?.locationFlexibility ?? "SELECTED_ONLY",
      willingToRelocate: prefsRow?.willingToRelocate ?? false,
      salaryMin: prefsRow?.salaryMin ?? null,
      salaryMax: prefsRow?.salaryMax ?? null,
      salaryCurrency: prefsRow?.salaryCurrency ?? "USD",
      employmentTypes,
      experienceLevels,
      preferredCompanies,
      excludedCompanies,
      includeJobsWithoutSalary: prefsRow?.includeJobsWithoutSalary ?? true,
    },
    profileSummary: summaryBits.join("\n"),
    hasProfile: Boolean(profile && (profile.skills.length > 0 || profile.experiences.length > 0)),
  };
}
