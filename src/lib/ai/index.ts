"use server-only";

import { config } from "@/lib/config";
import type { AIProvider } from "./types";
import { AIPersistentError } from "./types";
import { OpenRouterAIProvider } from "./openrouter-provider";
import { HeuristicAIProvider } from "./heuristic-provider";

/**
 * Facade that picks the configured AIProvider and — for the OpenRouter
 * provider — degrades gracefully to the offline heuristic engine when the
 * API is unavailable/rate-limited. The rest of the app depends only on this.
 */
class FallbackAIProvider implements AIProvider {
  /** Name of the provider that produced the most recent result (for cache labels). */
  lastProviderName = "heuristic";

  constructor(
    private readonly primary: AIProvider,
    private readonly fallback: AIProvider,
  ) {}

  private async run<T>(fn: (p: AIProvider) => Promise<T>): Promise<T> {
    try {
      const result = await fn(this.primary);
      this.lastProviderName = this.primary.name;
      return result;
    } catch (err) {
      if (!(err instanceof AIPersistentError)) throw err;
      console.error(`[ai] ${err.message} — falling back to ${this.fallback.name}`);
      this.lastProviderName = this.fallback.name;
      return fn(this.fallback);
    }
  }

  get name(): string {
    return config.ai.provider === "heuristic" ? "heuristic" : "openrouter";
  }

  parseResume(text: string) {
    return this.run((p) => p.parseResume(text));
  }

  analyzeJob(job: Parameters<AIProvider["analyzeJob"]>[0]) {
    return this.run((p) => p.analyzeJob(job));
  }

  generateSearchQueries(input: Parameters<AIProvider["generateSearchQueries"]>[0]) {
    return this.run((p) => p.generateSearchQueries(input));
  }

  generateExplanation(input: Parameters<AIProvider["generateExplanation"]>[0]) {
    return this.run((p) => p.generateExplanation(input));
  }
}

let singleton: AIProvider & { lastProviderName?: string } | null = null;

export function getAIProvider(): AIProvider & { lastProviderName?: string } {
  if (!singleton) {
    if (config.ai.provider === "openrouter" && config.ai.openRouterApiKey) {
      singleton = new FallbackAIProvider(new OpenRouterAIProvider(), new HeuristicAIProvider());
    } else {
      singleton = new HeuristicAIProvider();
    }
  }
  return singleton;
}

export type { AIProvider, JobAnalysisResult, ParsedResume, GeneratedQueries } from "./types";
