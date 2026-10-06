# JobMatch AI

> An AI job hunter that understands you and finds jobs that actually fit.

Upload your resume, set your preferences, and JobMatch AI searches real job boards daily,
deduplicates across sources, extracts requirements, and scores every posting with an
explainable match breakdown.

## Tech

- **Next.js 16** (App Router) — React UI + JSON API (future Android clients reuse the same API)
- **SQLite + Prisma** — persistent storage, typed schema, migrations
- **Tailwind CSS v4** — retro-modern design system (cream paper / terminal green, plus a
  full dark theme driven by `<html data-theme>`)
- **node-cron** — daily scheduled search, registered in `src/instrumentation.ts`
- **vitest** — unit tests for pure logic

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Public landing page — hero, how-it-works, live engine + source status, CTA. Content is derived from real config and the session, so it never drifts from reality. |
| `/login` | Sign in / register |
| `/dashboard` | Setup checklist, run summary, ranked top matches, engine state |
| `/jobs`, `/jobs/[id]` | Ranked list (paginated, filterable) and the full match breakdown |
| `/resume` | Upload + AI-parse a resume |
| `/profile` | Edit the parsed profile |
| `/preferences` | Roles, locations, salary, arrangement, exclusions, freshness |
| `/sources` | Enable/disable job boards, edit search queries |
| `/notifications` | Daily run summaries and source problems |
| `/settings` | Model, engine, quota/BYOK, schedule, account — reachable from the account menu |

## Getting started

```bash
npm install
cp .env.example .env        # then edit values
npx prisma migrate dev      # create the SQLite database
npm run seed                # bootstrap your account
npm run dev                 # http://localhost:3000
```

Default seeded login (from `.env`): `you@example.com` / `jobmatch-dev-password`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Unit tests (vitest) |
| `npm run verify` | 8-stage end-to-end flow against the real engines |
| `npm run seed` | Create/refresh the bootstrap user + defaults |
| `npm run db:migrate` | Apply/create migrations |
| `npm run db:studio` | Prisma Studio |

## How matching works

Two different models, two different jobs:

| Layer | Model | Endpoint | Responsibility |
| --- | --- | --- | --- |
| **Decision** (JEV) | `typesafe/jev-1.13` | `POST /api/alpha/decisions` | Typed questions only: fit category, six weighted sub-scores, show/hide. Never writes prose. |
| **Language** | `OPENROUTER_MODEL` | `POST /api/v1/chat/completions` | Parses the resume, extracts job requirements, generates search queries, writes the explanation. |

JEV is a *decision* model — it is rejected by the chat-completions endpoint. It answers with
probabilities, which `scoreAnswerToHundred` maps onto the weighted 0–100 sub-scores
(skills 35%, role 25%, experience 15%, location 10%, salary 10%, employment 5%).

**Model fallback chain.** Free models throttle. When the primary model returns `429` or a
transient `5xx`, the client moves down `OPENROUTER_FALLBACK_MODELS`
(`stealth/space-bunny-alpha → qwen/qwen3.7-plus`) instead of failing the request. If every
model fails, the offline heuristic engine takes over and the UI says so honestly.

The primary language model is `google/gemma-4-26b-a4b-it:free`. Its free tier draws on a
shared upstream pool, so it returns `429` frequently — that is why the chain exists.

