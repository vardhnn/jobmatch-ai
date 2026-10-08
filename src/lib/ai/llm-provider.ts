"use server-only";

import type { AIProvider, GeneratedQueries, JobAnalysisResult, ParsedResume } from "./types";
import { AIPersistentError } from "./types";
import type { AiCredential } from "./providers";
import {
  AiTransportError,
  asNullableString,
  asNumber,
  asStringArray,
  chatJson,
} from "./providers";

/** Shared validation so a hallucinating model can never poison the profile. */
function validateParsedResume(raw: unknown): ParsedResume {
  const r = (raw ?? {}) as Record<string, unknown>;
  const objArr = (v: unknown) => (Array.isArray(v) ? v : []);

  return {
    name: asNullableString(r.name, 120),
    email: asNullableString(r.email, 200),
    phone: asNullableString(r.phone, 40),
    linkedin: asNullableString(r.linkedin, 300),
    github: asNullableString(r.github, 300),
    portfolio: asNullableString(r.portfolio, 300),
    summary: asNullableString(r.summary, 1200),
    skills: asStringArray(r.skills, 80),
    experiences: objArr(r.experiences)
      .slice(0, 15)
      .map((e) => {
        const x = (e ?? {}) as Record<string, unknown>;
        return {
          company: asNullableString(x.company, 160) ?? "Unknown",
          role: asNullableString(x.role, 160) ?? "Unknown",
          startDate: asNullableString(x.startDate, 20),
          endDate: asNullableString(x.endDate, 20),
          description: asNullableString(x.description, 2000),
          technologies: asStringArray(x.technologies, 30),
        };
      })
      .filter((e) => e.company !== "Unknown" || e.role !== "Unknown"),
    education: objArr(r.education)
      .slice(0, 10)
      .map((e) => {
        const x = (e ?? {}) as Record<string, unknown>;
        const year = (v: unknown) => {
          const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
          return Number.isFinite(n) && n >= 1950 && n <= 2100 ? Math.round(n) : null;
        };
        return {
          institution: asNullableString(x.institution, 200) ?? "Unknown",
          degree: asNullableString(x.degree, 200) ?? "Unknown",
          field: asNullableString(x.field, 200),
          startYear: year(x.startYear),
          graduationYear: year(x.graduationYear),
        };
      })
      .filter((e) => e.institution !== "Unknown" || e.degree !== "Unknown"),
    projects: objArr(r.projects)
      .slice(0, 12)
      .map((p) => {
        const x = (p ?? {}) as Record<string, unknown>;
        return {
          name: asNullableString(x.name, 200) ?? "Unknown",
          description: asNullableString(x.description, 1500),
          technologies: asStringArray(x.technologies, 30),
          url: asNullableString(x.url, 300),
        };
      })
      .filter((p) => p.name !== "Unknown"),
    certifications: asStringArray(r.certifications, 20),
  };
}

const REMOTE_TYPES = new Set(["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"]);

function validateJobAnalysis(raw: unknown): JobAnalysisResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const remote = asNullableString(r.remoteType, 20)?.toUpperCase() ?? "UNKNOWN";
  // Salary: annual integer amounts. Plausibility bounds reject garbage while
  // never inventing values — null stays null.
  const salaryMin = asNumber(r.salaryMin, 0, 50_000_000);
  const salaryMax = asNumber(r.salaryMax, 0, 50_000_000);

  return {
    requiredSkills: asStringArray(r.requiredSkills, 40),
    preferredSkills: asStringArray(r.preferredSkills, 40),
    responsibilities: asStringArray(r.responsibilities, 15),
    experienceRequirement: asNullableString(r.experienceRequirement, 300),
    educationRequirement: asNullableString(r.educationRequirement, 300),
    seniority: asNullableString(r.seniority, 60),
    employmentType: asNullableString(r.employmentType, 60),
    remoteType: (REMOTE_TYPES.has(remote) ? remote : "UNKNOWN") as JobAnalysisResult["remoteType"],
    location: asNullableString(r.location, 200),
    salaryMin,
    salaryMax,
    salaryCurrency: asNullableString(r.salaryCurrency, 8)?.toUpperCase() ?? null,
  };
}

