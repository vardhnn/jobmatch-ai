# BYOK Intelligence Layer — Design Spec

Date: 2026-10-07
Status: Design approved in chat; this document records it.

## 1. Summary

Replace the env-var-driven, OpenRouter-only AI layer with **Bring Your Own Key (BYOK)**:

- API keys live **only in the user's browser** (localStorage) and travel to the server **per request** in a header. The server never persists or logs key material.
- Any model works: all major hosted providers plus **any custom OpenAI-compatible endpoint** (self-hosted vLLM, Ollama, LM Studio, gateways).
- **Settings → Intelligence Layer** becomes the key-management UI: save multiple provider profiles, switch the active one, test the connection.
- With **no key configured, AI features are blocked** (resume parsing, matching, explanations). Non-AI work (board fetch, job storage) still runs.
- The **JEV decision engine** stays available only when the active key is an OpenRouter key (it is served by OpenRouter's Decisions API); every other provider uses the existing deterministic decision engine, labeled honestly.

## 2. User-confirmed decisions

| Decision | Choice |
|---|---|
| Key storage | Browser localStorage (sent per request; not stored server-side) |
| JEV without an OpenRouter key | Fall back to the deterministic dev decision engine |
| No key at all | Block AI features; deterministic fetch/store still works |
| Profiles | Multiple saved, one active |

## 3. Architecture

### 3.1 Client key vault — `src/lib/client/ai-keys.ts` (new, browser-only)

- localStorage keys: `jm_ai_profiles` (JSON array), `jm_ai_active` (profile id).
- Profile shape: `{ id: string; label: string; provider: ProviderId; model: string; baseUrl?: string; apiKey: string; createdAt: string }`.
- API: `listProfiles()`, `getActiveProfile()`, `saveProfile(p)`, `deleteProfile(id)`, `setActiveProfile(id)`, `buildCredentialHeader()` (returns the `X-AI-Credential` header value or `null`).
- All functions guard on `typeof window` (SSR-safe no-ops return empty/null).

### 3.2 Provider registry + transport — `src/lib/ai/providers.ts` (new; absorbs `openrouter-client.ts`)

- `type ProviderId = "openrouter" | "openai" | "anthropic" | "gemini" | "groq" | "deepseek" | "mistral" | "together" | "fireworks" | "xai" | "ollama" | "lmstudio" | "custom-openai" | "heuristic"`.
  - `"heuristic"` is an internal, server-only pseudo-provider (offline deterministic engine used by scripts/tests). It is never shown in UI presets and **rejected** when parsed from a client header.
- `PROVIDER_PRESETS`: label, protocol (`"openai-compatible" | "anthropic" | "gemini"`), default base URL (https) where applicable, docs/key URL, placeholder model id.
  - OpenAI-compatible presets (default base URLs): openrouter `https://openrouter.ai/api/v1`, openai `https://api.openai.com/v1`, groq `https://api.groq.com/openai/v1`, deepseek `https://api.deepseek.com/v1`, mistral `https://api.mistral.ai/v1`, together `https://api.together.xyz/v1`, fireworks `https://api.fireworks.ai/inference/v1`, xai `https://api.x.ai/v1`, ollama `http://localhost:11434/v1`, lmstudio `http://localhost:1234/v1`, custom-openai (base URL required).
  - Anthropic: `https://api.anthropic.com/v1` (`/messages`). Gemini: `https://generativelanguage.googleapis.com/v1beta` (`/models/{model}:generateContent`).
- `AiCredential = { provider: ProviderId; apiKey: string; model: string; baseUrl?: string | null }`.
- `AiTransportError extends Error` with `code: "NO_KEY" | "NOT_CONFIGURED" | "RATE_LIMITED" | "TIMEOUT" | "UPSTREAM_ERROR" | "INVALID_RESPONSE" | "NETWORK"`.
- `chatJson<T>(credential, messages, opts?) → Promise<T>`: builds the provider-specific request, applies timeout/retry/backoff (429 honors `retry-after`; 5xx/network retried; 4xx fails fast), validates a non-empty completion, then `extractJson`.
  - openai-compatible: `POST {base}/chat/completions`, `Authorization: Bearer`, JSON-mode `response_format` attempted only when the endpoint advertised support (cached per model+base).
  - anthropic: `POST {base}/messages`, `x-api-key` + `anthropic-version: 2023-06-01`, system message promoted to the top-level `system` field; content parsed from `content[0].text`.
  - gemini: `POST {base}/models/{model}:generateContent` with `x-goog-api-key` header, system message → `systemInstruction`, messages → `contents`; text parsed from `candidates[0].content.parts[*].text` joined.
- `testCredential(credential) → { ok, latencyMs, model?, error? }`: one cheap real call ("reply with the single word OK" as JSON `{"ok":true}`), 15s timeout, no retries.
- Validation (used by header parsing and `/api/ai/test`): provider must be a known, non-internal id; `apiKey` 1–4096 chars; `model` 1–200 chars; `baseUrl` (when given) must be `http(s)://`, and must be loopback (localhost/127.0.0.1) if `http:`.
- Moved verbatim from `openrouter-client.ts`: `extractJson`, `asStringArray`, `asScore`, `asNumber`, `asNullableString`.

### 3.3 JEV Decisions client — `src/lib/ai/decisions.ts` (new)

- `callDecision({ credential, questions, state, model?, timeoutMs?, retries? })` — same payload/retry behavior as today, but authenticated with `credential.apiKey` (must be `provider: "openrouter"`; otherwise throws `AiTransportError("NOT_CONFIGURED")`).
- `scoreAnswerToHundred`, `DecisionQuestion`, `DecisionAnswers`, `DecisionResultRaw` move here unchanged.

### 3.4 Credential-bound LLM provider — `src/lib/ai/llm-provider.ts` (new)

- `class CredentialBoundAIProvider implements AIProvider` — constructor takes `AiCredential`; `name` = `` `${provider}/${model}` ``.
- `parseResume` / `analyzeJob` / `generateSearchQueries` / `generateExplanation` — **prompts and response validation moved verbatim** from `openrouter-provider.ts`, now calling `chatJson(credential, …)`.
- Errors surface as `AIPersistentError` (unchanged contract) — **no automatic heuristic fallback**; per-job failures are collected in run summaries as they are today.
- `src/lib/ai/openrouter-client.ts` and `src/lib/ai/openrouter-provider.ts` are **deleted**.

### 3.5 Facades — `src/lib/ai/index.ts`, `src/lib/jev/index.ts`

- `class AiNotConfiguredError extends Error` (in `ai/types.ts`).
- `getAIProvider(credential: AiCredential | null)`:
  - `credential == null` → throw `AiNotConfiguredError("No AI key configured — add one in Settings → Intelligence Layer.")`.
  - `credential.provider === "heuristic"` → `HeuristicAIProvider` (scripts/tests only).
  - otherwise → `new CredentialBoundAIProvider(credential)` (fresh per call; no singleton).
- `getDecisionProvider(credential: AiCredential | null)`:
  - `credential?.provider === "openrouter"` → `new JevProvider(credential)`.
  - otherwise → `new HeuristicDecisionProvider()` (dev engine; only reachable when analysis ran, which itself requires a credential).

### 3.6 HTTP contract

- Request header `X-AI-Credential`: base64(UTF-8 JSON) of `{ provider, apiKey, model, baseUrl? }`.
- `src/lib/ai/credential-header.ts` (server-only): `parseAiCredential(req: Request): AiCredential | null` — validates per §3.2; malformed/missing/internal-provider → `null` (never leaks why).
- `POST /api/search/run` — parses the header; `credential` may be `null` (search degrades, §3.7).
- `POST /api/resume/parse` — requires a valid credential; without one returns `403 { error: "AI_NOT_CONFIGURED", message: "Add your AI API key in Settings → Intelligence Layer." }`.
- `POST /api/ai/test` (new) — body `{ provider, apiKey, model, baseUrl? }`; rate-limited (10/min); returns `testCredential` result.

### 3.7 Pipeline threading

- `runSearchForUser(userId, trigger, credential?: AiCredential | null)`:
  - credential present → unchanged pipeline, with the credential threaded into query generation, analysis, matching.
  - credential null → stages 0–3 run (queries via deterministic fallback, fetch, dedupe, filters, **job storage**); stage 4 (analyze + match) is **skipped**; `summary.notes` gains `"AI matching skipped — no API key configured. Add one in Settings → Intelligence Layer."`; the run notification says matching was paused. Stored-but-unranked jobs are picked up later by the existing orphan-analysis path.
- `matchJobForUser(userId, jobId, credential)` and `analyzeJobCached(jobId, credential)` — credential required (callers guarantee it).
- Match cache invalidation: `inputHash` now also covers `credential.provider` and `credential.model`, so switching providers/models recomputes matches. Analysis cache stays content-addressed (extracted facts are provider-independent).
- Daily cron (`src/instrumentation.ts`): calls the pipeline with no credential → fetch/store only, matching skipped (localStorage keys are unavailable server-side; documented trade-off).

### 3.8 Config cleanup — `src/lib/config.ts`, `.env.example`

Removed: `ai.provider`, `ai.openRouterApiKey`, `ai.model`, `ai.fallbackModels`, `ai.providerOrder`, `ai.allowProviderFallbacks`, `ai.jsonMode`, `decision.*`; matching `.env.example` sections; `getKeyStatus()` / `OpenRouterKeyStatus`; `publicConfig()` drops all `ai*`/`decision*` fields.
Kept: `ai.timeoutMs`, `ai.maxRetries` (transport defaults), schedule, limits, sources, auth, appMode. The user's local `.env` is left untouched — old entries become inert. Job-board keys (Adzuna/LinkedIn) are unaffected.

### 3.9 UI

- **Settings → Intelligence Layer**: new client component `src/components/settings/intelligence-layer.tsx` — profile list (active badge, activate/delete), add/edit form (provider select, label, model, base URL for custom/local, masked API key), inline **Test connection** result, security note ("stored in this browser only"). The OpenRouter-account panel and `getKeyStatus` usage are removed.
- **Dashboard**: the Engines panel renders from the client's active profile (`PROVIDER · MODEL`, or "NO KEY — AI OFF" + Settings link). Run buttons show "CONFIGURE AI →" when no profile exists; `AI_NOT_CONFIGURED` responses render a friendly error.
- **Sources / Resume**: same no-key affordance on run/parse actions.
- **Landing page**: configuration panel reworded honestly for BYOK (no per-user claims on a public page).
- `/api/dashboard` no longer returns config-derived `engines`; the dashboard client derives engine display from localStorage.

### 3.10 Security notes

- Keys are never logged, never stored server-side, never echoed in error messages (transport errors redact request bodies).
- `parseAiCredential` rejects the internal `heuristic` provider so a client cannot select the offline engine over HTTP.
- `/api/ai/test` is rate-limited and requires an authenticated session.

### 3.11 Testing & verification

- `tests/byok-providers.test.ts` (new): three protocol adapters (request URL, auth header, body shape, response parsing) against a stubbed `fetch`; `extractJson`; credential validation; `parseAiCredential` accept/reject matrix; `testCredential` ok/error paths.
- `tests/ai-flow.test.ts`: rewritten for `CredentialBoundAIProvider` + explicit credentials; retry-on-429 and garbage-JSON resilience kept; heuristic + dev-engine tests unchanged.
- `tests/sources-and-decisions.test.ts`: import paths updated (`decisions.ts`).
- Full `npm run typecheck`, `npm run test`, `npm run lint`; live preview verification: no-key run stores jobs + note; key-saved UI state; `/api/ai/test` against a bogus key returns a clean error. Real-provider smoke testing requires the user's own key (by design).

## 4. Out of scope

- Server-side encrypted key storage (user chose localStorage).
- Chat-based replacement of the decision engine.
- Per-profile fallback model chains; provider-side usage/quota dashboards.

## 5. Known trade-off

The scheduled daily search runs server-side without any browser, so with localStorage keys it cannot match jobs — it fetches and stores, and the next user-triggered search matches everything (existing orphan path). Documented in the run summary and notification.
