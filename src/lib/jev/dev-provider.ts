"use server-only";

import type { DecisionInput, DecisionProvider, DecisionResult } from "./types";
import {
  evaluateExperience as heuristicExperience,
  evaluatePreferenceMatch as heuristicPreference,
  scoreSkillMatch as heuristicSkillScore,
} from "./heuristics";
import { buildDeterministicDecision } from "./jev-provider";

/**
 * Development decision engine — NOT JEV.
 *
 * Same DecisionProvider interface as the JEV provider, fully deterministic,
 * zero network calls. Every result is labeled "heuristic-dev" so the UI can
 * honestly show which engine produced a decision.
 */
export class HeuristicDecisionProvider implements DecisionProvider {
  readonly name = "heuristic-dev";

  async evaluateJob(input: DecisionInput): Promise<DecisionResult> {
    const skills = heuristicSkillScore(
      input.candidate.skills,
      input.job.requiredSkills,
      input.job.preferredSkills,
    );
    const prefs = heuristicPreference(input.job, input.preferences);

    return buildDeterministicDecision(
      {
        skills,
        prefs,
        experience: heuristicExperience(
          input.candidate,
          input.job.experienceRequirement,
          input.job.seniority,
        ),
        input,
      },
      ["Dev decision engine (not JEV)"],
      "heuristic-dev",
    );
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
