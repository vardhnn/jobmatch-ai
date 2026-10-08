/**
 * Live AI audit — hits the real chat-completions API of the configured
 * credential and (when it is an OpenRouter key) the real JEV Decisions API,
 * once per AI code path. Run with:
 *
 *   npx tsx scripts/ai-audit.ts --provider openrouter --model <id> --api-key <key> [--base-url <url>]
 *
 * This is deliberately separate from `npm run verify` (which runs the offline
 * heuristic engine for determinism) — it tells you what the live system is
 * really doing with your key.
 */

// Must be first: config.ts reads process.env at module load.
import "./load-env";

import { config } from "../src/lib/config";
import {
  chatJson,
  testCredential,
  validateCredential,
  type AiCredential,
} from "../src/lib/ai/providers";
import {
  callDecision,
  scoreAnswerToHundred,
} from "../src/lib/ai/decisions";
import { fetchFromSource } from "../src/lib/sources";
import type { RawJob } from "../src/lib/sources/types";
import type { AiTransportError } from "../src/lib/ai/providers";

type Err = AiTransportError;

function parseArgs(): AiCredential {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const provider = get("--provider");
  const apiKey = get("--api-key");
  const model = get("--model");
  const baseUrl = get("--base-url") ?? null;

  if (!provider || !apiKey || !model) {
    console.error(
      "Usage: npx tsx scripts/ai-audit.ts --provider <id> --model <model-id> --api-key <key> [--base-url <url>]",
    );
    console.error("Providers: openai | anthropic | gemini | groq | deepseek | mistral | together | fireworks | xai | ollama | lmstudio | custom-openai | openrouter");
    process.exit(1);
  }

  const credential: AiCredential = { provider: provider as AiCredential["provider"], apiKey, model, baseUrl };
  const problem = validateCredential(credential);
  if (problem) {
    console.error(`✗ invalid credential: ${problem}`);
    process.exit(1);
  }
  return credential;
}

const SAMPLE_JOB: RawJob = {
  sourceJobId: "audit-1",
  title: "Senior Backend Engineer (Python/FastAPI)",
  company: "AuditCo",
  location: "Bengaluru, India",
  workArrangement: "HYBRID",
  employmentType: "Full-time",
  experienceLevel: "Mid",
  description:
    "We are hiring a backend engineer to build APIs with Python 3.12, FastAPI, PostgreSQL and Redis. " +
    "Experience with Docker, Kubernetes and AWS is required. You will design distributed services, " +
    "write tests and participate in code review.",
  tags: ["python", "fastapi", "postgresql"],
  salaryMin: 2_000_000,
  salaryMax: 3_000_000,
  salaryCurrency: "INR",
  salaryPeriod: "ANNUAL",
  salaryOriginal: null,
  postedDate: null,
  applicationUrl: "https://example.invalid/job/1",
  directApply: true,
};

const CANDIDATE = {
  name: "Audit User",
  headline: "Backend engineer",
  summary: "Python/FastAPI backend engineer with Docker and PostgreSQL experience.",
  skills: ["Python", "FastAPI", "PostgreSQL", "Docker", "AWS"],
  totalExperienceYears: 5,
};

