"use server-only";

import type {
  DecisionInput,
  DecisionProvider,
  DecisionResult,
} from "./types";
import {
  callDecision,
  scoreAnswerToHundred,
  DEFAULT_JEV_MODEL,
  type DecisionAnswers,
} from "@/lib/ai/decisions";
import { AiTransportError, type AiCredential } from "@/lib/ai/providers";
import {
  scoreSkillMatch as heuristicSkillScore,
  evaluateExperience as heuristicExperience,
  evaluatePreferenceMatch as heuristicPreference,
} from "./heuristics";

/**
 * JEV decision provider — the real TypeSafe decision model, served through
 * OpenRouter's Decisions API (`/api/alpha/decisions`).
 *
 * JEV is the DECISION layer: it receives a `state` object plus typed questions
 * (choice / score / noul) and answers with probabilities. It never writes
 * prose — the chat model does that separately for the explanation.
 *
 * If the JEV call fails (network, rate limit, invalid output) we fall back to
 * the deterministic dev engine so a search never blocks on one bad call, and
 * the result is labelled honestly (`jev-fallback`).
 */

/** Fallback thresholds if env overrides are absent. */
const THRESHOLDS = { strong: 80, potential: 60 };

/** Five ordered levels shared by every score question → 0/25/50/75/100. */
const LEVELS = ["no fit", "weak fit", "partial fit", "strong fit", "exact fit"];

export class JevProvider implements DecisionProvider {
  readonly name = "jev";

  constructor(private readonly credential: AiCredential) {}

  async evaluateJob(input: DecisionInput): Promise<DecisionResult> {
    // The deterministic skill/preference math runs locally — it is cheap,
    // reproducible, and gives JEV a numeric backbone to adjust/confirm.
    const skills = heuristicSkillScore(
      input.candidate.skills,
      input.job.requiredSkills,
      input.job.preferredSkills,
    );
    const prefs = heuristicPreference(input.job, input.preferences);
    const experience = heuristicExperience(
      input.candidate,
      input.job.experienceRequirement,
      input.job.seniority,
    );

    try {
      const raw = await callDecision({
        questions: [
          {
            id: "fit",
            type: "choice",
            criteria: {
              STRONG: "The candidate is a strong match: most required skills present, seniority fits, and stated constraints are satisfied.",
              POTENTIAL: "The candidate is a plausible match with some real gaps or uncertainty, worth reviewing but not certain.",
              LOW: "The candidate does not fit: core requirements are missing, seniority is far off, or a stated constraint is violated.",
            },
            instructions:
              "Judge overall job fit for this candidate against this job description. Be strict and calibrated.",
          },
          {
            id: "overall",
            type: "score",
            criteria: LEVELS,
            instructions: "How well does this candidate fit this job overall?",
          },
          {
            id: "skills",
            type: "score",
            criteria: LEVELS,
            instructions:
              "Judge only the overlap between the candidate's skills and this job's required skills.",
          },
          {
            id: "experience",
            type: "score",
            criteria: LEVELS,
            instructions:
              "Judge only whether the candidate's years of experience and seniority match this role's requirement.",
          },
          {
            id: "role",
            type: "score",
            criteria: LEVELS,
            instructions:
              "Judge only whether this job's title/function is one the candidate is targeting.",
          },
          {
            id: "location",
            type: "score",
            criteria: LEVELS,
            instructions:
              "Judge only whether the job's location and work arrangement are acceptable to the candidate.",
          },
          {
            id: "salary",
            type: "score",
            criteria: LEVELS,
            instructions:
              "Judge only how the stated or expected pay compares with the candidate's expected range. If no pay is stated, answer neutral.",
          },
          {
            id: "employment",
            type: "score",
            criteria: LEVELS,
            instructions:
              "Judge only whether the employment type (full-time, contract, internship…) matches what the candidate wants.",
          },
          {
            id: "worth_showing",
            type: "noul",
            instructions:
              "Is this job worth putting in front of the candidate, given their stated preferences?",
            criteria: {
              true: "This job is worth putting in front of the candidate as a recommended match.",
              false: "This job should be filtered out — hard exclusion, clearly out of scope, or far below the candidate's level.",
            },
          },
        ],
        state: {
          candidate: input.candidate,
          job: input.job,
          preferences: input.preferences,
          thresholds: THRESHOLDS,
          deterministic_reference: {
            skills: skills.score,
            experience,
            role: prefs.role,
            location: prefs.location,
            salary: prefs.salary,
            employment: prefs.employment,
            note: "Local set arithmetic; use as calibration, not as the answer.",
          },
        },
        credential: this.credential,
        model: this.credential.model || DEFAULT_JEV_MODEL,
        timeoutMs: 60_000,
      });

      return this.build(raw.answers ?? {}, { skills, prefs, experience, input });
    } catch (err) {
      // Graceful degradation: fall back to the deterministic engine, but label
      // the result honestly so the UI can show "dev engine (JEV unavailable)".
      const detail = err instanceof AiTransportError ? `${err.code}: ${err.message}` : String(err);
      console.error(`[jev] JEV decision failed — using dev engine fallback: ${detail}`);
      return buildDeterministicDecision(
        { skills, prefs, experience, input },
        reasonsFallback(err),
        "jev-fallback",
      );
    }
  }