/**
 * Credential-bound implementation of AIProvider (BYOK).
 *
 * Every AI call is made with the caller's own credential. All errors surface
 * as AIPersistentError so callers can collect per-job failures — there is NO
 * automatic heuristic fallback here: when the model fails, the failure is
 * reported honestly.
 */
export class CredentialBoundAIProvider implements AIProvider {
  constructor(private readonly credential: AiCredential) {}

  get name(): string {
    return `${this.credential.provider}/${this.credential.model}`;
  }

  private fail(stage: string, err: unknown): never {
    const detail =
      err instanceof AiTransportError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    throw new AIPersistentError(`${stage} failed — ${detail}`, err);
  }

  async parseResume(resumeText: string): Promise<ParsedResume> {
    const clipped = resumeText.slice(0, 24_000); // context-window safety
    try {
      const raw = await chatJson<unknown>(
        this.credential,
        [
          {
            role: "system",
            content:
              "You are a precise resume-structuring engine. Extract ONLY information present in the resume. Never invent employers, dates, skills or links. Omit fields you cannot find (use null / empty arrays). Respond with JSON only.",
          },
          {
            role: "user",
            content: `Extract a structured candidate profile from this resume text.

Return JSON exactly in this shape:
{
  "name": string|null, "email": string|null, "phone": string|null,
  "linkedin": string|null, "github": string|null, "portfolio": string|null,
  "summary": string|null,
  "skills": string[],
  "experiences": [{"company": string, "role": string, "startDate": "YYYY-MM"|null, "endDate": "YYYY-MM"|null, "description": string|null, "technologies": string[]}],
  "education": [{"institution": string, "degree": string, "field": string|null, "startYear": number|null, "graduationYear": number|null}],
  "projects": [{"name": string, "description": string|null, "technologies": string[], "url": string|null}],
  "certifications": string[]
}
Rules: endDate null means present. Dates use "YYYY-MM" (year-only → "YYYY"). Skills are individual technologies/tools (split combined lists). No markdown fences, JSON only.

RESUME TEXT:
${clipped}`,
          },
        ],
        { temperature: 0.2, maxTokens: 3000, timeoutMs: 90_000 },
      );
      return validateParsedResume(raw);
    } catch (err) {
      this.fail("Resume parsing", err);
    }
  }

  async analyzeJob(job: {
    title: string;
    company: string;
    location: string | null;
    description: string;
    salaryOriginal: string | null;
  }): Promise<JobAnalysisResult> {
    const clipped = job.description.slice(0, 16_000);
    try {
      const raw = await chatJson<unknown>(
        this.credential,
        [
          {
            role: "system",
            content:
              "You are a job-requirement extraction engine. Extract ONLY what the posting states. Never invent salary figures, skills or requirements. If salary is absent, return null — never estimate. Respond with JSON only.",
          },
          {
            role: "user",
            content: `Analyze this job posting and extract structured requirements.

Return JSON exactly in this shape:
{
  "requiredSkills": string[], "preferredSkills": string[],
  "responsibilities": string[],
  "experienceRequirement": string|null, "educationRequirement": string|null,
  "seniority": string|null, "employmentType": string|null,
  "remoteType": "REMOTE"|"HYBRID"|"ONSITE"|"UNKNOWN",
  "location": string|null,
  "salaryMin": number|null, "salaryMax": number|null, "salaryCurrency": string|null
}
Rules: salaryMin/salaryMax are ANNUAL amounts in the posting's currency as integers (e.g. 80000). Convert "80K" → 80000. If the posting gives no salary numbers, use null for all salary fields. preferredSkills = nice-to-have. remoteType UNKNOWN if unclear. No markdown fences, JSON only.

JOB:
TITLE: ${job.title}
COMPANY: ${job.company}
LOCATION: ${job.location ?? "not stated"}
SALARY (raw text): ${job.salaryOriginal ?? "not stated"}

DESCRIPTION:
${clipped}`,
        },
        ],
        { temperature: 0.1, maxTokens: 1200, timeoutMs: 30_000 },
      );
      return validateJobAnalysis(raw);
    } catch (err) {
      this.fail("Job analysis", err);
    }
  }

