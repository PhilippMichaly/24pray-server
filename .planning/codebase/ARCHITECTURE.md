---
last_mapped_commit: a09e3c06c1da2363a2db1774a9fc13e7c60a3839
last_mapped_at: 2026-10-26
---
<!-- refreshed: 2026-10-26 -->

# Architecture

**Analysis Date:** 2026-10-26

**Scope:** Two sibling repositories form the 24pray product:

| Repo | Local path | Git remote (verified `git remote -v`) | Role |
|------|-----------|----------------------------------------|------|
| API | `/home/pmi/24pray-api` | `github.com/PhilippMichaly/24pray-server.git` | Fastify 5 + SQLite backend (`24pray-api` on disk; remote is named **24pray-server**) |
| UI | `/home/pmi/24pray-web` | `github.com/PhilippMichaly/24pray-web.git` | Next.js 15 (App Router) frontend |

**Path convention in this document:** paths starting `24pray-api/` are relative to `/home/pmi/24pray-api`; paths starting `24pray-web/` are relative to `/home/pmi/24pray-web`. Both are sibling checkouts under `/home/pmi/`.

## System Overview

```text
                         ┌───────────── 24pray-web (Next.js, :3000) ─────────────┐
                         │  App Router — server components (SEO/SSR)              │
                         │  `[locale]` landing/watches/watch · robots · sitemap   │
                         │  client components: slot grid, globe, auth, push       │
                         │  `24pray-web/src/app` · `24pray-web/src/components`    │
                         ├──────────────┬─────────────────────────────────────────┤
                         │ api-server.ts│ api.ts (browser client)                 │
                         │ SSR, anonym  │ credentials:'include', NEXT_PUBLIC_API  │
                         └──────┬───────┴────────────────┬────────────────────────┘
                                │ API_URL_INTERNAL       │ NEXT_PUBLIC_API_URL
Browser ──HTTPS──▶ nginx ───────┼────────────────────────┼──▶ ┌───────────────────────┐
 24pray.org        /api/ strip  │   (dev: CORS, :3001)   │    │  24pray-api (Fastify) │
        │          prefix ──────┼────────────────────────┴───▶│  routes · plugins     │
        │                     │    (prod: same origin)        │  lib (mailer/push/    │
        ▼                     ▼                               │  jobs/access/…)       │
   Next.js :3000        Fastify :3001 ──Prisma──▶ SQLite `24pray.db` (WAL)           │
                                │                               └───────────────────────┘
                                └─▶ SMTP (magic links, reminders) · Web-Push (VAPID)
```

Two data paths exist browser→API:
- **Production:** one origin. The web build sets `NEXT_PUBLIC_API_URL=/api`; nginx maps `/api/` → Fastify with the prefix stripped (`24pray-api/deploy/nginx.conf`, `proxy_pass http://127.0.0.1:3001/`). No CORS.
- **Development:** the browser calls `http://localhost:3001` directly (`.env.local` default), cross-origin with credentials — the API answers CORS for `APP_URL` + `CORS_ORIGINS` only (`24pray-api/src/app.ts:48-49`). A fallback same-origin proxy also exists via the Next rewrite `24pray-web/next.config.mjs` (`/api/:path*` → `NEXT_PUBLIC_API_URL || http://localhost:3001`).

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `buildApp` | API composition root: Fastify plugins, error handler, route registration, DI wiring | `24pray-api/src/app.ts` |
| `main` | API process entry: env, DB URL, mailer/push, listen, jobs, SIGINT/SIGTERM | `24pray-api/src/server.ts` |
| `registerAuth` / `requireUser` | Session-cookie auth `preHandler` hook; `req.user`; 401 guard | `24pray-api/src/plugins/auth.ts` |
| Route modules (8) | auth, projects, slots, community, me, funnel, feedback, push endpoints | `24pray-api/src/routes/*.ts` |
| Domain libraries | mailer, push, tokens, access, slotGrid, projectView, calendar, jobs, adminNotify, unsubscribe | `24pray-api/src/lib/*.ts` |
| Prisma schema | 13 models, SQLite, FTS5 sidecar `city_fts` (raw SQL only) | `24pray-api/prisma/schema.prisma` |
| Root layout | `<html lang/dir>` from middleware headers, fonts, providers | `24pray-web/src/app/layout.tsx` |
| `middleware` | Locale resolution/redirects, localized-slug rewrites, `x-locale` headers | `24pray-web/src/middleware.ts` |
| `api.ts` (`ApiClient`) | Browser API client: fetch wrapper, cookies, JSON, error→`Error` | `24pray-web/src/lib/api.ts` |
| `api-server.ts` | SSR API access: anonymous, PUBLIC-only, 3s timeout, fail-soft | `24pray-web/src/lib/api-server.ts` |
| Slot grid (store+logic) | Zustand store, view-model builders, booking/cancel flow | `24pray-web/src/components/slots/store.ts`, `24pray-web/src/components/slots/logic.ts` |
| Wire-type mirror | Hand-maintained copies of API enums/views | `24pray-web/src/types/index.ts` |
| Service worker | Web-push only (no caching) | `24pray-web/public/sw.js` |

