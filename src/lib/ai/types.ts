"use server-only";

/**
 * AIProvider abstraction — language-model work ONLY.
 *
 * Decision-making (scoring, categorization, show/hide) belongs to the
 * DecisionProvider (JEV). This interface is strictly for: resume parsing,
 * job analysis, search-query generation, and match explanations.
 */

export type ParsedResume = {
  name: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
  summary: string | null;
  skills: string[];
  experiences: {
    company: string;
    role: string;
    startDate: string | null;
    endDate: string | null;
    description: string | null;
    technologies: string[];
  }[];
  education: {
    institution: string;
    degree: string;
    field: string | null;
    startYear: number | null;
    graduationYear: number | null;
  }[];
  projects: {
    name: string;
    description: string | null;
    technologies: string[];
    url: string | null;
  }[];
  certifications: string[];
};

export type JobAnalysisResult = {
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  experienceRequirement: string | null;
  educationRequirement: string | null;
  seniority: string | null;
  employmentType: string | null;
  remoteType: "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN";
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
};

export type GeneratedQueries = {
  primary: string[];
  related: string[];
};

/** Error subtype signaling the fallback provider should take over. */
export class AIPersistentError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AIPersistentError";
  }
}

/**
 * Thrown when an AI feature is requested with no BYOK credential. Callers
 * translate this into a friendly "add your key in Settings" response.
 */
export class AiNotConfiguredError extends Error {
  constructor(message = "No AI key configured — add one in Settings → Intelligence Layer.") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

export interface AIProvider {
  readonly name: string;
  parseResume(resumeText: string): Promise<ParsedResume>;
  analyzeJob(job: { title: string; company: string; location: string | null; description: string; salaryOriginal: string | null }): Promise<JobAnalysisResult>;
  generateSearchQueries(input: {
    profileSummary: string;
    desiredRoles: string[];
    skills: string[];
    preferredLocations: string[];
    experienceLevels: string[];
  }): Promise<GeneratedQueries>;
  generateExplanation(input: {
    jobTitle: string;
    company: string;
    matchSummary: {
      overall: number;
      category: string;
      skillsScore: number | null;
      experienceScore: number | null;
      roleScore: number | null;
      locationScore: number | null;
      salaryScore: number | null;
      employmentScore: number | null;
    };
    matchingSkills: string[];
    missingSkills: string[];
    niceToHaveSkills: string[];
    candidateSkills: string[];
  }): Promise<string>;
}
