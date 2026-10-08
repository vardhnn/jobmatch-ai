import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** End-to-end verification of the BYOK AI layer.
 *
 * All HTTP (chat endpoints + the OpenRouter Decisions API) is stubbed so the
 * suite runs offline and deterministically. The transport's error/retry rules
 * are exercised against the stubbed fetch; wire-shape details live in
 * tests/byok-providers.test.ts.
 *
 * Credentials are now explicit per-provider objects — there are no AI env
 * vars to set, and no global singleton provider to import.
 */

// ── fetch stub ──────────────────────────────────────────────────────

type RecordedCall = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

let calls: RecordedCall[] = [];
let responder: (call: RecordedCall, attempt: number) => Response = () => new Response("{}", { status: 200 });

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function openAiOk(content: string) {
  return jsonResponse(
    {
      model: "test-model",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    },
    200,
  );
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
      let body: Record<string, unknown> = {};
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body);
      }
      const call = { url, headers, body };
      calls.push(call);
      return responder(call, calls.length);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function routeBySystemPrompt(body: Record<string, unknown>): Response {
  const messages = (body.messages as { role: string; content: string }[]) ?? [];
  const sys = messages.find((m) => m.role === "system")?.content ?? "";

  if (sys.includes("resume-structuring")) {
    return openAiOk(
      "```json\n" +
        JSON.stringify({
          name: "Vishnu Vardhan",
          email: "vishnu.vardhan@example.com",
          phone: "+91 98765 43210",
          linkedin: "linkedin.com/in/vishnu-vardhan",
          github: "github.com/vishnuvardhan",
          portfolio: null,
          summary: "Backend engineer focused on Python services.",
          skills: [
            "Python",
            "FastAPI",
            "PostgreSQL",
            "REST APIs",
            "Git",
            "Docker",
            "React",
            "TypeScript",
          ],
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
            {
              institution: "JNTU Hyderabad",
              degree: "B.Tech",
              field: "Computer Science",
              startYear: 2017,
              graduationYear: 2021,
            },
          ],
          projects: [
            { name: "JobBoard Aggregator", description: "Aggregated listings.", technologies: ["Python"], url: null },
          ],
          certifications: [],
        }) +
        "\n```",
    );
  }

  if (sys.includes("job-requirement extraction")) {
    return openAiOk(
      JSON.stringify({
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
      }),
    );
  }

  if (sys.includes("job-search queries")) {
    return openAiOk(
      JSON.stringify({
        primary: ["Python Developer", "Backend Developer"],
        related: ["Backend Engineer Python", "API Developer", "Python Software Engineer"],
      }),
    );
  }

  if (sys.includes("job-match explanations")) {
    return openAiOk(
      JSON.stringify({
        explanation:
          "Your Python, FastAPI and PostgreSQL experience directly overlaps with the core requirements. The role accepts entry-level candidates and matches your selected work preferences. POTENTIAL GAP: AWS and Docker are not currently present in your profile.",
      }),
    );
  }

  return openAiOk("{}");
}

function decisionsOk() {
  return jsonResponse(
    {
      answers: {
        fit: { type: "choice", choice: "STRONG", confidence: 0.9 },
        overall: { type: "score", score: 3, probabilities: { "3": 1 } },
        skills: { type: "score", score: 3, probabilities: { "3": 1 } },
        experience: { type: "score", score: null, probabilities: {} },
        role: { type: "score", score: 4, probabilities: { "4": 1 } },
        location: { type: "score", score: null, probabilities: {} },
        salary: { type: "score", score: null, probabilities: {} },
        employment: { type: "score", score: null, probabilities: {} },
        worth_showing: { type: "noul", noul: 0.8 },
      },
    },
    200,
  );
}

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

const JOB_DECISION_INPUT = {
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
  candidate: {
    skills: ["Python", "FastAPI", "PostgreSQL", "REST APIs", "Git"],
    experienceLevels: ["ENTRY", "JUNIOR"],
    seniority: null,
    yearsOfExperience: 2,
  },
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
};

import type { AiCredential } from "@/lib/ai/providers";
import { CredentialBoundAIProvider } from "@/lib/ai/llm-provider";
import { HeuristicAIProvider } from "@/lib/ai/heuristic-provider";
import { getAIProvider } from "@/lib/ai";
import { JevProvider } from "@/lib/jev/jev-provider";
import { HeuristicDecisionProvider } from "@/lib/jev/dev-provider";
import { getDecisionProvider } from "@/lib/jev";
import { scoreSkillMatch } from "@/lib/jev/heuristics";
import { AiNotConfiguredError } from "@/lib/ai/types";