## Pattern Overview

**Overall:** Two-repo split — a modular-monolith JSON API (DI via plain functions) plus a server-first Next.js frontend that renders public pages for SEO and hydrates interactive islands (slot grid, globe, auth, push) as client components. Two deliberately separate API clients (browser vs SSR) encode two different trust levels.

**API key characteristics** (unchanged from prior analysis):
- Dependency injection via `BuildAppDeps` (`24pray-api/src/app.ts:20-29`); route modules are `(app, deps) => void` functions; fakes implement the same `Mailer`/`PushSender` interfaces in tests.
- Zod validation at the handler boundary; thrown `ZodError` → 400 in the global error handler (`24pray-api/src/app.ts:61-81`).
- Errors as `Error` objects with a `statusCode` property (local `httpError` helper per route file).
- Fire-and-forget side effects (mail, push, funnel) — never awaited, `.catch(console.error)`.
- SQLite pragmatism: partial unique indexes for atomicity (booking `P2002` → 409), single-statement `$executeRaw` for races, WAL mode.

**UI key characteristics:**
- App Router with server components for every indexable page: landing, watches list, watch detail fetch data via `api-server.ts` so crawlers see content in first HTML; interactive parts are `'use client'` islands receiving server-fetched data as props (e.g. `initialProject` in `24pray-web/src/app/[locale]/projects/[id]/page.tsx:33-38`).
- Client data fetching happens in `useEffect` (no SWR/React Query); auth state via `useAuth()` polling `/auth/me` once per mount (`24pray-web/src/hooks/use-auth.ts`).
- Local state: one Zustand store per concern (`useSlotGridStore` in `24pray-web/src/components/slots/store.ts:18-37`, `toast-store.ts`); cross-component locale via React context (`24pray-web/src/lib/locale-context.tsx`).
- i18n: 5 locales (de/en/es/he/ar), source-of-truth catalog in `24pray-web/src/lib/i18n.ts`, localized URL slugs in `24pray-web/src/lib/routes.ts`, RTL via `<html dir>`.
- German domain language in comments/user-facing strings (both repos); identifiers and API fields English.

## Layers

**UI — routing/SEO layer (`24pray-web/src/app/`, `24pray-web/src/middleware.ts`):**
- Purpose: URL schema, locale negotiation, metadata/JSON-LD, SSR data prefetch.
- Contains: `middleware.ts` (locale redirect/rewrite, header injection), `[locale]/` public pages, unprefixed app pages (`auth/`, `dashboard`, `profil`, `projects/new`, `join/`), `robots.ts`, `sitemap.ts`.
- Depends on: `lib/routes.ts`, `lib/i18n.ts`, `lib/seo.ts`, `lib/api-server.ts` (server side only).
- Used by: the browser/nginx only.

**UI — component layer (`24pray-web/src/components/`):**
- Purpose: `ui/` primitives (Button, Sheet, Toast, Tabs…), `patterns/` domain molecules (Globe, AppShell, InviteCard…), `slots/` the slot-grid heart (ChainBand, SlotList, SlotSheet, logic, store).
- Depends on: `lib/api.ts`, `lib/time.ts`, `lib/i18n.ts`, `types/`.
- Used by: app pages.

**UI — lib layer (`24pray-web/src/lib/`, `24pray-web/src/hooks/`):**
- Purpose: browser API client, SSR API client, funnel ping, push subscription, i18n catalog, route/slug map, SEO helpers, time formatting, cities autocomplete, share/anbieter/mylocation utilities.
- Depends on: nothing outside the repo (types mirrored by hand).
- Used by: components and server pages.