  private build(
    answers: DecisionAnswers,
    ctx: {
      skills: ReturnType<typeof heuristicSkillScore>;
      prefs: ReturnType<typeof heuristicPreference>;
      experience: number | null;
      input: DecisionInput;
    },
  ): DecisionResult {
    const { skills, prefs, experience, input } = ctx;

    const fitAnswer = answers.fit;
    const fitChoice = typeof fitAnswer?.choice === "string" ? fitAnswer.choice.toUpperCase() : "";
    const showAnswer = answers.worth_showing;
    const showProbability =
      typeof showAnswer?.noul === "number" && Number.isFinite(showAnswer.noul)
        ? showAnswer.noul
        : null;

    const subScores = {
      skills: scoreAnswerToHundred(answers.skills, LEVELS.length) ?? skills.score,
      experience: scoreAnswerToHundred(answers.experience, LEVELS.length) ?? experience,
      role: scoreAnswerToHundred(answers.role, LEVELS.length) ?? prefs.role,
      location: scoreAnswerToHundred(answers.location, LEVELS.length) ?? prefs.location,
      salary: scoreAnswerToHundred(answers.salary, LEVELS.length) ?? prefs.salary,
      employment: scoreAnswerToHundred(answers.employment, LEVELS.length) ?? prefs.employment,
    };

    // Weighted blend of the sub-scores JEV produced (nulls renormalized).
    const parts: [number, number][] = [];
    if (subScores.skills !== null) parts.push([subScores.skills, 0.35]);
    if (subScores.role !== null) parts.push([subScores.role, 0.25]);
    if (subScores.experience !== null) parts.push([subScores.experience, 0.15]);
    if (subScores.location !== null) parts.push([subScores.location, 0.1]);
    if (subScores.salary !== null) parts.push([subScores.salary, 0.1]);
    if (subScores.employment !== null) parts.push([subScores.employment, 0.05]);
    const weightSum = parts.reduce((a, [, w]) => a + w, 0) || 1;
    const blended = Math.round(parts.reduce((a, [s, w]) => a + s * w, 0) / weightSum);

    // JEV's own overall score wins when present; otherwise use the blend.
    const overall = scoreAnswerToHundred(answers.overall, LEVELS.length) ?? blended;

    const category: DecisionResult["category"] =
      fitChoice === "STRONG" || fitChoice === "POTENTIAL" || fitChoice === "LOW"
        ? fitChoice
        : overall >= THRESHOLDS.strong
          ? "STRONG"
          : overall >= THRESHOLDS.potential
            ? "POTENTIAL"
            : "LOW";

    // Show/hide: a hard exclusion always hides. JEV's noul answer only hides
    // when it is clearly against the job — a merely uncertain answer
    // (0.35–0.65) must not silently drop a 70+ fit from the user's list.
    const companyExcluded = input.preferences.excludedCompanies.some(
      (c) => c.trim().toLowerCase() === input.job.company.trim().toLowerCase(),
    );
    const clearlyNotWorthIt =
      showProbability !== null && showProbability < 0.35 && category !== "STRONG";
    const decision: DecisionResult["decision"] =
      companyExcluded || clearlyNotWorthIt ? "HIDE" : "SHOW";

    const reasons: string[] = [];
    if (companyExcluded) reasons.push("Company is on your excluded list");
    if (showProbability !== null) {
      reasons.push(
        `JEV rates this ${Math.round(showProbability * 100)}% worth surfacing to you`,
      );
    }
    if (skills.missing.length) {
      reasons.push(`Missing required skills: ${skills.missing.slice(0, 4).join(", ")}`);
    }
    if (!reasons.length) reasons.push("Requirements line up with your profile");

    return {
      overall,
      category,
      decision,
      subScores,
      matchingSkills: skills.matching,
      missingSkills: skills.missing,
      niceToHaveSkills: skills.niceToHave,
      reasons: reasons.slice(0, 6),
    };
  }

