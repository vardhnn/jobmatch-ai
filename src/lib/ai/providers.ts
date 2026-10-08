"use server-only";

/**
 * BYOK provider registry + transport.
 *
 * One module that knows how to talk to every supported LLM endpoint shape:
 *   - openai-compatible  (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together,
 *     Fireworks, xAI, Ollama, LM Studio, and any custom /chat/completions API)
 *   - anthropic          (native /v1/messages)
 *   - gemini             (native :generateContent)
 *
 * Credentials are caller-supplied (BYOK): they arrive per request from the
 * client's localStorage vault via the `X-AI-Credential` header and are used
 * in-memory only. Nothing here reads env vars for keys, logs key material, or
 * includes request bodies in error messages.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ProviderProtocol = "openai-compatible" | "anthropic" | "gemini";

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  protocol: ProviderProtocol;
  /** Default endpoint root; null when the user must supply one (custom/local with nonstandard port is still preset-known). */
  baseUrl: string | null;
  /** Where to get a key. */
  docsUrl: string;
  placeholderModel: string;
  /** Internal pseudo-providers are server-only and never exposed to clients. */
  internal?: boolean;
};

export type ProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "deepseek"
  | "mistral"
  | "together"
  | "fireworks"
  | "xai"
  | "ollama"
  | "lmstudio"
  | "custom-openai"
  | "heuristic";

export type AiCredential = {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
};

export class AiTransportError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_KEY"
      | "NOT_CONFIGURED"
      | "RATE_LIMITED"
      | "TIMEOUT"
      | "UPSTREAM_ERROR"
      | "INVALID_RESPONSE"
      | "NETWORK",
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiTransportError";
  }
}

// ── Registry ────────────────────────────────────────────────────────

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/keys",
    placeholderModel: "google/gemma-4-26b-a4b-it:free",
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/api-keys",
    placeholderModel: "gpt-4o-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    docsUrl: "https://console.anthropic.com/settings/keys",
    placeholderModel: "claude-sonnet-4-5",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    docsUrl: "https://aistudio.google.com/apikey",
    placeholderModel: "gemini-2.0-flash",
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    docsUrl: "https://console.groq.com/keys",
    placeholderModel: "llama-3.3-70b-versatile",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    docsUrl: "https://platform.deepseek.com/api_keys",
    placeholderModel: "deepseek-chat",
  },
  {
    id: "mistral",
    label: "Mistral",
    protocol: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    docsUrl: "https://console.mistral.ai/api-keys",
    placeholderModel: "mistral-large-latest",
  },
  {
    id: "together",
    label: "Together AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    docsUrl: "https://api.together.xyz/settings/api-keys",
    placeholderModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    docsUrl: "https://fireworks.ai/account/api-keys",
    placeholderModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    protocol: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    docsUrl: "https://console.x.ai",
    placeholderModel: "grok-3-mini",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    protocol: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    docsUrl: "https://ollama.com",
    placeholderModel: "llama3.1",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    protocol: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    docsUrl: "https://lmstudio.ai",
    placeholderModel: "local-model",
  },
  {
    id: "custom-openai",
    label: "Custom OpenAI-compatible",
    protocol: "openai-compatible",
    baseUrl: null,
    docsUrl: "",
    placeholderModel: "your-model-id",
  },
  {
    id: "heuristic",
    label: "Offline heuristic (internal)",
    protocol: "openai-compatible",
    baseUrl: null,
    docsUrl: "",
    placeholderModel: "heuristic",
    internal: true,
  },
];

const PRESET_BY_ID = new Map(PROVIDER_PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): ProviderPreset | null {
  return PRESET_BY_ID.get(id as ProviderId) ?? null;
}

// ── Validation ──────────────────────────────────────────────────────

const LOOPBACK_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i;

/** Returns a human-readable problem, or null when the credential is usable. */
export function validateCredential(c: AiCredential | null | undefined): string | null {
  if (!c || typeof c !== "object") return "Credential is missing.";
  const preset = getPreset(c.provider);
  if (!preset) return `Unknown provider "${String(c.provider)}".`;
  if (!preset.internal && typeof c.apiKey !== "string") return "API key is missing.";
  if (!preset.internal) {
    const key = c.apiKey?.trim() ?? "";
    if (!key) return "API key is required.";
    if (key.length > 4096) return "API key is too long.";
  }
  if (typeof c.model !== "string" || !c.model.trim() || c.model.length > 200) {
    return "Model id is required (max 200 characters).";
  }
  const base = c.baseUrl?.trim() || preset.baseUrl;
  if (!preset.internal) {
    if (preset.id === "custom-openai" && !base) {
      return "A base URL is required for custom OpenAI-compatible endpoints.";
    }
    if (base) {
      if (!/^https?:\/\//i.test(base)) return "Base URL must start with http(s)://.";
      if (/^http:\/\//i.test(base) && !LOOPBACK_RE.test(base)) {
        return "Base URL must use https:// (plain http is only allowed for localhost/127.0.0.1).";
      }
    }
  }
  return null;
}

/** Effective base URL: explicit override wins, then the preset default. */
function baseUrlFor(c: AiCredential): string | null {
  return c.baseUrl?.trim() || getPreset(c.provider)?.baseUrl || null;
}

// ── Shared JSON helpers (moved verbatim from openrouter-client.ts) ──

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

  throw new AiTransportError("Model did not return valid JSON", "INVALID_RESPONSE");
}

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