**API layers** (unchanged): entry/composition `24pray-api/src/server.ts`+`src/app.ts` → routes `24pray-api/src/routes/` → plugins `24pray-api/src/plugins/` + libs `24pray-api/src/lib/` + schemas `24pray-api/src/schemas/` → persistence `24pray-api/src/db.ts` + `prisma/`.

## Data Flow

### Browser → API request (the primary path)

1. Browser loads a page from Next (`24pray-web/src/app/…`), public content already SSR'd where applicable.
2. Client component calls a typed helper in `24pray-web/src/lib/api.ts` (e.g. `bookSlot`, `24pray-web/src/lib/api.ts:70-86`).
3. `ApiClient.request` fetches `${NEXT_PUBLIC_API_URL}${path}` with `credentials: 'include'` (httpOnly session cookie) and `Content-Type` only when a body exists (`24pray-web/src/lib/api.ts:16-23`).
4. Production: same-origin `/api/…` → nginx strips `/api/` → Fastify. Dev: cross-origin `:3001` → CORS preflight against the `APP_URL`/`CORS_ORIGINS` allowlist (`24pray-api/src/app.ts:48-49`).
5. Fastify `preHandler` resolves the session cookie into `req.user` (`24pray-api/src/plugins/auth.ts:24-41`); handler validates with zod, checks access (`24pray-api/src/lib/access.ts`), writes via Prisma.
6. Response: JSON or 204; non-2xx JSON `{message}` is thrown as an `Error` by the client and surfaced via toast/inline error in the UI (`24pray-web/src/lib/api.ts:25-28`).

### SSR prefetch path (SEO)

1. Server page (e.g. `24pray-web/src/app/[locale]/projects/[id]/page.tsx:33`) calls `fetchPublicProject(id)` (`24pray-web/src/lib/api-server.ts:38-43`).
2. `getJson` fetches `API_URL_INTERNAL ?? http://localhost:3001` anonymously with a 3s AbortController timeout and `next: { revalidate }`; any failure → `null` (page still renders, client re-fetches).
3. Hard rule enforced in code: only `visibility === 'PUBLIC'` data enters HTML/meta tags; PRIVATE/invite-gated content is loaded exclusively by the browser (with `?invite=` or session).

### Auth/session flow

1. `POST /auth/magic-link` (API `24pray-api/src/routes/auth.ts:22`) sends mail with `${APP_URL}/auth/verify?token=…`; the verify page (`24pray-web/src/app/auth/verify/page.tsx`) exchanges the token and receives the `session` cookie (httpOnly, sameSite lax, secure per `COOKIE_SECURE`).
2. All subsequent browser calls carry the cookie via `credentials: 'include'`.
3. UI auth state is derived per mount via `GET /auth/me` through `useAuth()` (`24pray-web/src/hooks/use-auth.ts`); there is no session store on the web server.
4. Guest flows carry secrets in the URL/headers instead: `?invite=` for PRIVATE projects, `X-Guest-Token` header for guest cancellation (`24pray-web/src/lib/api.ts:88-95`), HMAC-signed unsubscribe links rendered server-side by the API (`24pray-api/src/lib/unsubscribe.ts`).

### Web-push flow

1. UI: `enablePush()` (`24pray-web/src/lib/push.ts`) fetches `/push/vapid-key`, registers `public/sw.js`, subscribes, posts the subscription to `/me/push-subscriptions`.
2. API: `pushToUsers` (`24pray-api/src/lib/push.ts:50-64`) fans out; expired endpoints (404/410) are deleted; reminder/job and update fan-out use the same sender.

### Background jobs (API)

1. `startJobs` ticks immediately then every 60s (`24pray-api/src/lib/jobs.ts:157-184`); per tick: complete elapsed slots → send due reminders (mail + push) → hourly cleanup (sessions, magic tokens, inactive users, guest-email retention).
2. Started from `24pray-api/src/server.ts:21`; stopped before `app.close()` on SIGINT/SIGTERM.

**State Management:**
- Server: SQLite is the only durable store; in-memory only for `/stats/public` TTL cache, jobs overlap flag, and `req.user` decoration.
- Browser: Zustand stores (slot grid, toast) are ephemeral per page load; no cookies are written by the web app itself (locale travels via cookie + `x-locale` header, `24pray-web/src/middleware.ts:39-44`).