  async generateSearchQueries(input: {
    profileSummary: string;
    desiredRoles: string[];
    skills: string[];
    preferredLocations: string[];
    experienceLevels: string[];
  }): Promise<GeneratedQueries> {
    try {
      const raw = await chatJson<unknown>(
        this.credential,
        [
          {
            role: "system",
            content:
              "You generate precise job-search queries. Every query must be a plausible job title a company would post, tightly related to the candidate's roles and skills. Never generate unrelated roles, seniority levels the candidate is not qualified for, or company names. Respond with JSON only.",
          },
          {
            role: "user",
            content: `Generate job-search queries for this candidate.

CANDIDATE:
${input.profileSummary || "No summary available."}
Desired roles: ${input.desiredRoles.join(", ") || "none stated"}
Top skills: ${input.skills.slice(0, 25).join(", ") || "none stated"}
Locations: ${input.preferredLocations.join(", ") || "any"}
Experience levels: ${input.experienceLevels.join(", ") || "any"}

Return JSON exactly: {"primary": string[], "related": string[]}
Rules: "primary" = 2-4 direct queries based on desired roles. "related" = 4-8 closely adjacent titles that match the same skill set (e.g. "Python Developer" → "Backend Engineer Python"). Each query 2-5 words. No seniority words unless stated in desired roles. No markdown fences, JSON only.`,
          },
        ],
        { temperature: 0.4 },
      );
      const r = (raw ?? {}) as Record<string, unknown>;
      return {
        primary: asStringArray(r.primary, 6),
        related: asStringArray(r.related, 12),
      };
    } catch (err) {
      this.fail("Search query generation", err);
    }
  }

  async generateExplanation(input: {
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
  }): Promise<string> {
    try {
      const raw = await chatJson<unknown>(
        this.credential,
        [
          {
            role: "system",
            content:
              "You write concise, factual job-match explanations. Only state facts derivable from the provided scores and skill lists. Never invent experience, salaries or requirements. No preamble, no markdown headings.",
          },
          {
            role: "user",
            content: `Explain why this job scored as it does, in 3-5 short lines.

JOB: ${input.jobTitle} at ${input.company}
SCORES: overall=${input.matchSummary.overall} (${input.matchSummary.category}), skills=${input.matchSummary.skillsScore ?? "n/a"}, experience=${input.matchSummary.experienceScore ?? "n/a"}, role=${input.matchSummary.roleScore ?? "n/a"}, location=${input.matchSummary.locationScore ?? "n/a"}, salary=${input.matchSummary.salaryScore ?? "n/a"}, employment=${input.matchSummary.employmentScore ?? "n/a"}
MATCHING SKILLS: ${input.matchingSkills.join(", ") || "none"}
MISSING SKILLS: ${input.missingSkills.join(", ") || "none"}
NICE TO HAVE: ${input.niceToHaveSkills.join(", ") || "none"}
CANDIDATE SKILLS (subset): ${input.candidateSkills.slice(0, 25).join(", ") || "none"}

Return JSON exactly: {"explanation": string}
The explanation must reference concrete matching skills and, if missing skills exist, name them as potential gaps. Plain text, max ~90 words.`,
          },
        ],
        { temperature: 0.3, maxTokens: 900, timeoutMs: 30_000 },
      );
      const text = asNullableString((raw as Record<string, unknown>)?.explanation, 1200);
      if (text) return text;
      // Model ignored the JSON envelope — fall back to the raw response text.
      const rawText = asNullableString(raw, 1200);
      return rawText ?? "Match explanation unavailable for this job.";
    } catch (err) {
      this.fail("Explanation generation", err);
    }
  }
}
