"use server-only";

import { getAIProvider } from "@/lib/ai";
import type { AiCredential } from "@/lib/ai/providers";
import { buildDecisionInputs } from "./profile-inputs";

/**
 * SearchQueryGenerator — AI query generation.
 *
 * With a credential: the user's model generates primary + related queries.
 * Without one: deterministic derivation from desired roles (the search can
 * still run — fetch/store don't need a key).
 */

export async function generateQueriesForUser(
  userId: string,
  credential: AiCredential | null,
): Promise<{
  primary: string[];
  related: string[];
  provider: string;
}> {
  const inputs = await buildDecisionInputs(userId);

  if (!credential) {
    return {
      primary: inputs.preferences.desiredRoles.slice(0, 4),
      related: [],
      provider: "deterministic",
    };
  }

  const ai = getAIProvider(credential);
  const result = await ai.generateSearchQueries({
    profileSummary: inputs.profileSummary,
    desiredRoles: inputs.preferences.desiredRoles,
    skills: inputs.candidateSkills,
    preferredLocations: inputs.preferences.preferredLocations,
    experienceLevels: inputs.preferences.experienceLevels,
  });
  return { primary: result.primary, related: result.related, provider: ai.name };
}