## Key Abstractions

**`ApiClient` (browser):**
- Purpose: single seam for all browser→API traffic; centralizes credentials, JSON handling, 204 handling, error extraction.
- Example: `24pray-web/src/lib/api.ts:3-57`; domain helpers (`bookSlot`, `cancelSlot`, `rotateInvite`, …) build on it in the same file.
- Pattern: one exported `api` instance; new endpoints get a typed helper here, not raw `fetch` in components.

**`api-server.ts` rules:**
- Purpose: SSR seam with a strictly smaller permission envelope than the browser client.
- Example: `24pray-web/src/lib/api-server.ts:1-61` — PUBLIC-only, anonymous, timeout, fail-soft (`null`/`[]`).
- Pattern: every new SSR fetch must re-assert PUBLIC filtering client-side even if the API filters (see `fetchPublicProjects`, line 48-52).

**`Mailer` / `PushSender` interfaces (API):**
- Purpose: outbound-channel seams; tests inject fakes; `createMailer` picks console-dev vs nodemailer-SMTP by `SMTP_URL` (`24pray-api/src/lib/mailer.ts:234-266`); `createPushSender` returns `null` when VAPID is unconfigured (fail-closed → routes 404).

**Route module factory (API):** `xRoutes(app, deps)` registered once in `24pray-api/src/app.ts:83-92`.

**View serializers (API):** `toProjectWithStats` / `buildSlotGrid` (`24pray-api/src/lib/projectView.ts`, `24pray-api/src/lib/slotGrid.ts`) decouple Prisma models from wire format (ISO strings, masked names, batched stats).

**`Env` zod schema (API):** `24pray-api/src/env.ts:7-61` — single validated config; `superRefine` encodes deployment rules (e.g. `DEV_LOGIN_RESPONSE` local-only). Web config is not validated: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, optional `API_URL_INTERNAL` (`24pray-web/.env.example`, read at `24pray-web/src/lib/api.ts:1` and `24pray-web/src/lib/api-server.ts:16-18`).

**Wire-type mirror (UI):** `24pray-web/src/types/index.ts` — hand-maintained enums (`Role`, `SlotStatus`, …) and view interfaces (`SlotView`, `ProjectWithStats`, …) copied from the API responses; there is no shared package or codegen.

## Entry Points

**`24pray-api/src/server.ts`:**
- Triggers: `npm run dev` (tsx watch), `npm start` (`dist/server.js`), Docker `CMD ["./docker-entrypoint.sh"]` → migrations → `node dist/server.js` (`24pray-api/deploy/docker-entrypoint.sh:11-13`).
- Responsibilities: mkdir `DATA_DIR`, SQLite URL `file:<DATA_DIR>/24pray.db`, infra construction, `buildApp`, listen on `HOST:PORT` (default `127.0.0.1:3001`), `startJobs`, graceful shutdown.

**`buildApp` (API, programmatic/tests):**
- Location: `24pray-api/src/app.ts:31`. Used by `src/server.ts` and every API test via `app.inject`.

**Next.js server (`24pray-web`):**
- Triggers: `npm run dev` (`next dev`, :3000), `npm start` (`next start`), production systemd unit `24pray-web` (see runbook `24pray-api/deploy/README.md`).
- Responsibilities: render app routes, proxy `/api/*` via `next.config.mjs` rewrites when hit through Next, serve `public/` (sw.js, manifest, earth textures).

**`scripts/import-cities.ts` (API repo, one-off):** `npm run import:cities -- <cities500.txt>` — bulk GeoNames import for `/geocode`.

**Prisma CLI:** `npm run migrate:dev` / `migrate:deploy` (API repo); tests apply migrations via `makeTestDb` (`24pray-api/src/test/helpers.ts:14-20`).

## CORS / Auth Boundaries

