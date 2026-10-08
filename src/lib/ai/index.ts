"use server-only";

import type { AiCredential } from "./providers";
import type { AIProvider } from "./types";
import { AiNotConfiguredError } from "./types";
import { CredentialBoundAIProvider } from "./llm-provider";
import { HeuristicAIProvider } from "./heuristic-provider";

/**
 * AIProvider factory (BYOK).
 *
 * Credentials come from the client per request — there is no env key and no
 * process-wide singleton. Every call site must thread the credential through.
 *
 *  - null credential   → AiNotConfiguredError (AI features are blocked).
 *  - "heuristic"       → offline deterministic engine (scripts/tests only;
 *                        never reachable from HTTP — see credential-header.ts).
 *  - everything else   → CredentialBoundAIProvider (fresh per call).
 */
export function getAIProvider(credential: AiCredential | null): AIProvider {
  if (!credential) {
    throw new AiNotConfiguredError();
  }
  if (credential.provider === "heuristic") {
    return new HeuristicAIProvider();
  }
  return new CredentialBoundAIProvider(credential);
}

export type { AIProvider, JobAnalysisResult, ParsedResume, GeneratedQueries } from "./types";
export { AiNotConfiguredError, AIPersistentError } from "./types";