const OPENAI: AiCredential = {
  provider: "openai",
  apiKey: "sk-test-byok",
  model: "gpt-test-1",
  baseUrl: "https://api.example.com/v1",
};

const OR_CRED: AiCredential = {
  provider: "openrouter",
  apiKey: "sk-or-test-123",
  model: "typesafe/jev-1.13",
};

describe("CredentialBoundAIProvider", () => {
  const provider = new CredentialBoundAIProvider(OPENAI);

  it("exposes a provider/model name", () => {
    expect(provider.name).toBe("openai/gpt-test-1");
  });

  it("parses a resume through the credential-bound provider", async () => {
    responder = (call) => routeBySystemPrompt(call.body);
    const r = await provider.parseResume(SAMPLE_RESUME);
    expect(r.name).toBe("Vishnu Vardhan");
    expect(r.skills).toContain("FastAPI");
    expect(r.experiences[0]?.company).toBe("Acme Corp");
    expect(calls.at(-1)?.headers["authorization"]).toBe("Bearer sk-test-byok");
  });

  it("sanitizes hallucinated salary values out", async () => {
    responder = (call) => routeBySystemPrompt(call.body);
    const r = await provider.analyzeJob(JOB_INPUT);
    expect(r.requiredSkills).toContain("Python");
    expect(r.salaryMin).toBe(60000);
    expect(r.salaryMax).toBe(90000);
    expect(r.remoteType).toBe("HYBRID");
  });

  it("generates bounded queries", async () => {
    responder = (call) => routeBySystemPrompt(call.body);
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
    responder = (call) => routeBySystemPrompt(call.body);
    const r = await provider.generateExplanation({
      jobTitle: "Python Backend Developer",
      company: "Alpha",
      matchSummary: {
        overall: 87,
        category: "STRONG",
        skillsScore: 92,
        experienceScore: 85,
        roleScore: 96,
        locationScore: 100,
        salaryScore: 90,
        employmentScore: 100,
      },
      matchingSkills: ["Python", "FastAPI"],
      missingSkills: ["AWS"],
      niceToHaveSkills: [],
      candidateSkills: ["Python", "FastAPI"],
    });
    expect(r).toContain("Python");
  });

  it("surfaces garbage JSON as a persistent error", async () => {
    responder = () => openAiOk("This is not JSON at all, sorry!");
    await expect(
      provider.generateSearchQueries({
        profileSummary: "x",
        desiredRoles: ["A"],
        skills: [],
        preferredLocations: [],
        experienceLevels: [],
      }),
    ).rejects.toThrow(/Search query generation failed/i);
  });
});

describe("getAIProvider facade", () => {
  it("throws AiNotConfiguredError when no credential is present", () => {
    expect(() => getAIProvider(null)).toThrow(AiNotConfiguredError);
  });

  it("wraps a credential in a CredentialBoundAIProvider", () => {
    expect(getAIProvider(OPENAI).name).toBe("openai/gpt-test-1");
  });

  it("maps the internal heuristic pseudo-provider to the offline engine", () => {
    expect(
      getAIProvider({ provider: "heuristic", apiKey: "local", model: "heuristic" }).name,
    ).toBe("heuristic");
  });
});

describe("HeuristicAIProvider (server-side offline engine)", () => {
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
    const r = await provider.analyzeJob({
      ...JOB_INPUT,
      salaryOriginal: null,
      description: "Python role.",
    });
    expect(r.salaryMin).toBeNull();
    expect(r.salaryMax).toBeNull();
  });
});

