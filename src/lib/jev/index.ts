"use server-only";

import { config } from "@/lib/config";
import type { DecisionProvider } from "./types";
import { JevProvider } from "./jev-provider";
import { HeuristicDecisionProvider } from "./dev-provider";

let singleton: DecisionProvider | null = null;

/**
 * Decision engine factory. "jev" runs the TypeSafeAI JEV model through
 * OpenRouter (with automatic dev-engine fallback on failure); "heuristic"
 * runs the labeled dev engine directly with no model calls.
 */
export function getDecisionProvider(): DecisionProvider {
  if (!singleton) {
    singleton =
      config.decision.provider === "jev" && config.ai.openRouterApiKey
        ? new JevProvider()
        : new HeuristicDecisionProvider();
  }
  return singleton;
}

export type { DecisionProvider, DecisionInput, DecisionResult } from "./types";