- **Same-origin production:** browser sees only `https://24pray.org`; `/api/` is proxied by nginx (prefix stripped). CORS is irrelevant there; the API still runs its cors plugin (allowlist `APP_URL` + `CORS_ORIGINS`, `credentials: true`, `24pray-api/src/app.ts:48-49`) for dev/preview origins.
- **Cross-origin development:** browser origin `http://localhost:3000` calls `http://localhost:3001` with credentials. This works only because the API allowlists `APP_URL` (set to the web origin in dev) and the session cookie is `SameSite=lax` (same-site across ports).
- **Session cookie boundary:** set exclusively by the API (`24pray-api/src/routes/auth.ts:109-111`), read by the API only; the web server never touches it (SSR is anonymous by design).
- **Secret-carrying URLs:** magic-link tokens (one-time, 15 min), `?invite=` project tokens, guest cancel tokens (`X-Guest-Token` header preferred over query), HMAC unsubscribe links. All are verified server-side with `safeEqual`/HMAC (`24pray-api/src/lib/tokens.ts`, `24pray-api/src/lib/unsubscribe.ts`).
- **Trust boundary for client IPs:** API `trustProxy` trusts only loopback (`24pray-api/src/app.ts:45`); rate limits and admin logic depend on nginx forwarding `X-Forwarded-For` (`24pray-api/deploy/nginx.conf`).

## Build / Deployment Relationship

- **Two independent build pipelines:** API compiles with `tsc` to `dist/` (`24pray-api/tsconfig.json`, `rootDir: src`); UI builds with `next build` (no emit, `.next/` output, `24pray-web/tsconfig.json`). No shared build tooling, no monorepo config, two lockfiles.
- **Docker:** only the API is containerized (`24pray-api/Dockerfile`, multi-stage, runs migrations in the entrypoint). The UI ships as source → `next build` on the host per the runbook.
- **Production host (per runbook `24pray-api/deploy/README.md`):** single VPS, nginx serves TLS and routes `/` → Next (`127.0.0.1:3000`, systemd `24pray-web`) and `/api/` → Fastify (`127.0.0.1:3001`, systemd `24pray-api`); SQLite at `/opt/24pray/data/24pray.db`; mail via Strato SMTP. nginx config and systemd units live in the **API repo** (`24pray-api/deploy/nginx.conf`, `24pray-api/deploy/24pray-api.service`); the runbook there covers **both** products.
- **Env coupling:** the web build bakes `NEXT_PUBLIC_API_URL=/api` (CI builds with it too, `24pray-web/.github/workflows/ci.yml:37-39`); the API needs `APP_URL` (public origin for mailed links + CORS) and `CORS_ORIGINS` for previews. SSR base is runtime-only (`API_URL_INTERNAL`), not baked.
- **CI:** two GitHub Actions workflows (`.github/workflows/ci.yml` in each repo), both node 22 + `npm ci` + `tsc --noEmit` + `vitest run`; the UI pipeline additionally runs `next lint` and `next build`. The UI workflow builds with `NEXT_PUBLIC_API_URL: /api` and needs no secrets.
- **PWA:** `24pray-web/public/manifest.webmanifest` + `sw.js` (push-only service worker, no offline caching).

## Architectural Constraints

- **Threading (API):** single Node event loop; jobs share the loop (overlap guard, bounded scans, hourly cleanup — `24pray-web` has no equivalent background work; its "jobs" are per-request renders).
- **Global state:** API `export const env` singleton (`24pray-api/src/env.ts:69`), `statsCache`, jobs flags, `req.user`; UI has no module-level server state except Next fetch cache/revalidate windows.
- **Circular imports:** none in the API (only cross-route import: `24pray-api/src/routes/slots.ts:13` → `bumpFunnel` from `funnel.ts`; keep one-directional). UI import graph is component→lib, pages→components/lib; keep it that way.
- **Raw SQL islands (API):** atomic attempt reservation (`24pray-api/src/routes/auth.ts:141-145`), two-phase shift with collision-avoiding `OFFSET` (`24pray-api/src/routes/projects.ts:243-262`), FTS5 `city_fts` (`24pray-api/src/routes/community.ts:325-336`), cumulative-hours join (`24pray-api/src/routes/community.ts:238-244`).
- **Rate limiting (API):** `global: false`; every public mutation sets its own `config.rateLimit`; test-only `disableWriteRateLimits` (`24pray-api/src/app.ts:53-59`, `:26-28`).
- **Fail-closed features (API):** unconfigured features answer 404, never 401/403 (feedback/funnel/push).
- **Reverse-proxy assumption (API):** default bind `127.0.0.1`; containers set `HOST=0.0.0.0` (`24pray-api/Dockerfile:25`); `trustProxy` loopback-only.
- **URL-schema coupling (cross-repo, verified):** the API builds frontend URLs from `APP_URL` + hardcoded paths in `24pray-api/src/lib/mailer.ts` (magic link `${APP_URL}/auth/verify`, project links `${APP_URL}/projects/:id`), `24pray-api/src/lib/unsubscribe.ts:17-19` (`${APP_URL}/api/projects/:id/updates/unsubscribe`), `24pray-api/src/routes/slots.ts:158` (`${APP_URL}/api/slots/:id/ics`), and jobs. The web side preserves exactly these paths as unprefixed app routes (`UNPREFIXED_ROUTES` in `24pray-web/src/lib/routes.ts:96-105`, middleware redirects `/projects/:id` → `/{locale}/projects/:id`). Changing either side breaks mailed links.
- **Type coupling (cross-repo, verified):** `24pray-web/src/types/index.ts` is a hand-mirror of the API wire format; adding/rename an API response field requires a matching manual edit in the web repo (both repos type-check independently in CI, so drift is caught only by web tests that assert shapes).

