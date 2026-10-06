"use server-only";

/**
 * Minimal OpenRouter client over the OpenAI-compatible chat-completions API.
 * Server-side only: the API key never leaves the server process.
 *
 * Handles: timeouts, rate limits (429), transient failures (5xx/network),
 * retries with backoff, and strict JSON response validation.
 */

import { config } from "@/lib/config";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Model that actually served the last successful call (for UI labels). */
let lastModelUsed: string | null = null;
export const lastServedModel = () => lastModelUsed;

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_KEY"
      | "RATE_LIMITED"
      | "TIMEOUT"
      | "UPSTREAM_ERROR"
      | "INVALID_RESPONSE"
      | "NETWORK",
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CallOptions = {
  /** Model override (defaults to config.ai.model). */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  /** Signals used for labeling/caching; does not change the request. */
  signal?: AbortSignal;
  /**
   * Force JSON mode on/off. Defaults to config.ai.jsonMode; endpoint support is
   * checked once per model and remembered.
   */
  jsonMode?: boolean;
};

export type CallResult = {
  content: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Endpoint capability cache: model id → does any endpoint advertise
 * `response_format`? Fetched at most once per model per process.
 */
const jsonModeSupport = new Map<string, boolean>();

async function jsonModeFor(model: string, override?: boolean): Promise<Record<string, unknown>> {
  const wanted = override ?? config.ai.jsonMode;
  if (!wanted) return {};

  let supported = jsonModeSupport.get(model);
  if (supported === undefined) {
    supported = false;
    try {
      const res = await fetch(`${OPENROUTER_BASE_URL}/models/${model}/endpoints`, {
        headers: { Authorization: `Bearer ${config.ai.openRouterApiKey}` },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          data?: { endpoints?: { supported_parameters?: string[] }[] };
        };
        supported = (data.data?.endpoints ?? []).some((e) =>
          (e.supported_parameters ?? []).includes("response_format"),
        );
      }
    } catch {
      supported = false;
    }
    jsonModeSupport.set(model, supported);
  }
  return supported ? { response_format: { type: "json_object" } } : {};
}

export type OpenRouterKeyStatus = {
  label: string;
  isFreeTier: boolean;
  limit: number | null;
  limitRemaining: number | null;
  usage: number | null;
  byokUsage: number | null;
  /** True when a BYOK (own-key) integration is accumulating usage. */
  byokActive: boolean;
  includeByokInLimit: boolean;
  expiresAt: string | null;
  error?: string;
};

/**
 * Inspect the configured OpenRouter key: quota, free-tier status and whether
 * BYOK is actually active. Surfaced on the Settings page so a throttled key
 * is diagnosable instead of mysterious.
 */
export async function getKeyStatus(): Promise<OpenRouterKeyStatus | null> {
  const apiKey = config.ai.openRouterApiKey;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        label: "unknown",
        isFreeTier: false,
        limit: null,
        limitRemaining: null,
        usage: null,
        byokUsage: null,
        byokActive: false,
        includeByokInLimit: false,
        expiresAt: null,
        error: `OpenRouter responded ${res.status}`,
      };
    }
    const { data } = (await res.json()) as {
      data: {
        label?: string;
        is_free_tier?: boolean;
        limit?: number | null;
        limit_remaining?: number | null;
        usage?: number;
        byok_usage?: number;
        include_byok_in_limit?: boolean;
        expires_at?: string | null;
      };
    };
    const byokUsage = data.byok_usage ?? 0;
    return {
      label: data.label ?? "unknown",
      isFreeTier: Boolean(data.is_free_tier),
      limit: data.limit ?? null,
      limitRemaining: data.limit_remaining ?? null,
      usage: data.usage ?? null,
      byokUsage,
      byokActive: byokUsage > 0,
      includeByokInLimit: Boolean(data.include_byok_in_limit),
      expiresAt: data.expires_at ?? null,
    };
  } catch (err) {
    return {
      label: "unknown",
      isFreeTier: false,
      limit: null,
      limitRemaining: null,
      usage: null,
      byokUsage: null,
      byokActive: false,
      includeByokInLimit: false,
      expiresAt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function callOpenRouter(messages: ChatMessage[], opts: CallOptions = {}): Promise<CallResult> {
  const c = config;
  const apiKey = c.ai.openRouterApiKey;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured", "NO_KEY");
  }

  const timeoutMs = opts.timeoutMs ?? c.ai.timeoutMs;
  const maxAttempts = Math.max(1, (opts.retries ?? c.ai.maxRetries) + 1);

  // Model chain: try the requested model first, then the configured fallbacks.
  // A free-model 429 or transient 5xx must not sink the whole request.
  const chain = Array.from(new Set([opts.model ?? c.ai.model, ...c.ai.fallbackModels]));
  const onlyModel = opts.model ? [opts.model] : chain;

  let lastError: OpenRouterError | null = null;

  for (const model of onlyModel) {
    // A 429 on a free model rarely clears within one call: when fallbacks are
    // available we move on after a single polite retry instead of stalling.
    const isLast = model === onlyModel[onlyModel.length - 1];
    const attempts = isLast ? maxAttempts : Math.min(maxAttempts, 2);
    try {
      const result = await callWithRetries(model, messages, opts, timeoutMs, attempts);
      lastModelUsed = result.model;
      return result;
    } catch (err) {
      lastError = err instanceof OpenRouterError ? err : new OpenRouterError(String(err), "UPSTREAM_ERROR");
      console.warn(`[openrouter] ${model} failed (${lastError.code}) — next model in the chain`);
    }
  }

  throw lastError ?? new OpenRouterError("OpenRouter call failed", "UPSTREAM_ERROR");
}

async function callWithRetries(
  model: string,
  messages: ChatMessage[],
  opts: CallOptions,
  timeoutMs: number,
  maxAttempts: number,
): Promise<CallResult> {
  const c = config;
  const apiKey = c.ai.openRouterApiKey!;
  let lastError: OpenRouterError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuterAbort, { once: true });

    try {
      const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // OpenRouter attribution headers (optional but recommended)
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "JobMatch AI",
        },
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 2048,
          messages,
          // Only set when the endpoint advertises response_format support —
          // Gemma on Google AI Studio does, many free proxies do not.
          ...(await jsonModeFor(model, opts.jsonMode)),
          // Provider routing: prefer a BYOK provider when one is configured,
          // then allow OpenRouter to fall back to the shared pool.
          ...(c.ai.providerOrder.length
            ? {
                provider: {
                  order: c.ai.providerOrder,
                  allow_fallbacks: c.ai.allowProviderFallbacks,
                },
              }
            : {}),
        }),
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 2 ** attempt * 1000);
        lastError = new OpenRouterError(
          `Rate limited by OpenRouter (429)`,
          "RATE_LIMITED",
          429,
        );
        if (attempt < maxAttempts) {
          await sleep(waitMs);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        // Retry transient upstream errors (5xx), fail fast on 4xx.
        const transient = res.status >= 500;
        lastError = new OpenRouterError(
          `OpenRouter error ${res.status}: ${bodyText.slice(0, 300) || res.statusText}`,
          "UPSTREAM_ERROR",
          res.status,
        );
        if (transient && attempt < maxAttempts) {
          await sleep(Math.min(15_000, 2 ** attempt * 750));
          continue;
        }
        throw lastError;
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[];
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        error?: { message?: string };
      };

      if (data.error?.message) {
        // OpenRouter can return 200 with an error envelope on model failures.
        lastError = new OpenRouterError(`OpenRouter model error: ${data.error.message}`, "UPSTREAM_ERROR");
        if (attempt < maxAttempts) {
          await sleep(Math.min(15_000, 2 ** attempt * 750));
          continue;
        }
        throw lastError;
      }

      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        // Reasoning models can spend the whole budget on thinking and return
        // nothing usable — treat it as retryable so the chain moves on.
        lastError = new OpenRouterError(
          "OpenRouter returned an empty/invalid completion",
          "INVALID_RESPONSE",
        );
        if (attempt < maxAttempts) continue;
        throw lastError;
      }

      return {
        content,
        model: data.model ?? model,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      };
    } catch (err) {
      if (err instanceof OpenRouterError) {
        lastError = err;
        if (err.code !== "RATE_LIMITED" && err.code !== "UPSTREAM_ERROR") throw err;
        // Non-retryable classification inside message already handled; fallthrough to retry loop end.
        if (attempt >= maxAttempts) throw err;
        continue;
      }
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new OpenRouterError(`OpenRouter request timed out after ${timeoutMs}ms`, "TIMEOUT");
        if (attempt >= maxAttempts) throw lastError;
        await sleep(Math.min(10_000, 2 ** attempt * 500));
        continue;
      }
      lastError = new OpenRouterError(
        `Network failure calling OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
        "NETWORK",
      );
      if (attempt >= maxAttempts) throw lastError;
      await sleep(Math.min(10_000, 2 ** attempt * 500));
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  throw lastError ?? new OpenRouterError("OpenRouter call failed", "UPSTREAM_ERROR");
}

/**
 * Call the model and parse a JSON object out of the response.
 * Free models often wrap JSON in prose or markdown fences; this tolerates that.
 */
export async function callJson<T>(messages: ChatMessage[], opts: CallOptions = {}): Promise<T> {
  const result = await callOpenRouter(messages, opts);
  return extractJson<T>(result.content);
}

export function extractJson<T>(raw: string): T {
  // 1) Direct parse
  try {
    return JSON.parse(raw) as T;
  } catch {
    /* fall through */
  }

  // 2) Fenced ```json ... ```
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {
      /* fall through */
    }
  }

  // 3) First {...} or [...] block
  const objStart = raw.indexOf("{");
  const arrStart = raw.indexOf("[");
  const start =
    objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  if (start !== -1) {
    const isObj = raw[start] === "{";
    const endChar = isObj ? "}" : "]";
    const end = raw.lastIndexOf(endChar);
    if (end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
  }

  throw new OpenRouterError("Model did not return valid JSON", "INVALID_RESPONSE");
}

/** Basic sanity validation helpers shared by the provider implementations. */
export function asStringArray(v: unknown, max = 60): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80)
    .slice(0, max);
}

export function asScore(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Bounded numeric extraction; returns null for non-finite/out-of-range input. */
export function asNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[,$\s]/g, "")) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n);
}

export function asNullableString(v: unknown, maxLen = 2000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
  return s.slice(0, maxLen);
}

// ─────────────────────────────────────────────────────────────
// OpenRouter Decisions API (`/api/alpha/decisions`)
//
// JEV (TypeSafe) is a System One *decision* model: it is rejected by
// /chat/completions with "use the /api/alpha/decisions endpoint instead".
// It takes a `state` object plus typed `questions` (choice / score / noul)
// and answers with probabilities — never prose.
// ─────────────────────────────────────────────────────────────

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

/**
 * Call the Decisions API and return the typed answers.
 * Retries transient failures (429/5xx/network) with backoff.
 */
export async function callDecision({
  questions,
  state,
  model,
  timeoutMs = 60_000,
  retries,
}: {
  questions: DecisionQuestion[];
  state: unknown;
  model?: string;
  timeoutMs?: number;
  retries?: number;
}): Promise<DecisionResultRaw> {
  const apiKey = config.ai.openRouterApiKey;
  if (!apiKey) throw new OpenRouterError("OPENROUTER_API_KEY is not configured", "NO_KEY");

  const payload = {
    model: model ?? config.decision.jevModel,
    // `questions` is a record keyed by question id — an array is rejected.
    questions: Object.fromEntries(questions.map(({ id, ...q }) => [id, q])),
    state,
  };

  const maxAttempts = Math.max(1, (retries ?? config.ai.maxRetries) + 1);
  let lastError: OpenRouterError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(config.decision.decisionsUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "JobMatch AI",
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        lastError = new OpenRouterError("Rate limited by OpenRouter (429)", "RATE_LIMITED", 429);
        if (attempt < maxAttempts) {
          await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(20_000, 2 ** attempt * 1000));
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        lastError = new OpenRouterError(
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
        throw new OpenRouterError(
          `Decisions API error: ${data.error.message}`,
          "UPSTREAM_ERROR",
          data.error.code,
        );
      }
      if (!data.answers || typeof data.answers !== "object") {
        throw new OpenRouterError("Decisions API returned no answers", "INVALID_RESPONSE");
      }
      lastModelUsed = data.model ?? payload.model;
      return data;
    } catch (err) {
      if (err instanceof OpenRouterError) {
        lastError = err;
        if (err.code !== "RATE_LIMITED" && err.code !== "UPSTREAM_ERROR") throw err;
        if (attempt >= maxAttempts) throw err;
        continue;
      }
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new OpenRouterError(`Decisions request timed out after ${timeoutMs}ms`, "TIMEOUT");
        if (attempt >= maxAttempts) throw lastError;
        continue;
      }
      lastError = new OpenRouterError(
        `Network failure calling the Decisions API: ${err instanceof Error ? err.message : String(err)}`,
        "NETWORK",
      );
      if (attempt >= maxAttempts) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new OpenRouterError("Decisions call failed", "UPSTREAM_ERROR");
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