export function asNumber(v: unknown, min: number, max: number): number | null {
  const n =
    typeof v === "string" ? Number(v.replace(/[,$\s]/g, "")) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n);
}

export function asNullableString(v: unknown, maxLen = 2000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
  return s.slice(0, maxLen);
}

// ── Transport ───────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ChatCallOptions = {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  /** Force JSON mode on/off. openai-compatible only; defaults to auto. */
  jsonMode?: boolean;
};

/**
 * Endpoint capability cache: `${baseUrl}::${model}` → does the endpoint accept
 * `response_format`? Probed at most once per endpoint+model per process.
 */
const jsonModeSupport = new Map<string, boolean>();

async function jsonModeBody(
  c: AiCredential,
  opts: ChatCallOptions,
): Promise<Record<string, unknown>> {
  if (opts.jsonMode === false) return {};
  const base = baseUrlFor(c);
  if (!base) return {};
  const cacheKey = `${base}::${c.model}`;
  let supported = jsonModeSupport.get(cacheKey);
  if (supported === undefined) {
    // Optimistic default: most modern endpoints accept it; a 400 fallback
    // below remembers the failure for subsequent calls.
    supported = true;
    jsonModeSupport.set(cacheKey, supported);
  }
  return supported ? { response_format: { type: "json_object" } } : {};
}

function noteJsonModeUnsupported(c: AiCredential) {
  const base = baseUrlFor(c);
  if (base) jsonModeSupport.set(`${base}::${c.model}`, false);
}

/** Build provider-specific request pieces. Returns URL, headers and body. */
function buildRequest(
  c: AiCredential,
  messages: ChatMessage[],
  opts: ChatCallOptions,
  extraBody: Record<string, unknown>,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const preset = getPreset(c.provider);
  if (!preset) throw new AiTransportError(`Unknown provider "${c.provider}"`, "NOT_CONFIGURED");
  const base = baseUrlFor(c);
  if (!base) {
    throw new AiTransportError(`No base URL configured for ${preset.label}.`, "NOT_CONFIGURED");
  }

  if (preset.protocol === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    return {
      url: `${base.replace(/\/$/, "")}/messages`,
      headers: {
        "x-api-key": c.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: {
        model: c.model,
        system: system || undefined,
        messages: rest,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.2,
        ...extraBody,
      },
    };
  }

  if (preset.protocol === "gemini") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    return {
      url: `${base.replace(/\/$/, "")}/models/${encodeURIComponent(c.model)}:generateContent`,
      headers: { "x-goog-api-key": c.apiKey, "Content-Type": "application/json" },
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          temperature: opts.temperature ?? 0.2,
          maxOutputTokens: opts.maxTokens ?? 2048,
          ...extraBody,
        },
      },
    };
  }

  // openai-compatible (default)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${c.apiKey}`,
    "Content-Type": "application/json",
  };
  if (c.provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:3000";
    headers["X-Title"] = "JobMatch AI";
  }
  return {
    url: `${base.replace(/\/$/, "")}/chat/completions`,
    headers,
    body: {
      model: c.model,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 2048,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...extraBody,
    },
  };
}

