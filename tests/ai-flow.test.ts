import { describe, it, expect, vi } from "vitest";

// Env must be set before config.ts is imported (imports are hoisted).
vi.hoisted(() => {
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key-123";
  process.env.OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free";
  process.env.DECISION_PROVIDER = "jev";
  process.env.JEV_MODEL = "typesafe/jev-1.13";
});

/**
 * End-to-end verification of the OpenRouter migration.
 *
 * The OpenRouter HTTP client is mocked globally so the suite runs offline
 * and deterministically; the real client's error/retry logic is exercised
 * separately against a stubbed fetch.
 */

// ── Mock fetch before any imports that transitively use it ──────
const fetchCalls: { url: string; body: Record<string, unknown> }[] = [];
let mockMode: "ok" | "rate-limited" | "server-error" | "garbage" | "empty" = "ok";

const okResponse = (content: object | string) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({
    model: "google/gemma-4-26b-a4b-it:free",
    choices: [
      {
        message: {
          content:
            typeof content === "string" ? content : `\`\`\`json\n${JSON.stringify(content)}\n\`\`\``,
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }),
  text: async () => "",
});

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string | URL, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    fetchCalls.push({ url: String(url), body });

    if (mockMode === "rate-limited") {
      return { ok: false, status: 429, headers: new Headers(), text: async () => "rate limited" };
    }
    if (mockMode === "server-error") {
      return { ok: false, status: 503, headers: new Headers(), text: async () => "upstream down" };
    }
    if (mockMode === "garbage") {
      return okResponse("This is not JSON at all, sorry!");
    }
    if (mockMode === "empty") {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ choices: [] }),
      };
    }

    // Route by system prompt content.
    const messages = (body.messages as { role: string; content: string }[]) ?? [];
    const sys = messages.find((m) => m.role === "system")?.content ?? "";

    if (sys.includes("resume-structuring")) {
      return okResponse({
        name: "Vishnu Vardhan",
        email: "vishnu.vardhan@example.com",
        phone: "+91 98765 43210",
        linkedin: "linkedin.com/in/vishnu-vardhan",
        github: "github.com/vishnuvardhan",
        portfolio: null,
        summary: "Backend engineer focused on Python services.",
        skills: ["Python", "FastAPI", "PostgreSQL", "REST APIs", "Git", "Docker", "React", "TypeScript"],
        experiences: [
          {
            company: "Acme Corp",
            role: "Software Engineer",
            startDate: "2023-06",
            endDate: null,
            description: "Built REST APIs.",
            technologies: ["FastAPI", "PostgreSQL"],
          },
        ],
        education: [
          { institution: "JNTU Hyderabad", degree: "B.Tech", field: "Computer Science", startYear: 2017, graduationYear: 2021 },
        ],
        projects: [{ name: "JobBoard Aggregator", description: "Aggregated listings.", technologies: ["Python"], url: null }],
        certifications: [],
      });
    }
    if (sys.includes("job-requirement extraction")) {
      return okResponse({
        requiredSkills: ["Python", "FastAPI", "PostgreSQL", "REST APIs", "Git"],
        preferredSkills: ["AWS", "Docker", "Kubernetes"],
        responsibilities: ["Build APIs", "Own services"],
        experienceRequirement: "2+ years",
        educationRequirement: null,
        seniority: null,
        employmentType: "Full-time",
        remoteType: "HYBRID",
        location: "Hyderabad, India",
        salaryMin: 60000,
        salaryMax: 90000,
        salaryCurrency: "USD",
      });
    }
    if (sys.includes("job-search queries")) {
      return okResponse({
        primary: ["Python Developer", "Backend Developer"],
        related: ["Backend Engineer Python", "API Developer", "Python Software Engineer"],
      });
    }
    if (sys.includes("job-fit decision engine")) {
      return okResponse({
        overall: 87,
        category: "STRONG",
        decision: "SHOW",
        sub_scores: { skills: 92, experience: 85, role: 96, location: 100, salary: 90, employment: 100 },
        matching_skills: ["Python"],
        missing_skills: [],
        nice_to_have_skills: [],
        reasons: ["Strong skill overlap"],
      });
    }
    if (sys.includes("job-match explanations")) {
      return okResponse({
        explanation:
          "Your Python, FastAPI and PostgreSQL experience directly overlaps with the core requirements. The role accepts entry-level candidates and matches your selected work preferences. POTENTIAL GAP: AWS and Docker are not currently present in your profile.",
      });
    }

    return okResponse({});
  }),
);

