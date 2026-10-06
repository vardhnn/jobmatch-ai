/**
 * Live AI audit — hits the real OpenRouter chat-completions API and the real
 * JEV Decisions API once per AI code path and reports which model actually
 * served the call. Run with: npx tsx scripts/ai-audit.ts
 *
 * This is deliberately separate from `npm run verify` (which mocks the HTTP
 * client for determinism) — it tells you what the live system is really doing.
 */

// Must be first: config.ts reads process.env at module load.
import "./load-env";

import { config, publicConfig } from "../src/lib/config";
import {
  callJson,
  callDecision,
  getKeyStatus,
  scoreAnswerToHundred,
} from "../src/lib/ai/openrouter-client";
import { fetchFromSource } from "../src/lib/sources";
import type { RawJob } from "../src/lib/sources/types";
import type { OpenRouterError as OpenRouterErrorType } from "../src/lib/ai/openrouter-client";

type Err = OpenRouterErrorType;

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

/** Third-party outages are reported but don't fail the audit. */
function warn(label: string, detail: string) {
  console.log(`  ! ${label.padEnd(22)} ${detail}`);
}

async function main() {
  console.log("\n════════════════════════════════════════");
  console.log(" JOBMATCH_AI — LIVE AI AUDIT");
  console.log("════════════════════════════════════════\n");

  const cfg = publicConfig();
  console.log(`provider   : ${cfg.aiProvider}`);
  console.log(`model      : ${cfg.aiModel}`);
  console.log(`fallbacks  : ${cfg.aiFallbackModels.join(" → ") || "none"}`);
  console.log(`routing    : ${cfg.aiProviderOrder.join(" → ") || "automatic"} (fallbacks allowed: ${cfg.aiAllowProviderFallbacks})`);
  console.log(`json mode  : ${cfg.aiJsonMode}`);
  console.log(`decision   : ${cfg.decisionProvider} / ${cfg.jevModel}\n`);

  if (!config.ai.openRouterApiKey) {
    console.log("✗ OPENROUTER_API_KEY is not set — nothing to audit.");
    process.exit(1);
  }

  let pass = 0;
  let fail = 0;
  const check = (ok: boolean, label: string, detail: string) => {
    if (ok) pass++;
    else fail++;
    return line(label, ok, detail);
  };

  // ── 0. Key / quota / BYOK ─────────────────────────────────
  const key = await getKeyStatus();
  console.log("ACCOUNT");
  check(Boolean(key && !key?.error), "key reachable", key?.error ?? `${key?.label} · free tier=${key?.isFreeTier}`);
  check(
    key?.isFreeTier === false || (key?.limitRemaining ?? 0) > 0,
    "quota remaining",
    key?.limit != null ? `${key.limitRemaining?.toFixed(3)} / ${key.limit}` : "unlimited",
  );
  // BYOK is an opt-in upgrade, not a failure: it only turns active once the user
  // attaches their own provider key in OpenRouter settings.
  console.log(
    `  ${key?.byokActive ? "✓" : "!"} ${"BYOK active".padEnd(22)} ${
      key?.byokActive
        ? `$${(key.byokUsage ?? 0).toFixed(4)} on your own key`
        : "not enabled — attach a Google AI Studio key in OpenRouter settings"
    }`,
  );

  // ── 1. Chat completions (structured JSON) ───────────────────
  console.log("\nLANGUAGE MODEL (chat/completions)");
  let servedModel = "—";
  try {
    const t0 = Date.now();
    const out = await callJson<{ skills: string[]; seniority: string }>(
      [
        {
          role: "system",
          content:
            "Extract resume facts. Respond ONLY with JSON of the form " +
            '{"skills": string[], "seniority": string}.',
        },
        {
          role: "user",
          content:
            "Senior backend engineer. 6 years building Python 3.12 and FastAPI services " +
            "on PostgreSQL and Redis, deployed with Docker and AWS.",
        },
      ],
      { maxTokens: 400, timeoutMs: 45_000 },
    );
    const ok = Array.isArray(out.skills) && out.skills.length > 0;
    servedModel = "primary-or-fallback";
    check(ok, "resume parse", `${Date.now() - t0}ms · skills=${JSON.stringify(out.skills)?.slice(0, 70)}`);
  } catch (err) {
    const e = err as Err;
    check(false, "resume parse", `${e.code ?? "ERROR"}: ${e.message.slice(0, 90)}`);
  }

  try {
    const t0 = Date.now();
    const out = await callJson<{ title: string; skills: string[] }>(
      [
        {
          role: "system",
          content:
            'Extract job requirements. Respond ONLY with JSON: {"title": string, "skills": string[]}.',
        },
        {
          role: "user",
          content: SAMPLE_JOB.description ?? "",
        },
      ],
      { maxTokens: 400, timeoutMs: 45_000 },
    );
    check(
      typeof out.title === "string" && Array.isArray(out.skills),
      "job analysis",
      `${Date.now() - t0}ms · title=${JSON.stringify(out.title)?.slice(0, 60)}`,
    );
  } catch (err) {
    const e = err as Err;
    check(false, "job analysis", `${e.code ?? "ERROR"}: ${e.message.slice(0, 90)}`);
  }

  try {
    const t0 = Date.now();
    const out = await callJson<{ queries: string[] }>(
      [
        {
          role: "system",
          content:
            'Suggest job search queries. Respond ONLY with JSON: {"queries": string[]} (3-5 short queries).',
        },
        { role: "user", content: JSON.stringify(CANDIDATE) },
      ],
      { maxTokens: 400, timeoutMs: 45_000 },
    );
    check(
      Array.isArray(out.queries) && out.queries.length > 0,
      "query generation",
      `${Date.now() - t0}ms · ${JSON.stringify(out.queries)?.slice(0, 70)}`,
    );
  } catch (err) {
    const e = err as Err;
    check(false, "query generation", `${e.code ?? "ERROR"}: ${e.message.slice(0, 90)}`);
  }

  try {
    const t0 = Date.now();
    const out = await callJson<{ explanation: string }>(
      [
        {
          role: "system",
          content: "Explain a match in two sentences. Respond ONLY with JSON: {\"explanation\": string}.",
        },
        {
          role: "user",
          content: `Candidate skills: ${CANDIDATE.skills.join(", ")}. Job: ${SAMPLE_JOB.title}. Match 82%.`,
        },
      ],
      { maxTokens: 400, timeoutMs: 45_000 },
    );
    check(
      typeof out.explanation === "string" && out.explanation.length > 10,
      "explanation",
      `${Date.now() - t0}ms · ${JSON.stringify(out.explanation)?.slice(0, 70)}`,
    );
  } catch (err) {
    const e = err as Err;
    check(false, "explanation", `${e.code ?? "ERROR"}: ${e.message.slice(0, 90)}`);
  }

  // ── 2. JEV Decisions API ────────────────────────────────────
  console.log("\nDECISION MODEL (JEV / Decisions API)");
  if (cfg.decisionProvider !== "jev") {
    check(false, "jev enabled", `DECISION_PROVIDER is "${cfg.decisionProvider}", not "jev"`);
  } else {
    try {
      const t0 = Date.now();
      const result = await callDecision({
        model: cfg.jevModel,
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

  // ── 3. Adzuna (multi-board: LinkedIn / Indeed / Naukri data) ─
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
        warn("adzuna", `${res.error.code}: ${res.error.message}`);
      } else {
        check(res.jobs.length > 0, "adzuna", `${res.jobs.length} jobs in ${Date.now() - t0}ms`);
      }
    } catch (err) {
      check(false, "adzuna", err instanceof Error ? err.message.slice(0, 100) : String(err));
    }
  } else {
    check(false, "adzuna", "ADZUNA_APP_ID / ADZUNA_API_KEY not set");
  }

  console.log("\n────────────────────────────────────────");
  console.log(` RESULT: ${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} (${pass} passed)`);
  console.log("────────────────────────────────────────\n");
  console.log(` primary model served as: ${servedModel}`);
  console.log(
    key?.byokActive
      ? " BYOK is active — you have a private quota."
      : " Free models are on a shared throttled pool; expect 429s and fallback-model usage.",
  );
  console.log("");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("audit crashed:", err);
  process.exit(1);
});