**BYOK / provider routing.** Free models throttle. Attach your own Google AI Studio key at
[openrouter.ai/settings/integrations](https://openrouter.ai/settings/integrations), then set
`OPENROUTER_PROVIDER_ORDER="Google AI Studio"` so requests prefer your private quota before the
shared pool. The Settings page reads `GET /api/v1/key` and shows whether BYOK is actually active,
your remaining quota and key expiry — so a throttled key is diagnosable instead of mysterious.

**Live AI audit.** `npm run audit:ai` exercises every AI path against the real APIs (key/quota,
resume parse, job analysis, query generation, explanation, all three JEV question types, and the
Adzuna source) and reports which model actually served each call. `npm run verify` is the
deterministic counterpart with the HTTP client mocked.

## Job sources

Every board is queried through its **public API** and normalized into one `RawJob` shape, so
scoring is identical no matter where a posting came from.

| Source | Key needed | Notes |
| --- | --- | --- |
| Remotive | no | Remote roles worldwide |
| Himalayas | no | Remote roles, salary on many listings |
| Jobicy | no | Remote roles; geo slugs from their `?get=locations` endpoint |
| RemoteOK | no | **Attribution required by their terms** — rendered on every job we show from it |
| The Muse | no | Strong on locations and levels |
| Arbeitnow | no | Europe-heavy; its API has no search, so filtering is client-side |
| Adzuna | `ADZUNA_APP_ID` + `ADZUNA_API_KEY` | Aggregates thousands of boards in one API. Free tier throttles hard, so the adapter retries with slow backoff. |
| ATS boards (Ashby / Lever / SmartRecruiters) | no | Employer-hosted boards — Paytm, Swiggy, Freshworks, Meesho, Cred, Mindtickle and more. First-party apply links and full descriptions. |
| LinkedIn | no | Reads the **unauthenticated public guest** endpoint. No cookies, no account, no bot-check evasion — if a challenge page appears the source says so and stands down. |

There are no fixture or sample boards: every listing in the app comes from a live endpoint.

**Indeed and Naukri are deliberately absent.** Both refuse server-side requests outright
(Indeed returns 403 with a captcha; Naukri redirects to its homepage), and working around that
means building detection-evasion. The same employers are reached instead through the ATS source
above, which is first-party and carries better data than an aggregator copy.

## Configuration

All secrets live in `.env` (never committed — see `.env.example` for documentation):

- `AUTH_SECRET` — session signing (`openssl rand -hex 32`)
- `OPENROUTER_API_KEY` — one key powers both the chat model and JEV
- `AI_PROVIDER` / `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODELS` — language model chain
- `DECISION_PROVIDER` / `JEV_MODEL` — decision model
- `ADZUNA_APP_ID` / `ADZUNA_API_KEY` — optional extra source
- `SEARCH_CRON` / `SEARCH_TIMEZONE` — daily schedule (`DISABLE_CRON=1` turns automation off)

## API

| Route | Purpose |
| --- | --- |
| `POST /api/search/run` | Full pipeline: query → sources → dedupe → analysis → JEV → summary |
| `GET /api/search/queries` | Queries used by the last run |
| `PATCH /api/search/queries` | Switch a query off/on (stays off across runs) |
| `POST /api/search/queries` | Add a custom query |
| `GET /api/jobs` | Matched jobs — paginated (`?limit=&offset=`), filterable by category, text, min score, hidden |
| `GET /api/jobs/[id]` | One job: description, sub-scores, skill overlap, explanation |
| `GET|PATCH /api/sources` | List / enable / disable job sources |
| `GET /api/dashboard` | Readiness, stats, top matches, run history, engine status |
| `GET|PATCH /api/notifications` | Search summaries, mark all read |
| `GET|PUT /api/preferences` | Job preferences (validated by `src/lib/preferences-schema.ts`) |

## Development mode

With `APP_MODE=development` self-registration is enabled, so a fresh install can be tried
without an invite. Every job source here reaches a real public endpoint — there are no
sample or fixture boards, so every listing in the app came from a live API.

## Principles

- No job-portal passwords are ever stored
- No scraping / CAPTCHA / rate-limit bypass — official APIs only
- AI and decision engines are pluggable with honest offline fallbacks
- AI calls are cached: resume parsed once, job analyzed once, match computed once per
  candidate+preferences hash
- Server secrets never reach the browser (`publicConfig()` is the only UI-safe export)

## Roadmap

Built: resume → profile → preferences → sources → daily search → AI analysis → JEV matching →
explainable dashboard → job details → notifications → scheduled runs → dark mode →
editable search queries → paginated job list.

Architecturally anticipated, not built: multi-user marketplace, application tracking,
auto-apply, Android client.
