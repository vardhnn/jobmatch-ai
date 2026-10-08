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
    /**
     * BYOK: the API key, model and endpoint come from the user's active
     * credential (sent per request from their browser vault). Only the
     * transport defaults live here.
     */
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90_000),
    maxRetries: Number(process.env.AI_MAX_RETRIES ?? 2),
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
    searchCron: config.schedule.cron,
    searchTimezone: config.schedule.timezone,
    maxResumeBytes: config.limits.maxResumeBytes,
    sources: {
      linkedin: Boolean(config.sources.linkedin.clientId),
      adzuna: Boolean(config.sources.adzuna.appId && config.sources.adzuna.apiKey),
    },
  };
}
