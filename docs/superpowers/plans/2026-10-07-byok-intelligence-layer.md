# BYOK Intelligence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the env-key OpenRouter-only AI layer with per-user BYOK (localStorage keys sent per request) supporting all major providers plus custom OpenAI-compatible endpoints.

**Architecture:** Client key vault in localStorage → `X-AI-Credential` header on AI-touching POSTs → server-side credential-bound provider factory with three wire-protocol adapters (openai-compatible / anthropic / gemini). JEV stays OpenRouter-only; other providers use the deterministic dev engine. No key ⇒ AI blocked, fetch/store still runs.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma/SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-byok-intelligence-layer-design.md`

## Global Constraints

- Keys never persisted server-side, never logged, never echoed in errors (transport errors must not include request bodies).
- `"heuristic"` provider id is server-only: valid for `getAIProvider`, rejected by `parseAiCredential` and hidden from UI presets.
- `http://` base URLs only for loopback hosts (localhost / 127.0.0.1); everything else must be https.
- Prompts and response validation in `openrouter-provider.ts` move **verbatim** to the new provider (behavior must not drift).
- Match `inputHash` must include `credential.provider` and `credential.model` (recompute on switch); analysis cache stays content-hash keyed.
- Keep `AiTransportError` codes: `NO_KEY | NOT_CONFIGURED | RATE_LIMITED | TIMEOUT | UPSTREAM_ERROR | INVALID_RESPONSE | NETWORK`.
- No new runtime dependencies. No schema changes. Keep vitest/node environment.

## Review Focus

1. **Missing header on AI POSTs** → search must degrade to fetch/store-only with an explicit summary note, resume parse must 403 `AI_NOT_CONFIGURED` (test: header-parsing matrix + live check).
2. **Malformed/garbage credential header** → treated as absent, never a 500 (test: garbage b64, wrong shape, missing fields).
3. **Anthropic/Gemini request shapes** → system message promotion, auth header placement, response text extraction (tests: per-adapter shape assertions).
4. **Key leakage** → assert error messages from transport never contain the API key (test: failing call with a distinctive key).
5. **Model switch staleness** → `inputHash` covers provider+model so cached matches recompute (covered by code review + typecheck; no DB test harness exists).

---

### Task 1: Provider registry + transport (`src/lib/ai/providers.ts`)

**Files:**
- Create: `src/lib/ai/providers.ts`
- Test: `tests/byok-providers.test.ts`

**Interfaces:**
- Produces: `type ProviderId`, `type AiCredential`, `class AiTransportError`, `PROVIDER_PRESETS`, `getPreset(id)`, `validateCredential(c) → string | null`, `chatJson<T>(credential, messages, opts?) → Promise<T>`, `testCredential(c) → Promise<{ok, latencyMs, model?, error?}>`, `extractJson<T>(raw) → T`, `asStringArray/asScore/asNumber/asNullableString`.