## Consolidation-Relevant Facts (current state, verified)

- **Two git repositories** with independent histories and remotes (`PhilippMichaly/24pray-server.git`, `PhilippMichaly/24pray-web.git`). Note the mismatch: the API checkout directory is `24pray-api` but its remote/GitHub name is **24pray-server**; the web README's setup section and deploy pointer (`24pray-server/deploy/README.md`) use the remote name.
- **No monorepo tooling:** no workspace config, no shared package, no cross-repo imports; the repos communicate only over HTTP (JSON) and through the env-var contract (`NEXT_PUBLIC_API_URL`, `API_URL_INTERNAL`, `APP_URL`, `CORS_ORIGINS`).
- **Separate toolchains:** Node ≥22 both, but API is Fastify 5 + Vitest 2 (node env) and UI is Next 15 + React 18 + Vitest 4 (`24pray-web/vitest.config.ts` uses oxc JSX transform, jsdom available) + ESLint; separate `package-lock.json` files; API tests run migrations against temp SQLite, UI tests are pure unit/component tests with no backend.
- **Shared contracts live in three places:** URL paths (API hardcodes web paths; web preserves them), wire types (manual mirror), env names (documented in both `.env.example` files). Any consolidation would need a single source for these.
- **Deployment topology is the integration point:** the split-host nginx arrangement, `/api` prefix convention, and systemd unit names (`24pray-web`, `24pray-api`) are documented only in the API repo's runbook (`24pray-api/deploy/README.md`), which already documents both products.
- **CI/CD:** GitHub Actions per repo; neither pipeline deploys (deployment is manual per runbook). Consolidation would merge two workflows.
- **Docs split:** API design + security specs in `24pray-api/docs/`, UI design system + i18n + white-label in `24pray-web/docs/`; both repos carry `.superpowers/sdd/2026-10-23-security-hardening` state.
- This document describes the current two-repo state only; no consolidation has been performed.

## Anti-Patterns

### Awaiting side effects in request handlers (API)

**What happens:** `await mailer.sendX(...)` in a handler makes SMTP/push latency part of the request.
**Why it's wrong:** Booking/posting must survive a dead mail server; the standard is fire-and-forget.
**Do this instead:** `bumpFunnel(prisma, 'booking').catch(...)` (`24pray-api/src/routes/slots.ts:144`), fan-out pattern in `24pray-api/src/routes/community.ts:141-174`, central `24pray-api/src/lib/adminNotify.ts`.

### Raw `fetch` / direct env reads outside the two API clients (UI)

**What happens:** A component calling `fetch(process.env.NEXT_PUBLIC_API_URL…)` directly or reading env vars outside `api.ts`/`api-server.ts`.
**Why it's wrong:** The two-client split exists to keep the SSR envelope (anonymous/PUBLIC/fail-soft) separate from the browser envelope (credentials/errors); bypassing it leaks session-relative or PRIVATE data into server-rendered HTML.
**Do this instead:** Add a typed helper to `24pray-web/src/lib/api.ts` (browser) or a `fetchPublic*` function to `24pray-web/src/lib/api-server.ts` (SSR, with the PUBLIC filter re-asserted).

### Drifting the wire-type mirror (UI)