  scoreSkillMatch(candidateSkills: string[], requiredSkills: string[], preferredSkills: string[]) {
    return heuristicSkillScore(candidateSkills, requiredSkills, preferredSkills);
  }

  evaluateExperience(
    candidate: DecisionInput["candidate"],
    requirement: string | null,
    seniority: string | null,
  ) {
    return heuristicExperience(candidate, requirement, seniority);
  }

  evaluatePreferenceMatch(job: DecisionInput["job"], preferences: DecisionInput["preferences"]) {
    return heuristicPreference(job, preferences);
  }
}

function reasonsFallback(err: unknown): string[] {
  const code = err instanceof AiTransportError ? err.code : "UNKNOWN";
  return [`JEV unavailable (${code}) — dev engine decision used`];
}

type DetCtx = {
  skills: ReturnType<typeof heuristicSkillScore>;
  prefs: ReturnType<typeof heuristicPreference>;
  experience: number | null;
  input: DecisionInput;
};

/** Shared deterministic decision builder used by JEV-fallback and the dev engine. */
export function buildDeterministicDecision(
  ctx: DetCtx,
  extraReasons: string[],
  engineLabel: string,
): DecisionResult {
  const { skills, prefs, experience, input } = ctx;

  // Weights: skills 35%, role 25%, experience 15%, location 10%, salary 10%, employment 5%.
  // Null sub-scores are excluded and the remainder renormalized.
  const parts: [number, number][] = [];
  if (skills.score !== null) parts.push([skills.score, 0.35]);
  if (prefs.role !== null) parts.push([prefs.role, 0.25]);
  if (experience !== null) parts.push([experience, 0.15]);
  if (prefs.location !== null) parts.push([prefs.location, 0.1]);
  if (prefs.salary !== null) parts.push([prefs.salary, 0.1]);
  if (prefs.employment !== null) parts.push([prefs.employment, 0.05]);

  const weightSum = parts.reduce((a, [, w]) => a + w, 0) || 1;
  const overall = Math.round(parts.reduce((a, [s, w]) => a + s * w, 0) / weightSum);

  // Hard exclusion: excluded companies always hide.
  const companyExcluded = input.preferences.excludedCompanies.some(
    (c) => c.trim().toLowerCase() === input.job.company.trim().toLowerCase(),
  );

  const category: DecisionResult["category"] =
    overall >= THRESHOLDS.strong ? "STRONG" : overall >= THRESHOLDS.potential ? "POTENTIAL" : "LOW";

  const decision: DecisionResult["decision"] = companyExcluded ? "HIDE" : "SHOW";

  return {
    overall,
    category,
    decision,
    subScores: {
      skills: skills.score,
      experience,
      role: prefs.role,
      location: prefs.location,
      salary: prefs.salary,
      employment: prefs.employment,
    },
    matchingSkills: skills.matching,
    missingSkills: skills.missing,
    niceToHaveSkills: skills.niceToHave,
    reasons: [engineLabel, ...extraReasons],
  };
}