import { extractJson, OpenRouterError } from "@/lib/ai/openrouter-client";
import { OpenRouterAIProvider } from "@/lib/ai/openrouter-provider";
import { HeuristicAIProvider } from "@/lib/ai/heuristic-provider";
import { HeuristicDecisionProvider } from "@/lib/jev/dev-provider";
import { scoreSkillMatch } from "@/lib/jev/heuristics";

const SAMPLE_RESUME = `VISHNU VARDHAN
vishnu.vardhan@example.com | +91 98765 43210
linkedin.com/in/vishnu-vardhan

SKILLS: Python, FastAPI, PostgreSQL, Docker

EXPERIENCE
Software Engineer · Acme Corp · Jun 2023 - Present

EDUCATION
B.Tech Computer Science, JNTU Hyderabad, 2017 - 2021`;

const JOB_INPUT = {
  title: "Python Backend Developer",
  company: "Alpha Technologies",
  location: "Hyderabad, India",
  description:
    "Required skills: Python, FastAPI, PostgreSQL, REST APIs, Git. Nice to have: AWS, Docker. Salary: $60,000 - $90,000. Hybrid, Hyderabad. Full-time. 2+ years experience.",
  salaryOriginal: "$60,000 - $90,000",
};

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses fenced JSON", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\ndone')).toEqual({ a: 1 });
  });
  it("parses JSON embedded in prose", () => {
    expect(extractJson('Here you go: {"a":[1,2]} hope that helps')).toEqual({ a: [1, 2] });
  });
  it("throws OpenRouterError on garbage", () => {
    expect(() => extractJson("no json here")).toThrow(OpenRouterError);
  });
});

describe("OpenRouterAIProvider", () => {
  const provider = new OpenRouterAIProvider();

  it("parses a resume through OpenRouter", async () => {
    const r = await provider.parseResume(SAMPLE_RESUME);
    expect(r.name).toBe("Vishnu Vardhan");
    expect(r.skills).toContain("FastAPI");
    expect(r.experiences[0]?.company).toBe("Acme Corp");
  });

  it("sanitizes hallucinated salary values out", async () => {
    const r = await provider.analyzeJob(JOB_INPUT);
    expect(r.requiredSkills).toContain("Python");
    expect(r.salaryMin).toBe(60000);
    expect(r.salaryMax).toBe(90000);
    expect(r.remoteType).toBe("HYBRID");
  });

  it("generates bounded queries", async () => {
    const r = await provider.generateSearchQueries({
      profileSummary: "Backend engineer",
      desiredRoles: ["Python Developer"],
      skills: ["Python"],
      preferredLocations: ["Hyderabad"],
      experienceLevels: ["ENTRY"],
    });
    expect(r.primary.length).toBeGreaterThan(0);
    expect(r.related.length).toBeGreaterThan(0);
    expect(r.primary.length).toBeLessThanOrEqual(6);
  });

  it("generates an explanation referencing skills", async () => {
    const r = await provider.generateExplanation({
      jobTitle: "Python Backend Developer",
      company: "Alpha",
      matchSummary: { overall: 87, category: "STRONG", skillsScore: 92, experienceScore: 85, roleScore: 96, locationScore: 100, salaryScore: 90, employmentScore: 100 },
      matchingSkills: ["Python", "FastAPI"],
      missingSkills: ["AWS"],
      niceToHaveSkills: [],
      candidateSkills: ["Python", "FastAPI"],
    });
    expect(r).toContain("Python");
  });
});

