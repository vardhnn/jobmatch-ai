"use server-only";

/**
 * DecisionProvider abstraction — the JEV decision layer.
 *
 * JEV makes structured show/hide + scoring decisions. It NEVER writes
 * prose (explanations belong to the AIProvider) and never sees external
 * credentials. Inputs are plain structured data.
 */

export type DecisionInput = {
  job: {
    title: string;
    company: string;
    location: string | null;
    remoteType: string;
    employmentType: string | null;
    requiredSkills: string[];
    preferredSkills: string[];
    experienceRequirement: string | null;
    seniority: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
  };
  candidate: {
    skills: string[];
    experienceLevels: string[];
    seniority: string | null;
    /** Total years of experience derived from profile entries; null if unknown. */
    yearsOfExperience: number | null;
  };
  preferences: {
    desiredRoles: string[];
    workArrangement: string;
    preferredLocations: string[];
    locationFlexibility: string;
    willingToRelocate: boolean;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string;
    employmentTypes: string[];
    experienceLevels: string[];
    preferredCompanies: string[];
    excludedCompanies: string[];
    includeJobsWithoutSalary: boolean;
  };
};

export type DecisionResult = {
  overall: number;
  category: "STRONG" | "POTENTIAL" | "LOW";
  decision: "SHOW" | "HIDE";
  subScores: {
    skills: number | null;
    experience: number | null;
    role: number | null;
    location: number | null;
    salary: number | null;
    employment: number | null;
  };
  matchingSkills: string[];
  missingSkills: string[];
  niceToHaveSkills: string[];
  reasons: string[];
};

export interface DecisionProvider {
  /** Label used for cache attribution, e.g. "jev" or "heuristic-dev". */
  readonly name: string;
  evaluateJob(input: DecisionInput): Promise<DecisionResult>;
  scoreSkillMatch(candidateSkills: string[], requiredSkills: string[], preferredSkills: string[]): {
    score: number;
    matching: string[];
    missing: string[];
    niceToHave: string[];
  };
  evaluateExperience(candidate: DecisionInput["candidate"], requirement: string | null, seniority: string | null): number | null;
  evaluatePreferenceMatch(job: DecisionInput["job"], preferences: DecisionInput["preferences"]): {
    role: number;
    location: number | null;
    salary: number | null;
    employment: number | null;
  };
}