**What happens:** Consuming a new API field in a component without adding it to `24pray-web/src/types/index.ts`, or renaming an API response field without updating the mirror.
**Why it's wrong:** The web type-checks and tests independently of the API repo, so drift ships silently.
**Do this instead:** Treat `24pray-web/src/types/index.ts` as part of the API contract: update it in the same change that changes an endpoint's response, and keep field optionality tolerant for older API responses (precedent: `language?` on `PrayerProject`).

### Prefixing the unprefixed app routes (UI) or changing mailed link paths (API)

**What happens:** Adding a locale prefix to `/auth/*`, `/join/*`, `/projects/new`, `/dashboard`, `/profil`, or changing the path templates the API mails.
**Why it's wrong:** Mails already sent contain `APP_URL`-based links (`/auth/verify?token=…`, `/projects/:id`, `/api/…`); the web middleware explicitly keeps these unprefixed (`24pray-web/src/lib/routes.ts:88-95`).
**Do this instead:** Keep app routes unprefixed; evolve links in both repos in one coordinated change.

### Check-then-act races and N+1 (API)

**What happens:** Read-then-write attempt counting; per-item count/membership queries in lists.
**Why it's wrong:** Parallel requests pass both checks; per-item queries collapse list endpoints under load.
**Do this instead:** Conditional single-statement `UPDATE` (`24pray-api/src/routes/auth.ts:133-146`), partial unique index + `P2002` handling (`24pray-api/src/routes/slots.ts:113-139`), `groupBy`/`participantProjectIds` batching (`24pray-api/src/lib/projectView.ts:46-52`, `24pray-api/src/lib/access.ts:64-81`).

### Returning internal error detail to clients (API)

**Do this instead:** statusCode-bearing `Error`s for 4xx; global handler logs 5xx server-side and answers `{ message: 'Serverfehler' }` (`24pray-api/src/app.ts:71-74`). The UI must surface `error.message` to users, never stack traces (`24pray-web/src/lib/api.ts:25-28`).

## Error Handling

**API strategy:** throw early with statusCode-marked `Error`s; zod `ZodError` → 400 (first German message); one global handler (`24pray-api/src/app.ts:61-81`) maps to responses; ≥500 logged via `console.error('[api]', …)` (Fastify `logger: false`) with a neutral client message; jobs/ticks never throw out (`24pray-api/src/lib/jobs.ts:175-177`).

**UI strategy:**
- Browser client: non-2xx → parses `{message}` and throws a plain `Error`; callers show toast/inline error (e.g. `24pray-web/src/components/slots/store.ts` booking flow). Fire-and-forget pings (`useFunnelPing`, push state checks) swallow errors deliberately.
- SSR: `api-server.ts` returns `null`/`[]` on any failure (timeout 3s) — a broken API must never break an indexable page.
- Global Next error surfaces: `notFound()` for invalid locales/unknown pages (`24pray-web/src/app/[locale]/layout.tsx:22`).

## Cross-Cutting Concerns

**Logging:** API `console.*` only, prefixed (`[api]`, `[mail]`, `[push]`, `[jobs]`, `[funnel]`). UI: no logger; errors surface to users via toasts or are swallowed for pings.

**Validation:** zod on both sides — API at the handler boundary (`24pray-api/src/schemas/` + inline), UI for form payloads before sending (and defensively on SSR data). `24pray-web/src/lib/api.ts` trusts API error messages for display.

**Authentication:** passwordless magic link + 6-digit code (API `24pray-api/src/routes/auth.ts`); httpOnly session cookie set/read only by the API; UI auth state derived from `/auth/me` per mount. Guest secrets: invite tokens, `X-Guest-Token`, HMAC unsubscribe.

**i18n/RTL:** 5 locales; API sends localized mails using per-user/per-booking `locale` (`24pray-api/prisma/schema.prisma:16`, `24pray-api/src/routes/auth.ts:83-98`); UI renders localized slugs + `<html lang/dir>` from middleware headers (`24pray-web/src/app/layout.tsx:59-62`).

**Privacy masking:** server-side only, at the API serializer boundary (`24pray-api/src/lib/slotGrid.ts:24-33`); UI renders what it receives. Public stats/geo endpoints expose coordinates/aggregates only.

---

*Architecture analysis: 2026-10-26 (API + UI repositories)*
