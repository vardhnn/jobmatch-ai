"use server-only";

/**
 * OpenRouter Decisions API client (`/api/alpha/decisions`) — the transport for
 * the JEV decision model.
 *
 * JEV is a System One *decision* model: it is rejected by /chat/completions
 * with "use the /api/alpha/decisions endpoint instead". It takes a `state`
 * object plus typed `questions` (choice / score / noul) and answers with
 * probabilities — never prose. It is therefore only reachable when the user's
 * active BYOK credential is an OpenRouter key.
 */

import type { AiCredential } from "./providers";
import { AiTransportError } from "./providers";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/** Default decision model when the caller does not override it. */
export const DEFAULT_JEV_MODEL = "typesafe/jev-1.13";

export type DecisionQuestion =
  | { id: string; type: "choice"; criteria: Record<string, string>; instructions: string }
  | { id: string; type: "score"; criteria: string[]; instructions: string }
  | { id: string; type: "noul"; criteria?: { true: string; false: string }; instructions: string };

export type DecisionAnswers = Record<
  string,
  {
    type: string;
    choice?: string;
    probabilities?: Record<string, number>;
    confidence?: number;
    score?: number;
    legend?: Record<string, string>;
    noul?: number;
  }
>;

export type DecisionResultRaw = {
  answers?: DecisionAnswers;
  id?: string;
  model?: string;
  provider?: string;
  usage?: { cost?: number; input_tokens?: number; output_tokens?: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Decisions API and return the typed answers.
 * Retries transient failures (429/5xx/network) with backoff; 4xx fails fast.
 */
export async function callDecision({
  credential,
  questions,
  state,
  model,
  timeoutMs = 60_000,
  retries,
}: {
  credential: AiCredential;
  questions: DecisionQuestion[];
  state: unknown;
  model?: string;
  timeoutMs?: number;
  retries?: number;
}): Promise<DecisionResultRaw> {
  if (credential.provider !== "openrouter") {
    throw new AiTransportError(
      "The Decisions API (JEV) is OpenRouter-only.",
      "NOT_CONFIGURED",
    );
  }
  if (!credential.apiKey) {
    throw new AiTransportError("OpenRouter API key is not configured", "NO_KEY");
  }

  const payload = {
    model: model ?? DEFAULT_JEV_MODEL,
    // `questions` is a record keyed by question id — an array is rejected.
    questions: Object.fromEntries(questions.map(({ id, ...q }) => [id, q])),
    state,
  };

  const maxAttempts = Math.max(1, (retries ?? 2) + 1);
  let lastError: AiTransportError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(DECISIONS_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${credential.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "JobMatch AI",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        lastError = new AiTransportError("Rate limited by OpenRouter (429)", "RATE_LIMITED", 429);
        if (attempt < maxAttempts) {
          await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(20_000, 2 ** attempt * 1000));
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        lastError = new AiTransportError(
          `OpenRouter decisions error ${res.status}: ${bodyText.slice(0, 300) || res.statusText}`,
          "UPSTREAM_ERROR",
          res.status,
        );
        if (res.status >= 500 && attempt < maxAttempts) {
          await sleep(Math.min(10_000, 2 ** attempt * 750));
          continue;
        }
        throw lastError;
      }

      const data = (await res.json()) as DecisionResultRaw & {
        error?: { message?: string; code?: number };
      };
      if (data.error?.message) {
        throw new AiTransportError(
          `Decisions API error: ${data.error.message}`,
          "UPSTREAM_ERROR",
          data.error.code,
        );
      }
      if (!data.answers || typeof data.answers !== "object") {
        throw new AiTransportError("Decisions API returned no answers", "INVALID_RESPONSE");
      }
      return data;
    } catch (err) {
      if (err instanceof AiTransportError) {
        lastError = err;
        if (err.code !== "RATE_LIMITED" && err.code !== "UPSTREAM_ERROR") throw err;
        if (attempt >= maxAttempts) throw err;
        continue;
      }
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new AiTransportError(`Decisions request timed out after ${timeoutMs}ms`, "TIMEOUT");
        if (attempt >= maxAttempts) throw lastError;
        continue;
      }
      lastError = new AiTransportError(
        `Network failure calling the Decisions API: ${err instanceof Error ? err.message : String(err)}`,
        "NETWORK",
      );
      if (attempt >= maxAttempts) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new AiTransportError("Decisions call failed", "UPSTREAM_ERROR");
}

/** Probability-weighted expected value of a `score` answer, mapped to 0–100. */
export function scoreAnswerToHundred(
  answer: DecisionAnswers[string] | undefined,
  levels: number,
): number | null {
  if (!answer) return null;

  // Preferred: weighted mean of the per-level probabilities.
  const probs = answer.probabilities;
  if (probs && typeof probs === "object") {
    const entries = Object.entries(probs)
      .map(([k, v]) => [Number(k), Number(v)] as const)
      .filter(([i, p]) => Number.isFinite(i) && Number.isFinite(p));
    if (entries.length > 1 && levels > 1) {
      const total = entries.reduce((a, [, p]) => a + Math.max(0, p), 0);
      if (total > 0) {
        const expected =
          entries.reduce((a, [i, p]) => a + (i / (levels - 1)) * Math.max(0, p), 0) / total;
        return Math.max(0, Math.min(100, Math.round(expected * 100)));
      }
    }
  }

  // Fallback: the raw score is an index into the ordered criteria list.
  if (typeof answer.score === "number" && Number.isFinite(answer.score) && levels > 1) {
    const idx = Math.max(0, Math.min(levels - 1, answer.score));
    return Math.round((idx / (levels - 1)) * 100);
  }
  return null;
}