describe("Decision engines", () => {
  it("dev engine scores skill overlap and lists gaps", async () => {
    const engine = new HeuristicDecisionProvider();
    const r = await engine.evaluateJob(JOB_DECISION_INPUT);
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

describe("JevProvider (OpenRouter-only BYOK)", () => {
  it("hits the Decisions endpoint with the user's key and builds a result", async () => {
    responder = (call) => {
      if (call.url.includes("/api/alpha/decisions")) return decisionsOk();
      return new Response("{}", { status: 200 });
    };
    const engine = new JevProvider(OR_CRED);
    const r = await engine.evaluateJob(JOB_DECISION_INPUT);

    expect(calls.at(-1)?.url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(calls.at(-1)?.headers["authorization"]).toBe("Bearer sk-or-test-123");
    expect(r.category).toBe("STRONG");
    expect(r.decision).toBe("SHOW");
    expect(r.reasons.some((x) => x.includes("80%") && x.includes("surfacing"))).toBe(true);
    expect(r.subScores.skills).toBe(75);
  });

  it("falls back to the dev engine (labelled jev-fallback) on transport failure", async () => {
    responder = () => new Response("upstream down", { status: 503 });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const engine = new JevProvider(OR_CRED);
    const r = await engine.evaluateJob({
      job: {
        title: "Python Backend Developer",
        company: "Alpha",
        location: "Hyderabad, India",
        remoteType: "HYBRID",
        employmentType: "Full-time",
        requiredSkills: ["Python", "FastAPI"],
        preferredSkills: [],
        experienceRequirement: null,
        seniority: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: "USD",
      },
      candidate: {
        skills: ["Python"],
        experienceLevels: ["ENTRY"],
        seniority: null,
        yearsOfExperience: 1,
      },
      preferences: {
        desiredRoles: ["Python Developer"],
        workArrangement: "ANY",
        preferredLocations: [],
        locationFlexibility: "WORLDWIDE",
        willingToRelocate: false,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: "USD",
        employmentTypes: [],
        experienceLevels: ["ENTRY"],
        preferredCompanies: [],
        excludedCompanies: [],
        includeJobsWithoutSalary: true,
      },
    });
    expect(r.reasons.some((x) => x.startsWith("jev-fallback"))).toBe(true);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("[jev]"))).toBe(true);
    errSpy.mockRestore();
  });
});

describe("getDecisionProvider facade", () => {
  it("returns JEV only for OpenRouter credentials", () => {
    expect(
      getDecisionProvider({ provider: "openrouter", apiKey: "k", model: "typesafe/jev-1.13" }).name,
    ).toBe("jev");
    expect(
      getDecisionProvider({ provider: "openai", apiKey: "k", model: "gpt-4o-mini" }).name,
    ).toBe("heuristic-dev");
    expect(getDecisionProvider(null).name).toBe("heuristic-dev");
  });
});

describe("Transport resilience (BYOK)", () => {
  it("retries on 429 then succeeds", async () => {
    let attempts = 0;
    responder = (call) => {
      attempts++;
      if (attempts === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      return routeBySystemPrompt(call.body);
    };
    const provider = new CredentialBoundAIProvider(OPENAI);
    const r = await provider.generateSearchQueries({
      profileSummary: "x",
      desiredRoles: ["A"],
      skills: [],
      preferredLocations: [],
      experienceLevels: [],
    });
    expect(r.primary.length).toBeGreaterThan(0);
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("retries 5xx then succeeds", async () => {
    let attempts = 0;
    const before = calls.length;
    responder = (call) => {
      attempts++;
      if (attempts === 1) return new Response("upstream down", { status: 503 });
      return routeBySystemPrompt(call.body);
    };
    const provider = new CredentialBoundAIProvider(OPENAI);
    const r = await provider.generateSearchQueries({
      profileSummary: "x",
      desiredRoles: ["A"],
      skills: [],
      preferredLocations: [],
      experienceLevels: [],
    });
    expect(r.primary.length).toBeGreaterThan(0);
    expect(calls.length - before).toBeGreaterThanOrEqual(2);
  });

  it("fails fast on 4xx without burning retries", async () => {
    responder = () => new Response("bad key", { status: 401 });
    const provider = new CredentialBoundAIProvider(OPENAI);
    await expect(
      provider.generateSearchQueries({
        profileSummary: "x",
        desiredRoles: ["A"],
        skills: [],
        preferredLocations: [],
        experienceLevels: [],
      }),
    ).rejects.toThrow(/Search query generation failed/);
    expect(calls.length).toBe(1);
  });

  it("never leaks the API key in provider errors", async () => {
    const secret = "sk-super-secret-do-not-leak";
    responder = () => new Response("upstream exploded", { status: 500 });
    const provider = new CredentialBoundAIProvider({ ...OPENAI, apiKey: secret });
    try {
      await provider.generateSearchQueries({
        profileSummary: "x",
        desiredRoles: ["A"],
        skills: [],
        preferredLocations: [],
        experienceLevels: [],
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(secret);
    }
  });
});
