/**
 * Central server-side configuration. Everything here is read on the server only —
 * never import this module from client components (it would leak secrets).
 */

const nonEmpty = (v: string | undefined) => (v && v.trim().length > 0 ? v.trim() : undefined);

export const config = {
  appMode: (process.env.APP_MODE ?? "development") as "development" | "production",

  auth: {
    secret: nonEmpty(process.env.AUTH_SECRET) ?? "dev-insecure-secret",
    cookieName: "jm_session",
    sessionTtlDays: 30,
  },

  ai: {
    provider: process.env.AI_PROVIDER ?? "heuristic", // "openrouter" | "heuristic"
    openRouterApiKey: nonEmpty(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free",
    /**
     * Ordered model chain. The first model that answers wins; when the primary
     * free model is rate-limited (429) or errors, we move down the chain
     * instead of failing the whole request. Gemma's free pool is shared and
     * throttles hard, so the chain is load-bearing, not decorative.
     */
    fallbackModels: (
      process.env.OPENROUTER_FALLBACK_MODELS ?? "stealth/space-bunny-alpha,qwen/qwen3.7-plus"
    )
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90_000),
    maxRetries: Number(process.env.AI_MAX_RETRIES ?? 2),
    /**
     * OpenRouter provider routing. Free models sit on a shared upstream pool
     * that 429s hard; when you attach your own provider key (BYOK) in the
     * OpenRouter settings, routing to that provider first gives you a private
     * quota. `OPENROUTER_PROVIDER_ORDER` is a comma list of provider slugs,
     * e.g. "Google AI Studio,Google Vertex"; `allowFallbacks` lets OpenRouter
     * drop down to the shared pool when your own key is busy.
     */
    providerOrder: (process.env.OPENROUTER_PROVIDER_ORDER ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    allowProviderFallbacks: process.env.OPENROUTER_PROVIDER_FALLBACKS !== "0",
    /** Ask for strict JSON where the endpoint advertises response_format support. */
    jsonMode: process.env.AI_JSON_MODE !== "0",
  },

  decision: {
    provider: process.env.DECISION_PROVIDER ?? "heuristic", // "jev" | "heuristic"
    jevModel: process.env.JEV_MODEL ?? "typesafe/jev-1.13",
    /** JEV is a decision model — it is served from the Decisions API, not chat completions. */
    decisionsUrl: "https://openrouter.ai/api/alpha/decisions",
    useOpenRouterForJev: nonEmpty(process.env.OPENROUTER_API_KEY) !== undefined,
  },

  sources: {
    linkedin: {
      clientId: nonEmpty(process.env.LINKEDIN_CLIENT_ID),
      clientSecret: nonEmpty(process.env.LINKEDIN_CLIENT_SECRET),
    },
    adzuna: {
      appId: nonEmpty(process.env.ADZUNA_APP_ID),
      apiKey: nonEmpty(process.env.ADZUNA_API_KEY),
    },
  },

  schedule: {
    cron: process.env.SEARCH_CRON ?? "0 7 * * *",
    timezone: process.env.SEARCH_TIMEZONE ?? "UTC",
  },

  limits: {
    maxResumeBytes: Number(process.env.MAX_RESUME_BYTES ?? 10 * 1024 * 1024),
    rateLimitWindowMs: 60_000,
    rateLimitMax: 60,
  },
} as const;

/** Non-secret public view of configuration, safe to send to the UI. */
export function publicConfig() {
  return {
    appMode: config.appMode,
    aiProvider: config.ai.provider,
    aiModel: config.ai.model,
    aiFallbackModels: config.ai.fallbackModels,
    aiProviderOrder: config.ai.providerOrder,
    aiAllowProviderFallbacks: config.ai.allowProviderFallbacks,
    aiJsonMode: config.ai.jsonMode,
    aiAvailable:
      config.ai.provider === "heuristic" || Boolean(config.ai.openRouterApiKey),
    decisionProvider: config.decision.provider,
    jevModel: config.decision.jevModel,
    jevConfigured: config.decision.provider === "jev" && Boolean(config.ai.openRouterApiKey),
    searchCron: config.schedule.cron,
    searchTimezone: config.schedule.timezone,
    maxResumeBytes: config.limits.maxResumeBytes,
    sources: {
      linkedin: Boolean(config.sources.linkedin.clientId),
      adzuna: Boolean(config.sources.adzuna.appId && config.sources.adzuna.apiKey),
    },
  };
}
