"use server-only";

import type {
  AIProvider,
  GeneratedQueries,
  JobAnalysisResult,
  ParsedResume,
} from "./types";

/**
 * Deterministic offline AIProvider. Zero-key, zero-network.
 * Clearly labeled in the UI as the offline fallback — it is not an LLM.
 * It only extracts what is literally present in the text.
 */

const COMMON_SKILLS = [
  "JavaScript", "TypeScript", "Python", "Java", "C#", "C++", "Go", "Rust", "Ruby",
  "PHP", "Kotlin", "Swift", "SQL", "Bash", "HTML", "CSS",
  "React", "Next.js", "Vue", "Angular", "Svelte", "Node.js", "Express", "FastAPI",
  "Django", "Flask", "Spring", ".NET", "Rails", "Laravel",
  "Redux", "Tailwind", "GraphQL", "REST APIs", "WebSockets",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "Elasticsearch", "DynamoDB",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "CI/CD", "Jenkins",
  "Git", "Linux", "Nginx",
  "TensorFlow", "PyTorch", "scikit-learn", "Pandas", "NumPy", "NLP", "LLMs",
  "Jest", "Cypress", "Playwright", "Vitest",
];

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function splitList(line: string): string[] {
  return line
    .split(/[,;•|/\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 60);
}

export class HeuristicAIProvider implements AIProvider {
  readonly name = "heuristic";

  async parseResume(resumeText: string): Promise<ParsedResume> {
    const text = resumeText;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    // Contact fields via regex — only what is literally present.
    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null;
    const phone =
      text.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? null;
    const linkedin = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w-]+/i)?.[0] ?? null;
    const github = text.match(/(https?:\/\/)?(www\.)?github\.com\/[\w-]+/i)?.[0] ?? null;

    const name =
      lines.find(
        (l) =>
          l.length > 2 &&
          l.length < 50 &&
          /^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(l) &&
          !l.includes("@") &&
          !/resume|curriculum/i.test(l),
      ) ?? null;

    const portfolio = text.match(/https?:\/\/[^\s)]+(?!linkedin|github)[^\s)]*/i)?.[0] ?? null;

    // Skills: intersect known list with document terms; also split explicit
    // "Skills: a, b, c" lines.
    const found = new Set<string>();
    for (const s of COMMON_SKILLS) {
      // word-boundary-ish match; allows Next.js / C++ / .NET
      const re = new RegExp(`(^|[^\\w])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w])`, "i");
      if (re.test(text)) found.add(s);
    }
    for (const line of lines) {
      if (/^(skills|technical skills|technologies)\b[:\s]/i.test(line)) {
        for (const item of splitList(line.replace(/^(skills|technical skills|technologies)\b[:\s]/i, ""))) {
          if (item.length < 40) found.add(item);
        }
      }
    }

    const experiences: ParsedResume["experiences"] = [];
    const expRe = /^(.+?)\s*[·|\-–—]\s*(.+?)\s*[·|\-–—]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?[\w\s,]*\d{4})\s*(?:[-–—]\s*(Present|[\w\s,]*\d{4}))?$/i;
    for (const line of lines) {
      const m = line.match(expRe);
      if (m) {
        experiences.push({
          company: m[2].trim(),
          role: m[1].trim(),
          startDate: m[3].trim(),
          endDate: m[4]?.trim() ?? null,
          description: null,
          technologies: [],
        });
      }
    }

    const education: ParsedResume["education"] = [];
    const eduRe = /(B\.?Tech|B\.?E\.?|B\.?Sc|B\.?Com|M\.?Tech|M\.?Sc|M\.?CA|B\.?CA|MBA|Ph\.?D)[^,|;]*/gi;
    for (const line of lines) {
      const deg = line.match(eduRe)?.[0];
      if (deg) {
        const years = line.match(/(19|20)\d{2}/g)?.map(Number) ?? [];
        education.push({
          institution: line.replace(eduRe, "").replace(/[|·,–-]+\s*$/, "").trim() || "Unknown",
          degree: deg.trim(),
          field: null,
          startYear: years.length > 1 ? Math.min(...years) : null,
          graduationYear: years.length > 0 ? Math.max(...years) : null,
        });
      }
    }

    return {
      name,
      email,
      phone,
      linkedin,
      github,
      portfolio,
      summary: null,
      skills: unique([...found]).slice(0, 60),
      experiences: experiences.slice(0, 12),
      education: education.slice(0, 6),
      projects: [],
      certifications: [],
    };
  }

  async analyzeJob(job: {
    title: string;
    company: string;
    location: string | null;
    description: string;
    salaryOriginal: string | null;
  }): Promise<JobAnalysisResult> {
    const text = job.description;
    const lower = text.toLowerCase();

    const requiredSkills = unique(
      COMMON_SKILLS.filter((s) => {
        const re = new RegExp(`(^|[^\\w])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w])`, "i");
        return re.test(text);
      }),
    ).slice(0, 30);

    const preferredSkills: string[] = [];
    // Skills listed after "nice to have"/"preferred" markers.
    const prefIdx = lower.search(/nice to have|preferred qualifications|bonus points|plus:/);
    if (prefIdx !== -1) {
      const prefText = text.slice(prefIdx, prefIdx + 600);
      for (const s of COMMON_SKILLS) {
        const re = new RegExp(`(^|[^\\w])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w])`, "i");
        if (re.test(prefText)) preferredSkills.push(s);
      }
    }

    // Salary parsing from the ORIGINAL text only — never invented.
    // Handles "$60,000 - $90,000", "60K-90K", "₹12,00,000 - ₹18,00,000".
    let salaryMin: number | null = null;
    let salaryMax: number | null = null;
    const salaryText = job.salaryOriginal ?? "";
    const cleaned = salaryText.replace(/[$₹€£,\s]/g, "");
    const range = cleaned.match(/(\d+(?:\.\d+)?)([kK])?[-–—](\d+(?:\.\d+)?)([kK])?/);
    if (range) {
      const mult = (suffix: string | undefined) => (suffix?.toLowerCase() === "k" ? 1000 : 1);
      salaryMin = Math.round(Number(range[1]) * mult(range[2]));
      salaryMax = Math.round(Number(range[3]) * mult(range[4]));
    } else {
      const single = cleaned.match(/^(\d+(?:\.\d+)?)([kK])?$/);
      if (single) {
        salaryMin = salaryMax = Math.round(Number(single[1]) * (single[2]?.toLowerCase() === "k" ? 1000 : 1));
      }
    }

    const remoteType: JobAnalysisResult["remoteType"] =
      /\bremote\b/i.test(lower) && /hybrid/i.test(lower)
        ? "HYBRID"
        : /\bremote\b/i.test(lower)
          ? "REMOTE"
          : /\bon-?site\b/i.test(lower)
            ? "ONSITE"
            : "UNKNOWN";

    const years = text.match(/(\d+)\+?\s*years?/i)?.[1];
    const seniority =
      /\b(senior|sr\.?)\b/i.test(job.title)
        ? "Senior"
        : /\b(junior|jr\.?)\b/i.test(job.title)
          ? "Junior"
          : /\b(lead|principal|staff)\b/i.test(job.title)
            ? "Lead"
            : /\bintern(ship)?\b/i.test(job.title)
              ? "Intern"
              : null;

    return {
      requiredSkills,
      preferredSkills: unique(preferredSkills).filter((s) => !requiredSkills.includes(s)),
      responsibilities: [],
      experienceRequirement: years ? `${years}+ years` : null,
      educationRequirement: /\bbachelor|b\.?tech|b\.?e\.?\b/i.test(lower)
        ? "Bachelor's degree"
        : /\bmaster|m\.?tech|m\.?sc\b/i.test(lower)
          ? "Master's degree"
          : null,
      seniority,
      employmentType: /\bfull[- ]?time\b/i.test(lower)
        ? "Full-time"
        : /\bpart[- ]?time\b/i.test(lower)
          ? "Part-time"
          : /\bcontract(or)?\b/i.test(lower)
            ? "Contract"
            : /\bintern(ship)?\b/i.test(lower)
              ? "Internship"
              : null,
      remoteType,
      location: job.location,
      salaryMin,
      salaryMax,
      salaryCurrency: /\$|usd/i.test(salaryText) ? "USD" : /₹|inr/i.test(salaryText) ? "INR" : /€/i.test(salaryText) ? "EUR" : null,
    };
  }

  async generateSearchQueries(input: {
    profileSummary: string;
    desiredRoles: string[];
    skills: string[];
    preferredLocations: string[];
    experienceLevels: string[];
  }): Promise<GeneratedQueries> {
    // Deterministic derivation from desired roles only — no invention.
    const primary = input.desiredRoles.slice(0, 4);
    const related: string[] = [];
    const skillWord = input.skills[0];

    for (const role of input.desiredRoles.slice(0, 3)) {
      const words = role.split(/\s+/);
      if (words.length >= 2) {
        related.push([...words.slice(1), words[0]].join(" ")); // reorder: "Backend Developer" → "Developer Backend"-style variants
      }
      if (skillWord && !role.toLowerCase().includes(skillWord.toLowerCase())) {
        related.push(`${role} ${skillWord}`);
      }
    }
    if (input.desiredRoles.includes("Software Engineer") && skillWord) {
      related.push(`${skillWord} Developer`);
    }

    return {
      primary,
      related: unique(related).slice(0, 8),
    };
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
    const m = input.matchSummary;
    const parts: string[] = [];

    if (input.matchingSkills.length > 0) {
      parts.push(
        `Your ${input.matchingSkills.slice(0, 4).join(", ")} experience directly overlaps with the core requirements.`,
      );
    } else {
      parts.push("Few of the job's required skills appear in your profile yet.");
    }

    if (m.locationScore === 100) parts.push("The role matches your selected work-location preferences.");
    if (m.salaryScore !== null && m.salaryScore >= 80)
      parts.push("The stated salary range overlaps your target range.");
    if (input.missingSkills.length > 0) {
      parts.push(
        `POTENTIAL GAP: the job lists ${input.missingSkills.slice(0, 3).join(", ")}, which are not currently present in your profile.`,
      );
    }

    return parts.join(" ");
  }
}