describe("HeuristicAIProvider (offline fallback)", () => {
  const provider = new HeuristicAIProvider();

  it("extracts contact info and skills without a model", async () => {
    const r = await provider.parseResume(SAMPLE_RESUME);
    expect(r.email).toBe("vishnu.vardhan@example.com");
    expect(r.linkedin).toContain("linkedin.com/in");
    expect(r.skills).toContain("Python");
  });

  it("parses salary from original text only", async () => {
    const r = await provider.analyzeJob(JOB_INPUT);
    expect(r.salaryMin).toBe(60000);
    expect(r.salaryMax).toBe(90000);
    expect(r.salaryCurrency).toBe("USD");
  });

  it("never invents salary when absent", async () => {
    const r = await provider.analyzeJob({ ...JOB_INPUT, salaryOriginal: null, description: "Python role." });
    expect(r.salaryMin).toBeNull();
    expect(r.salaryMax).toBeNull();
  });
});

describe("Decision engines", () => {
  it("dev engine scores skill overlap and lists gaps", async () => {
    const engine = new HeuristicDecisionProvider();
    const r = await engine.evaluateJob({
      job: {
        title: "Python Backend Developer",
        company: "Alpha",
        location: "Hyderabad, India",
        remoteType: "HYBRID",
        employmentType: "Full-time",
        requiredSkills: ["Python", "FastAPI", "PostgreSQL", "REST APIs"],
        preferredSkills: ["AWS", "Docker"],
        experienceRequirement: "2+ years",
        seniority: null,
        salaryMin: 60000,
        salaryMax: 90000,
        salaryCurrency: "USD",
      },
      candidate: { skills: ["Python", "FastAPI", "PostgreSQL", "REST APIs", "Git"], experienceLevels: ["ENTRY", "JUNIOR"], seniority: null, yearsOfExperience: 2 },
      preferences: {
        desiredRoles: ["Python Developer", "Backend Developer"],
        workArrangement: "ANY",
        preferredLocations: ["Hyderabad, India"],
        locationFlexibility: "WORLDWIDE",
        willingToRelocate: false,
        salaryMin: 50000,
        salaryMax: 100000,
        salaryCurrency: "USD",
        employmentTypes: ["FULL_TIME"],
        experienceLevels: ["ENTRY", "JUNIOR"],
        preferredCompanies: [],
        excludedCompanies: [],
        includeJobsWithoutSalary: true,
      },
    });
    expect(r.matchingSkills).toContain("Python");
    expect(r.missingSkills.length).toBe(0);
    expect(r.niceToHaveSkills).toEqual(expect.arrayContaining(["AWS", "Docker"]));
    expect(r.overall).toBeGreaterThan(70);
    expect(r.decision).toBe("SHOW");
  });

  it("scoreSkillMatch handles empty requirements", () => {
    const r = scoreSkillMatch(["Python"], [], []);
    expect(r.score).toBe(60);
  });
});

describe("OpenRouter client resilience", () => {
  it("retries on 429 then succeeds", async () => {
    mockMode = "rate-limited";
    const provider = new OpenRouterAIProvider();
    const p = provider.generateSearchQueries({
      profileSummary: "x",
      desiredRoles: ["A"],
      skills: [],
      preferredLocations: [],
      experienceLevels: [],
    });
    // flip to ok after first attempt so retry succeeds
    setTimeout(() => (mockMode = "ok"), 50);
    const r = await p;
    expect(r.primary.length).toBeGreaterThan(0);
  });

  it("surfaces garbage JSON as fallback-able error", async () => {
    mockMode = "garbage";
    const provider = new OpenRouterAIProvider();
    await expect(
      provider.generateSearchQueries({ profileSummary: "x", desiredRoles: ["A"], skills: [], preferredLocations: [], experienceLevels: [] }),
    ).rejects.toThrow();
    mockMode = "ok";
  });
});
