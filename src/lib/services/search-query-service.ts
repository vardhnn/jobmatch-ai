"use server-only";

import { getAIProvider } from "@/lib/ai";
import { buildDecisionInputs } from "./profile-inputs";

/**
 * SearchQueryGenerator — AI query generation.
 * Falls back to deterministic derivation when AI is unavailable.
 * (Queries are regenerated per search run; per-run caching lives in SearchQuery rows.)
 */

export async function generateQueriesForUser(userId: string): Promise<{
  primary: string[];
  related: string[];
  provider: string;
}> {
  const inputs = await buildDecisionInputs(userId);

  const ai = getAIProvider();
  let primary: string[] = [];
  let related: string[] = [];
  let provider = ai.name;

  try {
    const result = await ai.generateSearchQueries({
      profileSummary: inputs.profileSummary,
      desiredRoles: inputs.preferences.desiredRoles,
      skills: inputs.candidateSkills,
      preferredLocations: inputs.preferences.preferredLocations,
      experienceLevels: inputs.preferences.experienceLevels,
    });
    primary = result.primary;
    related = result.related;
    provider = (ai as { lastProviderName?: string }).lastProviderName ?? ai.name;
  } catch {
    // Final deterministic fallback.
    provider = "deterministic";
    primary = inputs.preferences.desiredRoles.slice(0, 4);
    related = [];
  }

  return { primary, related, provider };
}
