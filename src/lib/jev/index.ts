"use server-only";

import type { AiCredential } from "@/lib/ai/providers";
import type { DecisionProvider } from "./types";
import { JevProvider } from "./jev-provider";
import { HeuristicDecisionProvider } from "./dev-provider";

/**
 * Decision engine factory (BYOK).
 *
 * JEV is served from OpenRouter's Decisions API, so it runs only when the
 * user's active credential is an OpenRouter key. Every other provider (and
 * the no-credential case) gets the deterministic dev engine, labeled honestly.
 * Matching itself is only invoked when analysis ran, which already requires a
 * credential.
 */
export function getDecisionProvider(credential: AiCredential | null): DecisionProvider {
  if (credential?.provider === "openrouter") {
    return new JevProvider(credential);
  }
  return new HeuristicDecisionProvider();
}

export type { DecisionProvider, DecisionInput, DecisionResult } from "./types";