function line(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(22)} ${detail}`);
  return ok;
}

async function main() {
  const credential = parseArgs();

  console.log("\n════════════════════════════════════════");
  console.log(" JOBMATCH_AI — LIVE AI AUDIT (BYOK)");
  console.log("════════════════════════════════════════\n");
  console.log(`provider   : ${credential.provider}`);
  console.log(`model      : ${credential.model}`);
  console.log(`base url   : ${credential.baseUrl ?? "(preset default)"}\n`);

  let pass = 0;
  let fail = 0;
  const check = (ok: boolean, label: string, detail: string) => {
    if (ok) pass++;
    else fail++;
    return line(label, ok, detail);
  };

  // ── 0. Connection test ───────────────────────────────────
  console.log("CONNECTION");
  const probe = await testCredential(credential);
  check(probe.ok, "connection", probe.ok ? `${probe.latencyMs}ms` : (probe.error ?? "failed"));

  // ── 1. Chat completions (structured JSON) ───────────────────
  console.log("\nLANGUAGE MODEL");
  const paths: { label: string; system: string; user: string; judge: (v: Record<string, unknown>) => boolean }[] = [
    {
      label: "resume parse",
      system: 'Extract resume facts. Respond ONLY with JSON of the form {"skills": string[], "seniority": string}.',
      user:
        "Senior backend engineer. 6 years building Python 3.12 and FastAPI services " +
        "on PostgreSQL and Redis, deployed with Docker and AWS.",
      judge: (v) => Array.isArray(v.skills) && (v.skills as unknown[]).length > 0,
    },
    {
      label: "job analysis",
      system: 'Extract job requirements. Respond ONLY with JSON: {"title": string, "skills": string[]}.',
      user: SAMPLE_JOB.description ?? "",
      judge: (v) => typeof v.title === "string",
    },
    {
      label: "query generation",
      system: 'Suggest job search queries. Respond ONLY with JSON: {"queries": string[]} (3-5 short queries).',
      user: JSON.stringify(CANDIDATE),
      judge: (v) => Array.isArray(v.queries) && (v.queries as unknown[]).length > 0,
    },
    {
      label: "explanation",
      system: 'Explain a match in two sentences. Respond ONLY with JSON: {"explanation": string}.',
      user: `Candidate skills: ${CANDIDATE.skills.join(", ")}. Job: ${SAMPLE_JOB.title}. Match 82%.`,
      judge: (v) => typeof v.explanation === "string",
    },
  ];

  for (const p of paths) {
    try {
      const t0 = Date.now();
      const out = await chatJson<unknown>(credential, [
        { role: "system", content: p.system },
        { role: "user", content: p.user },
      ], { maxTokens: 400, timeoutMs: 45_000 });
      check(p.judge(out as Record<string, unknown>), p.label, `${Date.now() - t0}ms`);
    } catch (err) {
      const e = err as Err;
      check(false, p.label, `${e.code ?? "ERROR"}: ${e.message.slice(0, 90)}`);
    }
  }

  // ── 2. JEV Decisions API (OpenRouter keys only) ─────────────
  console.log("\nDECISION MODEL (JEV / Decisions API)");
  if (credential.provider !== "openrouter") {
    console.log("  - provider is not openrouter — the app uses the deterministic decision engine for this key.");
  } else {
    try {
      const t0 = Date.now();
      const result = await callDecision({
        credential,
        model: "typesafe/jev-1.13",
        state: { candidate: CANDIDATE, job: { title: SAMPLE_JOB.title, description: SAMPLE_JOB.description } },
        questions: [
          {
            id: "fitCategory",
            type: "choice",
            criteria: { STRONG: "Excellent fit", POTENTIAL: "Good fit", LOW: "Poor fit" },
            instructions: "Classify the overall fit between candidate and job.",
          },
          {
            id: "skillsMatch",
            type: "score",
            criteria: ["none", "some", "most", "all"],
            instructions: "How many required skills does the candidate have?",
          },
          {
            id: "worthShowing",
            type: "noul",
            criteria: { true: "Show to user", false: "Hide from user" },
            instructions: "Is this job worth showing the user?",
          },
        ],
      });

      const answers = result.answers ?? {};
      const skills = scoreAnswerToHundred(answers.skillsMatch, 4);
      const cat = answers.fitCategory?.choice;
      const probs = Object.entries(answers.fitCategory?.probabilities ?? {})
        .map(([k, v]) => `${k}:${(Number(v) * 100).toFixed(0)}%`)
        .join(" ");
      const noul = answers.worthShowing?.noul;

      check(Boolean(cat), "fit category", `choice=${cat ?? "—"} [${probs}]`);
      check(skills !== null, "skills score", skills !== null ? `${skills}/100` : "no numeric answer");
      check(typeof noul === "number", "noul (show?)", noul !== undefined ? noul.toFixed(3) : "—");
      check(
        Boolean(result.model) && (result.usage?.cost ?? 0) >= 0,
        "cost accounting",
        `${Date.now() - t0}ms · model=${result.model} · $${(result.usage?.cost ?? 0).toFixed(6)}`,
      );
    } catch (err) {
      const e = err as Err;
      check(false, "jev call", `${e.code ?? "ERROR"}: ${e.message.slice(0, 120)}`);
    }
  }

  // ── 3. Adzuna (multi-board) ─────────────────────────────────
  console.log("\nJOB SOURCES");
  if (config.sources.adzuna.appId && config.sources.adzuna.apiKey) {
    try {
      const t0 = Date.now();
      const res = await fetchFromSource("adzuna", {
        text: "python engineer",
        location: "Bangalore",
        remoteOnly: false,
      });
      if (res.error) {
        line("adzuna", false, `${res.error.code}: ${res.error.message}`);
        fail++;
      } else {
        check(res.jobs.length > 0, "adzuna", `${res.jobs.length} jobs in ${Date.now() - t0}ms`);
      }
    } catch (err) {
      check(false, "adzuna", err instanceof Error ? err.message.slice(0, 100) : String(err));
    }
  } else {
    console.log("  - adzuna: ADZUNA_APP_ID / ADZUNA_API_KEY not set (skipped)");
  }

  console.log("\n────────────────────────────────────────");
  console.log(` RESULT: ${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} (${pass} passed)`);
  console.log("────────────────────────────────────────\n");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