/** Pull the assistant text out of a provider-specific success payload. */
function extractContent(c: AiCredential, payload: unknown): string {
  const p = payload as Record<string, unknown>;
  const preset = getPreset(c.provider);

  if (preset?.protocol === "anthropic") {
    const blocks = (p.content as { type?: string; text?: string }[] | undefined) ?? [];
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (!text.trim()) {
      throw new AiTransportError("Anthropic returned an empty completion", "INVALID_RESPONSE");
    }
    return text;
  }

  if (preset?.protocol === "gemini") {
    const candidates = (p.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined) ?? [];
    const text = (candidates[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    if (!text.trim()) {
      throw new AiTransportError("Gemini returned an empty completion", "INVALID_RESPONSE");
    }
    return text;
  }

  const choices = (p.choices as { message?: { content?: string } }[] | undefined) ?? [];
  const content = choices[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new AiTransportError(
      "Endpoint returned an empty/invalid completion",
      "INVALID_RESPONSE",
    );
  }
  return content;
}

async function executeCall(
  c: AiCredential,
  messages: ChatMessage[],
  opts: ChatCallOptions,
  extraBody: Record<string, unknown>,
): Promise<{ content: string; model: string | null }> {
  const { url, headers, body } = buildRequest(c, messages, opts, extraBody);
  const timeoutMs = opts.timeoutMs ?? 90_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
      // Never cache authenticated AI calls.
      cache: "no-store",
    });

    if (res.status === 429) {
      throw new AiTransportError(
        `Rate limited by ${getPreset(c.provider)?.label ?? c.provider} (429)`,
        "RATE_LIMITED",
        429,
      );
    }

    if (!res.ok) {
      // Body text is quoted only for short messages; long bodies are truncated
      // and a request body is NEVER included (key hygiene).
      const text = (await res.text().catch(() => "")).slice(0, 300);
      const transient = res.status >= 500;
      throw new AiTransportError(
        `${getPreset(c.provider)?.label ?? c.provider} error ${res.status}: ${text || res.statusText}`,
        // 5xx is retryable; 4xx (bad key, bad request) fails fast.
        transient ? "UPSTREAM_ERROR" : "UPSTREAM_ERROR",
        res.status,
      );
    }

    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload) {
      throw new AiTransportError("Endpoint returned a non-JSON response", "INVALID_RESPONSE");
    }
    const errMessage = (payload.error as { message?: string } | undefined)?.message;
    if (errMessage) {
      throw new AiTransportError(`Model error: ${errMessage}`, "UPSTREAM_ERROR");
    }

    return { content: extractContent(c, payload), model: (payload.model as string) ?? c.model };
  } catch (err) {
    if (err instanceof AiTransportError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new AiTransportError(`Request timed out after ${timeoutMs}ms`, "TIMEOUT");
    }
    throw new AiTransportError(
      `Network failure calling ${getPreset(c.provider)?.label ?? c.provider}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "NETWORK",
    );
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

const RETRYABLE = new Set(["RATE_LIMITED", "UPSTREAM_ERROR", "TIMEOUT", "NETWORK"]);

async function callWithRetries(
  c: AiCredential,
  messages: ChatMessage[],
  opts: ChatCallOptions,
): Promise<{ content: string; model: string | null }> {
  const maxAttempts = Math.max(1, (opts.retries ?? 2) + 1);
  let lastError: AiTransportError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const extra =
        getPreset(c.provider)?.protocol === "openai-compatible"
          ? await jsonModeBody(c, opts)
          : {};
      const out = await executeCall(c, messages, opts, extra);
      return out;
    } catch (err) {
      if (!(err instanceof AiTransportError)) throw err;
      lastError = err;

      // JSON mode rejected by an endpoint that doesn't support response_format:
      // remember it and retry once immediately without it.
      if (
        err.code === "UPSTREAM_ERROR" &&
        err.status === 400 &&
        getPreset(c.provider)?.protocol === "openai-compatible"
      ) {
        noteJsonModeUnsupported(c);
        try {
          return await executeCall(c, messages, opts, {});
        } catch (retryErr) {
          if (retryErr instanceof AiTransportError) {
            lastError = retryErr;
            if (!RETRYABLE.has(retryErr.code) || attempt >= maxAttempts) throw retryErr;
            await sleep(Math.min(10_000, 2 ** attempt * 500));
            continue;
          }
          throw retryErr;
        }
      }

      if (!RETRYABLE.has(err.code) || attempt >= maxAttempts) throw err;

      // 4xx client errors (bad key, malformed request) are never transient —
      // fail fast instead of burning retries against a rejected key.
      if (err.code === "UPSTREAM_ERROR" && err.status !== undefined && err.status < 500) throw err;

      if (err.code === "RATE_LIMITED") {
        // Honors a generous retry-after; 429 on a paid key usually clears fast.
        await sleep(Math.min(20_000, 2 ** attempt * 1000));
      } else {
        await sleep(Math.min(10_000, 2 ** attempt * 500));
      }
    }
  }

  throw lastError ?? new AiTransportError("Model call failed", "UPSTREAM_ERROR");
}

/**
 * Call the active model and parse a JSON object out of the response.
 * Models often wrap JSON in prose or markdown fences; extractJson tolerates that.
 */
export async function chatJson<T>(
  credential: AiCredential,
  messages: ChatMessage[],
  opts: ChatCallOptions = {},
): Promise<T> {
  const problem = validateCredential(credential);
  if (problem) throw new AiTransportError(problem, "NOT_CONFIGURED");
  const result = await callWithRetries(credential, messages, opts);
  return extractJson<T>(result.content);
}

// ── Connection test ─────────────────────────────────────────────────

export type CredentialTestResult = {
  ok: boolean;
  latencyMs: number;
  model?: string;
  error?: string;
};

/** One cheap real call to verify the credential works. No retries. */
export async function testCredential(c: AiCredential): Promise<CredentialTestResult> {
  const problem = validateCredential(c);
  if (problem) return { ok: false, latencyMs: 0, error: problem };

  const t0 = Date.now();
  try {
    const out = await chatJson<{ ok?: unknown }>(
      c,
      [
        {
          role: "system",
          content: "You are a connection probe. Reply with JSON only.",
        },
        { role: "user", content: 'Reply with exactly {"ok":true}' },
      ],
      { temperature: 0, maxTokens: 64, timeoutMs: 15_000, retries: 0 },
    );
    return { ok: true, latencyMs: Date.now() - t0, model: out?.ok === true ? c.model : c.model };
  } catch (err) {
    const message =
      err instanceof AiTransportError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, latencyMs: Date.now() - t0, error: message };
  }
}