- [ ] **Step 1: Write failing tests** — adapter request shapes (URL, auth header, body: system promotion for anthropic, systemInstruction/contents for gemini), response parsing for each shape, 429 retry then success, garbage JSON rejection, key-redaction on failure, `validateCredential` matrix (https rule, loopback http allowed, heuristic rejected is Task 3's concern), `extractJson` cases moved from `ai-flow.test.ts`.
- [ ] **Step 2: Run** `npx vitest run tests/byok-providers.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `providers.ts`. Port retry/backoff skeleton from `openrouter-client.ts::callWithRetries` (drop model-chain + provider-order machinery; single model per credential). Port `extractJson` + validation helpers verbatim.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: No commit** (repo policy: leave uncommitted).

### Task 2: JEV Decisions client (`src/lib/ai/decisions.ts`)

**Files:** Create `src/lib/ai/decisions.ts`; Modify test import in `tests/sources-and-decisions.test.ts`.

**Interfaces:**
- Produces: `callDecision({ credential, questions, state, model?, timeoutMs?, retries? }) → Promise<DecisionResultRaw>` (throws `AiTransportError("NOT_CONFIGURED")` when `credential.provider !== "openrouter"`), `scoreAnswerToHundred`, types `DecisionQuestion/DecisionAnswers/DecisionResultRaw`.

- [ ] **Step 1:** Move `callDecision`/`scoreAnswerToHundred`/types from `openrouter-client.ts`; replace `config.ai.openRouterApiKey` with `credential.apiKey`; drop model default from config (default `typesafe/jev-1.13` constant lives here).
- [ ] **Step 2:** Update import in `tests/sources-and-decisions.test.ts`; run → PASS.

### Task 3: Credential header parsing (`src/lib/ai/credential-header.ts`)

**Files:** Create `src/lib/ai/credential-header.ts`; add tests to `tests/byok-providers.test.ts`.

**Interfaces:**
- Produces: `parseAiCredential(req: Request): AiCredential | null` — reads `x-ai-credential` (base64 UTF-8 JSON), validates via `validateCredential`, rejects provider `"heuristic"` and unknown ids, returns `null` on anything invalid/absent.

- [ ] **Step 1: Failing tests** — valid credential round-trips; garbage b64 → null; `"heuristic"` → null; missing fields → null; `http://` non-loopback base → null.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.

### Task 4: Credential-bound LLM provider (`src/lib/ai/llm-provider.ts`)

**Files:** Create `src/lib/ai/llm-provider.ts`; Delete `src/lib/ai/openrouter-provider.ts` (after Task 8), `src/lib/ai/openrouter-client.ts` (after Task 2).

**Interfaces:**
- Consumes: `chatJson`, `AiTransportError`, validation helpers (Task 1); `AIProvider`/`AIPersistentError` from `./types`.
- Produces: `class CredentialBoundAIProvider { constructor(credential: AiCredential); readonly name: string /* `${provider}/${model}` */; parseResume; analyzeJob; generateSearchQueries; generateExplanation }`.

- [ ] **Step 1:** Move the four prompt builders + `validateParsedResume`/`validateJobAnalysis` verbatim from `openrouter-provider.ts`; each method calls `chatJson(this.credential, …)` with the same per-call options (`temperature`, `maxTokens`, `timeoutMs`); wrap errors into `AIPersistentError` exactly as today.
- [ ] **Step 2:** Port the mocked-fetch provider tests from `tests/ai-flow.test.ts` into the rewrite (Task 8 owns the full test-file rewrite; here, verify the new class compiles and one provider test passes against it).

### Task 5: Facades + types (`src/lib/ai/index.ts`, `src/lib/ai/types.ts`, `src/lib/jev/*`)

**Files:** Modify `src/lib/ai/types.ts`, `src/lib/ai/index.ts`, `src/lib/jev/index.ts`, `src/lib/jev/jev-provider.ts`.

**Interfaces:**
- Produces: `class AiNotConfiguredError` (types.ts); `getAIProvider(credential: AiCredential | null): AIProvider` (null → throw `AiNotConfiguredError`; `"heuristic"` → `HeuristicAIProvider`; else `CredentialBoundAIProvider`); `getDecisionProvider(credential: AiCredential | null): DecisionProvider` (`"openrouter"` → `new JevProvider(credential)`, else `HeuristicDecisionProvider`); `JevProvider` constructor takes `credential` and passes `credential.apiKey` into `callDecision`.

- [ ] **Step 1:** Add `AiNotConfiguredError` to `types.ts`; rewrite `ai/index.ts` (no singleton, no FallbackAIProvider); update `jev/index.ts` + `jev-provider.ts` (constructor-injected credential; drop `config` usage except `config.ai.maxRetries` defaults).
- [ ] **Step 2:** `npx tsc --noEmit` — expect errors ONLY in files later tasks fix (call sites still old-style).

### Task 6: Config cleanup (`src/lib/config.ts`, `.env.example`)

- [ ] **Step 1:** Remove `ai.provider/openRouterApiKey/model/fallbackModels/providerOrder/allowProviderFallbacks/jsonMode` and the whole `decision` block from `config`; keep `ai.timeoutMs/maxRetries`; drop the same from `publicConfig()`; delete `getKeyStatus` consumers by updating `scripts/ai-audit.ts` (Task 9).
- [ ] **Step 2:** Strip AI key/model sections from `.env.example`; keep DATABASE_URL, AUTH_SECRET, SEED_*, APP_MODE, schedule, MAX_RESUME_BYTES, job-board keys.

### Task 7: Services + routes threading

**Files:** Modify `src/lib/services/search-service.ts`, `job-matching-service.ts`, `search-query-service.ts`, `src/app/api/search/run/route.ts`, `src/app/api/resume/parse/route.ts`, `src/app/api/dashboard/route.ts`; Create `src/app/api/ai/test/route.ts`; Modify `src/instrumentation.ts`.

**Interfaces:**
- `generateQueriesForUser(userId, credential: AiCredential | null)` — null ⇒ deterministic derivation (desiredRoles), provider `"deterministic"`.
- `analyzeJobCached(jobId, credential: AiCredential)`; `matchJobForUser(userId, jobId, credential: AiCredential)`; `inputHash` adds `credential.provider`/`credential.model`.
- `runSearchForUser(userId, trigger, credential?: AiCredential | null)` — null ⇒ skip stage 4, push note `"AI matching skipped — no API key configured. Add one in Settings → Intelligence Layer."` to `summary.notes`, notification title mentions matching paused.
- `search/run` route: `const credential = parseAiCredential(req)` → pass through (may be null). `resume/parse` route: `if (!credential) return 403 AI_NOT_CONFIGURED`; `(ai as {lastProviderName?})` shims replaced by `ai.name`.
- `/api/ai/test` POST: `requireUser`, rateLimit 10/60s, body → `validateCredential` → 422 on invalid, else `testCredential` result.
- `instrumentation.ts` cron: `runSearchForUser(user.id, "SCHEDULED")` (no credential).

### Task 8: Client vault + UI

**Files:** Create `src/lib/client/ai-keys.ts`, `src/components/settings/intelligence-layer.tsx`; Modify `src/app/(app)/settings/page.tsx`, `dashboard/page.tsx`, `sources/page.tsx`, `resume/page.tsx`, `src/app/page.tsx`, `src/app/api/dashboard/route.ts`.

- [ ] `ai-keys.ts`: localStorage `jm_ai_profiles` / `jm_ai_active`; `listProfiles/getActiveProfile/saveProfile/deleteProfile/setActiveProfile/buildCredentialHeader` (window-guarded); presets re-exported read-only for the UI.
- [ ] `intelligence-layer.tsx` ("use client"): profile list + add/edit form (provider select, label, model, baseUrl for custom/ollama/lmstudio, masked key) + activate/delete + Test connection → `POST /api/ai/test`.
- [ ] `settings/page.tsx`: replace AI provider + OpenRouter-account panels with `<IntelligenceLayer />`; keep decision-copy minimal ("JEV when an OpenRouter key is active").
- [ ] `dashboard/page.tsx`: engines panel from `getActiveProfile()`; run button → "CONFIGURE AI →" when no profile; attach header via `buildCredentialHeader()` on `/api/search/run`; handle 403 AI_NOT_CONFIGURED. Same for `sources/page.tsx` and `resume/page.tsx` (parse).
- [ ] `api/dashboard/route.ts`: drop config-derived `engines` block. Landing `page.tsx`: reword configuration panel (BYOK copy, no per-user claims).

### Task 9: Scripts + test rewrite

**Files:** Modify `scripts/ai-audit.ts`, `scripts/verify-flow.ts`, `tests/ai-flow.test.ts`, `tests/sources-and-decisions.test.ts`.

- [ ] `ai-audit.ts`: read `--provider/--model/--api-key/--base-url` CLI flags (exit with usage if absent); use `chatJson`/`callDecision` with the credential; drop quota/BYOK section.
- [ ] `verify-flow.ts`: build `HEURISTIC_CREDENTIAL = { provider: "heuristic", apiKey: "local", model: "heuristic" }`; thread through `getAIProvider`/`matchJobForUser`/`analyzeJobCached`.
- [ ] `ai-flow.test.ts`: remove AI env vars; import from `providers`/`llm-provider`; credentials passed explicitly; add anthropic+gemini shape tests here or keep in `byok-providers.test.ts`; keep 429-retry + garbage tests with `CredentialBoundAIProvider`.
- [ ] Run full `npm run typecheck && npm run test && npm run lint` → all green.

### Task 10: Live verification

- [ ] Dev server: no-key flow (run search → jobs stored, note shown; resume parse → friendly block), Settings BYOK manager save/activate/test against a bogus key → clean provider error, dashboard engines panel reflects profile.
- [ ] Report: list verified behaviors + anything requiring the user's real key.
