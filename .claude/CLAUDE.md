<!-- GSD:project-start source:PROJECT.md -->

## Project

**24pray – Freie Zeiträume für Gebetswachen**

24pray ist eine nichtkommerzielle Plattform, mit der Gemeinden, Hauskreise, Familien und Einzelpersonen Gebetswachen organisieren und Gebets-Slots übernehmen können. Dieser Meilenstein ergänzt die Web-Oberfläche um frei wählbare Endzeitpunkte, damit Organisatoren beim Erstellen und Bearbeiten nicht mehr auf feste Dauer-Vorschläge beschränkt sind.

**Core Value:** Organisatoren können die Gesamtdauer ihrer Gebetswache exakt an ihren tatsächlichen Gebetszeitraum anpassen, ohne unvollständige Slots oder bestehende Buchungen zu gefährden.

### Constraints

- **Scope**: Primär `24pray-web`; einzige API-Ausnahme (Phase 2, D-02): Buchungsschutz-Guard und Slot-Ausrichtungsprüfung für `endDate` in `PATCH /projects/:id` — sonst bleibt das API-Verhalten unverändert
- **Slot-Modell**: 60 oder 1440 Minuten — freie Endzeiten müssen vollständige Slots ab dem Start ergeben
- **Projektdauer**: Höchstens 366 Tage — bestehende API-Grenze bleibt unverändert
- **Buchungen**: Kein gebuchter Slot darf durch ein neues Projektende abgeschnitten werden — Buchungen und deren Historie bleiben geschützt
- **Internationalisierung**: Neue UI-Texte müssen alle fünf vorhandenen Sprachen und RTL unterstützen
- **Kompatibilität**: Bestehende Dauer-Presets und das Verschieben des gesamten Zeitplans bleiben erhalten

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Repositories Covered

- **`24pray-api`** (`/home/pmi/24pray-api`) — backend API: Fastify + SQLite (Prisma) + magic-link auth
- **`24pray-web`** (`/home/pmi/24pray-web`) — frontend UI: Next.js + TailwindCSS, the only consumer of the API

## Languages

- TypeScript (strict mode) — all of `24pray-api/src/` + `24pray-api/scripts/`, and all of `24pray-web/src/`
- SQL — Prisma migrations in `24pray-api/prisma/migrations/`, raw queries in `24pray-api/src/routes/community.ts:315` (SQLite FTS5) and PRAGMA in `24pray-api/src/app.ts:38`
- CSS (Tailwind utility + semantic design tokens) — `24pray-web/src/app/globals.css`, `24pray-web/tailwind.config.ts`
- Bash — `24pray-api/deploy/docker-entrypoint.sh`, `24pray-api/deploy/24pray-selfcheck.sh`
- Shell/Python 3 — inline Python for SMTP-URL parsing in `24pray-api/deploy/24pray-selfcheck.sh:59` (server-side only, not part of the API)

## Runtime

- Node.js >= 22 (`engines` in `24pray-api/package.json:7-9`; dev machine runs v22.22.0)
- ES2022 features used natively (`Intl.DateTimeFormat`, `node:crypto`, `node:fs`, `node:url`, `node:readline`)
- Node 22 for `next dev` / `next build` / `next start` (CI pins Node 22 in `24pray-web/.github/workflows/ci.yml:24`)
- Browser runtime: modern evergreen browsers; PWA via service worker `24pray-web/public/sw.js` (push only, no caching); no server runtime beyond Next itself
- npm (local v11.13.0) in both repos
- Lockfiles: present in both (`24pray-api/package-lock.json`, `24pray-web/package-lock.json`)

## Frameworks

- Fastify `^5.12.7` — HTTP server, instance built in `24pray-api/src/app.ts:45` (`buildApp()`), entry point `24pray-api/src/server.ts`
- @fastify/cookie `^11.1.3` — session cookie parsing (`24pray-api/src/app.ts:50`)
- @fastify/cors `^10.1.0` — origin allowlist `APP_URL` + `CORS_ORIGINS` (`24pray-api/src/app.ts:48-49`)
- @fastify/rate-limit `^10.3.0` — per-route limits, German 429 body via `errorResponseBuilder` (`24pray-api/src/app.ts:53-59`), write-route Pro-IP limits in `24pray-api/src/routes/projects.ts` / `24pray-api/src/routes/slots.ts`
- Prisma `^5.18.0` (`@prisma/client` + `prisma` CLI) — ORM over SQLite, client factory in `24pray-api/src/db.ts`, schema in `24pray-api/prisma/schema.prisma`
- Next.js `~15.5.28` (App Router, pinned via `overrides` in `24pray-web/package.json`) — pages/SSR/metadata in `24pray-web/src/app/`, locale middleware in `24pray-web/src/middleware.ts`
- React `^18.3.0` (+ react-dom) — client components with `'use client'`
- TailwindCSS `^3.4.0` — semantic tokens (`bg-surface`, `text-ink` …) in `24pray-web/tailwind.config.ts`; raw palette classes forbidden by lint rule (`24pray-web/.eslintrc.json`)
- Radix UI primitives (`@radix-ui/react-dialog`, `-dropdown-menu`, `-slot`, `-tabs`, `-tooltip`) — wrapped by components in `24pray-web/src/components/ui/`
- zustand `^4.5.0` — slot-grid client state (`24pray-web/src/components/slots/store.ts`)
- next-themes `^0.4.6` — light/dark theming (`24pray-web/src/app/providers.tsx`)
- zod `^3.23.0`, class-variance-authority `^0.7.1`, clsx, tailwind-merge, lucide-react (icons)
- zod — API: env parsing (`24pray-api/src/env.ts`), request bodies in every route, schemas in `24pray-api/src/schemas/`. UI: client-side input validation only.
- API: Vitest `^2.0.0` — config `24pray-api/vitest.config.ts` (node environment, `src/**/*.test.ts`, `fileParallelism: false`)
- UI: Vitest `^4.1.10` + @testing-library/react `^16.3.2` + jsdom — config `24pray-web/vitest.config.ts` (oxc JSX transform, `@` alias)
- API: typescript `^5.5.0` (`tsc` emits to `dist/` with sourcemaps), tsx `^4.16.0` (dev runner + scripts)
- UI: `next build` / `next dev` / `next start`; ESLint `^8.57.1` with `eslint-config-next`; PostCSS + autoprefixer; fonts via `next/font/google` (Fraunces, DM Sans — self-hosted at build time, `24pray-web/src/app/layout.tsx:3-22`)
- nodemailer `^10.2.1` — SMTP transport for all transactional mail (`24pray-api/src/lib/mailer.ts:266`)
- web-push `^3.6.7` — VAPID web push notifications (`24pray-api/src/lib/push.ts:33`)

## Key Dependencies

- `fastify` (API) — the entire API surface; route modules in `24pray-api/src/routes/` receive the instance from `24pray-api/src/app.ts`
- `next` (UI) — the entire UI; app screens in `24pray-web/src/app/`, components in `24pray-web/src/components/`
- `@prisma/client` (API) — all persistence; 13 models in `24pray-api/prisma/schema.prisma` (User, PrayerProject, PrayerSlot, Membership, RecurringCommitment, PrayerRequest, UpdateOptOut, FunnelCount, PushSubscription, ReminderPreference, MagicToken, Session, City)
- `zod` (both) — API: single source of truth for env config, request validation, error shaping (ZodError → 400 in `24pray-api/src/app.ts:62-64`). UI: input validation.
- `nodemailer` (API) — passwordless login (magic link + 6-digit code), reminders, booking confirmations/notices, schedule changes, update notices, feedback, admin notifications
- `web-push` (API) — second notification channel; fail-closed when VAPID env vars are missing (`24pray-api/src/lib/push.ts:29-31`)
- `@fastify/rate-limit` (API) — brute-force brake on `/auth/*` and booking/project creation
- `@fastify/cookie` + `@fastify/cors` (API) — session transport and cross-origin allowlist
- `@radix-ui/*` + `zustand` + `next-themes` (UI) — component primitives, client state, theming
- `@types/node`, `@types/web-push` (API); `@types/react*`, `@vitejs/plugin-react` (UI) — type/test packages

## Configuration

- All configuration via environment variables, parsed and validated once at import time by zod in `24pray-api/src/env.ts` (`export const env = parseEnv()`)
- Loaded via `node --env-file-if-exists=.env` (`24pray-api/package.json` scripts) — `.env` present locally (never read/committed); `.env.example` present as template
- Startup cross-validation in `24pray-api/src/env.ts:45-60`: `UNSUBSCRIBE_SECRET` (>= 32 chars) required when `SMTP_URL` is set; `DEV_LOGIN_RESPONSE` forbidden with `COOKIE_SECURE` or https `APP_URL`
- Only `APP_URL` is strictly required; everything else has a default
- `NEXT_PUBLIC_API_URL` — browser API base; in production the relative `/api` (rewritten by nginx/Next to the API), in dev `http://localhost:3001` (template: `24pray-web/.env.example:1`). **Build-time baked** — changes require rebuild.
- `NEXT_PUBLIC_APP_URL` — absolute base for canonical/hreflang/sitemap URLs, build-time baked; default fallback `https://24pray.org` (`24pray-web/src/lib/routes.ts:12`)
- `API_URL_INTERNAL` — server-only SSR fetch base for public pages, default `http://localhost:3001` (`24pray-web/src/lib/api-server.ts:17`)
- Local dev env in `.env.local` (present locally, gitignored — never read); template `.env.example`
- No secrets exist for the UI — all three vars are public by design (`NEXT_PUBLIC_*` ship to the browser)
- `24pray-api/tsconfig.json` — strict ES2022, `rootDir: src`, `outDir: dist`, sourcemaps, no declarations
- `24pray-api/Dockerfile` — multi-stage `node:22-slim` build (`npm ci` → `prisma generate` → `tsc`), runtime stage with `USER node`, `EXPOSE 3001`, entrypoint `24pray-api/deploy/docker-entrypoint.sh` (runs `prisma migrate deploy` then `node dist/server.js`)
- `24pray-api/.dockerignore` — excludes local artifacts from image context
- `24pray-web/next.config.mjs` — `poweredByHeader: false`; rewrite `/api/:path*` → `${NEXT_PUBLIC_API_URL}/:path*` (dev proxy to the API)
- `24pray-web/tsconfig.json` — strict, `noEmit`, incremental, `@/*` alias
- `24pray-web/vitest.config.ts` — vitest 4 with oxc JSX transform
- `24pray-web/.eslintrc.json` — `next/core-web-vitals` + custom `no-restricted-syntax` rules enforcing semantic Tailwind tokens (raw palette classes banned)
- `24pray-web/tailwind.config.ts`, `24pray-web/postcss.config.mjs` — design tokens, content globs
- No Dockerfile and no versioned deploy artifacts in the UI repo — deployment is defined entirely in the API repo (`24pray-api/deploy/README.md`)
- `24pray-api/deploy/24pray-api.service` — systemd unit with sandbox hardening (`ProtectSystem=strict`, `ProtectHome`, `SystemCallFilter=@system-service`, `ReadWritePaths=/opt/24pray/data`), `EnvironmentFile=/etc/24pray-api.env`
- `24pray-api/deploy/nginx.conf` — production nginx vhost: TLS (certbot), `/api/` → `127.0.0.1:3001`, `/` → Next.js `127.0.0.1:3000`, security headers, token-stripped access log
- `24pray-api/deploy/docker-entrypoint.sh`, `24pray-api/deploy/24pray-selfcheck.sh` — container start and VPS monitoring (checks both `24pray-api` and `24pray-web` services)
- `24pray-api/.github/workflows/ci.yml` — CI: `npm ci` → `prisma generate` → `tsc --noEmit` → `vitest run` on Node 22
- `24pray-web/.github/workflows/ci.yml` — CI: test job (`npm ci` → `tsc --noEmit` → `next lint` → `vitest run`) + build job (`next build` with `NEXT_PUBLIC_API_URL=/api`), Node 22

## Platform Requirements

- Node >= 22, npm; API SQLite created automatically under `DATA_DIR` (default `./data`, see `24pray-api/data/24pray.db` + WAL sidecars)
- `npx prisma migrate dev` for API schema changes; `npm run dev` (API) on `http://localhost:3001`, `npm run dev` (UI) on `http://localhost:3000` — both must run, the UI proxies/rewrites `/api` to the API
- Without `SMTP_URL` API mails are logged to console; `DEV_LOGIN_RESPONSE=true` enables the local/E2E login shortcut (the UI shows a direct-login button)
- UI: never run `next build` next to a running `next dev` (shared `.next/` corrupts the dev server)
- One VPS hosts both repos (per `24pray-api/deploy/README.md`): Ubuntu 24.04+, systemd `24pray-api.service` (from `24pray-api/deploy/24pray-api.service`) behind nginx at `https://24pray.org`, sibling Next.js service `24pray-web` (unit defined inline in the runbook) on port 3000, SQLite at `/opt/24pray/data/24pray.db`
- API migrations run automatically at service start (`ExecStartPre` in the systemd unit, entrypoint in the container)
- Alternative for the API only: Docker image from `24pray-api/Dockerfile` (port 3001, `HOST=0.0.0.0`, non-root `node` user, data volume at `/app/data`). No container setup exists for the UI.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- **API:** lowercase, camelCase compounds without hyphens: `24pray-api/src/lib/mailer.ts`, `24pray-api/src/lib/slotGrid.ts`, `24pray-api/src/lib/adminNotify.ts`. Tests co-located as `<module>.test.ts`
- **UI:** Components are PascalCase matching the export: `24pray-web/src/components/patterns/ProjectCard.tsx`, `24pray-web/src/components/ui/Button.tsx`. Hooks are `use-*.ts`: `24pray-web/src/hooks/use-auth.ts`. Lib/modules camelCase: `24pray-web/src/lib/api.ts`. Tests co-located as `<module>.test.{ts,tsx}`
- **UI Next.js routes follow the App Router filesystem convention**: `24pray-web/src/app/[locale]/projects/[id]/page.tsx`, `watch-client.tsx` beside it as the client component for the same route
- camelCase. Factory functions that create injectable services are prefixed `create*`: `createMailer` (`24pray-api/src/lib/mailer.ts:234`), `createPrisma` (`24pray-api/src/db.ts:3`), `createPushSender` (`24pray-api/src/lib/push.ts:29`)
- App composition: API uses `buildApp` (`24pray-api/src/app.ts:31`); UI page renders are default exports named after the page, client logic lives in `*Client` components (`watch-client.tsx`, `landing-client.tsx`)
- Route registration modules export one `*Routes(app, deps)` function: `authRoutes`, `projectRoutes`, `slotRoutes`, `communityRoutes`, `meRoutes`, `funnelRoutes`, `feedbackRoutes`, `pushRoutes` (all in `24pray-api/src/routes/`)
- Fastify plugin-style setup uses `register*`: `registerAuth` (`24pray-api/src/plugins/auth.ts:21`)
- Auth guard uses `require*` and throws: `requireUser` (`24pray-api/src/plugins/auth.ts:44`)
- Boolean predicates use `is*`/`can*`/`has*`: `isAllowedPushEndpoint` (`24pray-api/src/lib/push.ts:9`), `canReadProject` (`24pray-api/src/lib/access.ts`), `isValidTimezone` (`24pray-api/src/schemas/projects.ts:11`); UI: `isDayMode`, `isGapStart`, `cancelAbility` (`24pray-web/src/components/slots/logic.ts`)
- Parsers use `parse*`: `parseEnv` (`24pray-api/src/env.ts:65`), `parseLocale` (`24pray-web/src/lib/i18n.ts`)
- Test helpers use `make*`: `makeTestDb` (`24pray-api/src/test/helpers.ts:14`)
- camelCase locals (`bookedSlots`, `corsOrigins`, `bookingRateLimit`, `pendingKeys`)
- Module-level constants are SCREAMING_SNAKE: `SESSION_COOKIE` (`24pray-api/src/schemas/auth.ts:11`), `MAX_PROJECT_DAYS` (`24pray-api/src/schemas/projects.ts:8`), `ALLOWED_PUSH_HOSTS` (`24pray-api/src/lib/push.ts:6`), `LOCALE_HEADER` (`24pray-web/src/middleware.ts:16`), `SUPPORTED_LOCALES` (`24pray-web/src/lib/i18n.ts`)
- Capture arrays in tests hold sent values: `captured`, `feedbacks` (`24pray-api/src/routes/auth.test.ts:9`, `24pray-api/src/routes/feedback.test.ts:9`)
- PascalCase interfaces/types: `Mailer`, `BuildAppDeps`, `AuthedUser`, `PushSender` (API); `ProjectWithStats`, `SlotViewModel`, `Locale` (UI)
- **API:** Zod schemas exported as PascalCase consts: `CreateProjectBody`, `UpdateProjectBody`, `BookSlotBody`, `VerifyCodeBody` (`24pray-api/src/schemas/`)
- **UI:** DTO types are hand-maintained in `24pray-web/src/types/index.ts` mirroring the API models (`User`, `PrayerProject`, `PrayerSlot`, `SlotView`); enums as string-literal unions: `ProjectStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'`
- Union kinds use snake_case string literals: `AdminNotice['kind']` is `'project_created' | 'user_activated' | 'slot_booked'` (`24pray-api/src/lib/mailer.ts:73`)

## Code Style

- **API:** No ESLint, Prettier, or Biome config — style enforced by convention plus `tsc --strict` (`24pray-api/tsconfig.json`) and CI type-check (`.github/workflows/ci.yml`)
- **UI:** ESLint 8 with `next/core-web-vitals` plus a project-specific `no-restricted-syntax` rule in `24pray-web/.eslintrc.json` that BANS raw Tailwind palette utilities (`bg-blue-…`, `text-gray-…`, `border-red-…` etc.) and arbitrary `bg-[var(--…)]` utilities. Only semantic tokens are legal: `bg-surface`, `bg-surface-sunken`, `text-ink`, `text-ink-muted`, `border-border`, `bg-accent`, `text-accent-ink`, `text-danger`, `text-positive`, `ring-focus` — defined as CSS-var-backed tokens in `24pray-web/tailwind.config.ts`
- Observed style (both repos): 2-space indentation, single quotes, semicolons, trailing commas in multiline literals
- Numeric separators in large literals: `30_000` (`24pray-api/src/env.ts:20`), `86_400_000` (`24pray-api/src/schemas/projects.ts:24`), `60_000` (`24pray-web/src/components/slots/store.ts:55`)
- **API:** ESM only (`"type": "module"`), every relative import carries an explicit `.js` extension: `import { parseEnv } from './env.js'`
- **UI:** ESM via Next bundling; imports use the `@/*` alias (`@/lib/api`, `@/components/ui/Button`), never relative `../` chains across feature folders
- Type-only imports use `import type` in both repos
- **API:** Not configured — the de-facto gates are `npx tsc --noEmit` (CI) and review
- **UI:** `npm run lint` → `next lint`; runs in CI (`.github/workflows/ci.yml` of `24pray-web`) between type-check and tests. Keep new classes semantic-token-only or the lint rule fails
- Identifiers and code in English; ALL comments in German; ALL user-facing strings in German: `'Nicht angemeldet'` (`24pray-api/src/plugins/auth.ts:46`), `'Serverfehler'` (`24pray-api/src/app.ts:73`); UI catalog `cancel: 'Abbrechen'` (`24pray-web/src/lib/i18n.ts:9`), fallback `'Unbekannter Fehler'` (`24pray-web/src/lib/api.ts:26`)
- Comments cite their decision origin with compact prefixes: `A1:`, `N9`, `W3.2`, `Backlog 7`, `fix2 (HOCH, End-User-Test v2 Befund 2)`, `Ruling R1` (API); `W3`, `W4`, `F2`, `F4`, `P3`, `§3.2`, `Fixpunkt 1` (UI)

## Import Organization

- **API:** relative paths only, type-only imports where mixed, always ending in `.js`. Exact layering in `24pray-api/src/app.ts:1-18`: fastify externals → zod → `@prisma/client` type → `./env.js` type → `./lib/*` → `./plugins/auth.js` → `./routes/*`
- **UI:** alias paths only: `import { cn } from '@/lib/utils'` (`24pray-web/src/components/ui/Button.tsx:5`), `import { useSlotGridStore } from './logic'` for same-folder. Same-folder siblings use relative `./`
- **API:** None (`24pray-api/tsconfig.json` has no `paths`)
- **UI:** `@/* → ./src/*` in `24pray-web/tsconfig.json`, mirrored in `24pray-web/vitest.config.ts` (`resolve.alias`) so tests resolve identically

## Error Handling

- Throw `Error` objects carrying a `statusCode` property — never Fastify reply objects from business logic. Three idioms are all in use; the local `httpError` helper is the dominant one in routes:
- One central error handler normalizes everything (`24pray-api/src/app.ts:61-81`): `ZodError` → 400 with the first issue's message; `statusCode >= 500` → `console.error` + generic `'Serverfehler'` (internal details like SQL fragments MUST NOT reach the client); anything else → its string `message` or `'Serverfehler'`
- Zod validation errors surface via the same handler — schemas attach German messages at the field level (`z.string().regex(/^\d{6}$/, 'Code ist 6-stellig')`, `24pray-api/src/schemas/auth.ts:8`)
- Fail-closed by configuration: a missing env value disables the feature rather than crashing — no `FEEDBACK_TO` → `/feedback` returns 404 (`24pray-api/src/routes/feedback.ts:20-22`), no VAPID keys → `createPushSender` returns `null` (`24pray-api/src/lib/push.ts:29-30`)
- Prisma unique-constraint conflicts (`P2002`) map to 409 via the partial unique index instead of transactions (`24pray-api/src/routes/slots.ts:113-114`)
- Fire-and-forget async work catches internally and logs, never crashing the caller: `console.error('[push] reminder push failed:', err)` (`24pray-api/src/lib/jobs.ts:75`)
- The `ApiClient` (`24pray-web/src/lib/api.ts:10-34`) is the single fetch seam: non-OK responses throw `new Error(error.message)` from the JSON body (fallback `'Unbekannter Fehler'`); 204/empty bodies return `undefined`. Callers catch `(e as Error).message` and route it into toast or local error state (`24pray-web/src/components/slots/store.ts:63-65,133-141`)
- Optimistic UI with rollback: `bookOptimistic` patches local state, then on `409|belegt` rolls back, sets conflict state, toasts, and refetches (`24pray-web/src/components/slots/store.ts:100-145`). Follow this pattern for new mutations: patch → request → reconcile on error
- No try/catch around render; errors live in state (`const [error, setError] = useState<string | null>(null)`) or in the toast store (`24pray-web/src/components/ui/toast-store.ts`)

## Logging

- **API:** Tag-prefixed messages: `[api]` for HTTP 500s (`24pray-api/src/app.ts:72`), `[push]` (`24pray-api/src/lib/push.ts:60`), `[jobs]` (`24pray-api/src/lib/jobs.ts:79`), `[mailer:dev]` (`24pray-api/src/lib/mailer.ts:238`)
- **UI:** `[mailer:dev]`-style tags appear in dev paths too; client-side failures surface in UI (toasts), so console use is reserved for unexpected dev output
- 500s MUST be logged server-side because `logger: false` would otherwise swallow them silently (rationale at `24pray-api/src/app.ts:66-70`)
- Tests in both repos spy on `console` with `vi.spyOn(console, 'error').mockImplementation(() => {})` — keep new log callings as direct `console.*` calls, not wrappers

## Comments

- Every comment explains WHY (decision, threat model, ruling reference), not what. Examples: SSRF parser-differential rationale (`24pray-api/src/lib/push.ts:12-14`), disabled-button contrast rationale (`24pray-web/src/components/ui/Button.tsx:12-13`), middleware locale-header rationale (`24pray-web/src/middleware.ts:13-15`)
- Comments are written in German in both repos
- Non-obvious security and correctness invariants carry their ticket/ruling ID inline: `A2:`, `N1:`, `N5:` (`24pray-api/src/routes/slots.ts`); `W4`, `F2` (`24pray-web/src/components/slots/store.ts:85,99`)
- `/** ... */` on exported functions/interfaces that have a contract: `safeEqual` timing-safety note (`24pray-api/src/lib/tokens.ts:16-20`), `pushToUsers` failure-isolation contract (`24pray-api/src/lib/push.ts:41-42`), `cn` (`24pray-web/src/lib/utils.ts:4`), `isAllowedPushEndpoint` (`24pray-api/src/lib/push.ts:8`)
- API interface fields get trailing inline type annotations: `startTime: string; // ISO` (`24pray-api/src/lib/mailer.ts:7`)
- UI route-level intent uses plain `//` above handlers/JSX blocks

## Function Design

- **API:** Dependencies arrive as a single destructured `deps` object: `feedbackRoutes(app, deps: { mailer?: Mailer; env?: Env })` (`24pray-api/src/routes/feedback.ts:12`), `buildApp(deps: BuildAppDeps)` (`24pray-api/src/app.ts:31`)
- **API:** Time-dependent functions take an injectable clock via default parameter: `completeElapsedSlots(prisma, now = new Date())` (`24pray-api/src/lib/jobs.ts:7`). Do NOT call `new Date()` deep inside logic when a parameter can carry it — tests rely on this instead of fake timers
- **UI (parallel idiom):** Components that render time-relative output accept an explicit `now` prop with an internal default: `ProjectCard` is rendered as `<ProjectCard … now={DURING} />` in tests (`24pray-web/src/components/patterns/ProjectCard.test.tsx:55`); pure logic takes `now` in the derivation context (`ctx({ now: NOW })`, `24pray-web/src/components/slots/logic.test.ts:38-45`)
- Optional capabilities on API interfaces use optional methods so partial fakes suffice: `sendReminder?(email, reminder)` on `Mailer` (`24pray-api/src/lib/mailer.ts:132-142`); callers use `mailer.sendReminder?.(...)` (`24pray-api/src/lib/jobs.ts:58`)
- API route handlers return serialized objects directly or `reply.code(n).send(...)` / `reply.code(204).send()` (`24pray-api/src/routes/feedback.ts:29`)
- UI hooks return a bag of view models + actions: `useSlotGrid` returns `{ models, days, gap, booked, error, now, tz, dayMode, reload, bookOptimistic, cancelBooked }` (`24pray-web/src/components/slots/store.ts:147-161`)
- Library predicates return plain booleans; null-object pattern for disabled services: `createPushSender` returns `PushSender | null` and callers guard (`24pray-api/src/lib/jobs.ts:70`)

## Module Design

- One primary export per module plus its types. API route modules export the `*Routes` function; UI component files export the component (+ `buttonVariants` alongside `Button`, `24pray-web/src/components/ui/Button.tsx:8,44`)
- Types are exported alongside implementations: `export type Env = z.infer<typeof EnvSchema>` (`24pray-api/src/env.ts:63`); central UI DTOs in `24pray-web/src/types/index.ts`
- Internal helpers stay unexported (`httpError` in `24pray-api/src/routes/slots.ts:15` is file-private)
- None in either repo. API consumers import directly from the owning file; UI consumers use the `@/` alias to the owning file. Cross-module imports are explicit
- `24pray-web/src/components/ui/` — primitive, design-token-bound components (Button, Card, Input, Sheet, Toast…) built on Radix primitives + `cn()`
- `24pray-web/src/components/patterns/` — feature-composed blocks (ProjectCard, AppShell, FeedbackDialog…)
- `24pray-web/src/components/slots/` — one feature domain with its own `logic.ts` (pure functions), `store.ts` (zustand + hooks), `types.ts`
- `24pray-web/src/lib/` — framework-free helpers (api, i18n, time, share, funnel, cities, seo)
- `24pray-web/src/app/` — routes; thin server components delegate to `*Client` components (`'use client'`)
- Server-fetched data flows through the `ApiClient`; client state lives in zustand stores colocated with the feature (`useSlotGridStore`, `24pray-web/src/components/slots/store.ts:23`) plus `'use client'` hooks (`useAuth`, `24pray-web/src/hooks/use-auth.ts`)
- i18n is module-level, not React-context-only: `t()`/`setLocale()` from `24pray-web/src/lib/i18n.ts` (de catalog = source of truth, typed so missing keys fail compilation); `LocaleProvider` (`24pray-web/src/lib/locale-context.tsx`) remounts non-consumer children on switch and sets `<html lang>`/`dir` (RTL for he/ar)
- `24pray-api/src/app.ts` is the only place all routes/plugins are wired (plugin registration, error handler, route calls). New API routes are added here, not in `24pray-api/src/server.ts`
- DI flows: `24pray-api/src/server.ts` builds real services → `buildApp(deps)` accepts overrides (`mailer?`, `pushSender?`, `disableWriteRateLimits?`) so tests substitute fakes (`24pray-api/src/app.ts:20-29`)
- Shared request schemas in `24pray-api/src/schemas/`, reused across routes
- One-off schemas at the top of the consuming route file: `FeedbackBody` (`24pray-api/src/routes/feedback.ts:6-10`), `CancelQuery`/`InviteQuery` (`24pray-api/src/routes/slots.ts:21-22`)
- All request parsing goes through Zod `.parse()` inside handlers — there is no Fastify JSON schema wiring
- **UI:** has no runtime request validation; it trusts its own typed `ApiClient` calls and the API's Zod gate
- **API:** All environment access is centralized in `24pray-api/src/env.ts` (Zod schema, defaults, `superRefine` cross-field rules, injectable `parseEnv`). Never read `process.env` outside `src/env.ts` (and `scripts/`)
- **UI:** `NEXT_PUBLIC_API_URL` is read in exactly one place (`24pray-web/src/lib/api.ts:1`); `next.config.mjs` rewrites `/api/:path*` to the API for same-origin fetches in production

## Cross-Project Consistency

- **Comment language:** German, with ruling/ticket ID prefixes (`A1`, `W3`, `F2`, `Backlog N`, `fixN`)
- **User-facing strings:** German (API error messages; UI catalog in `24pray-web/src/lib/i18n.ts`, de = source of truth, all 5 locales `de|en|es|he|ar` kept key-complete via types)
- **Test naming:** German `describe`/`it` titles in behavior suites; scenario prefixes in fixture values (`un7-`, `wb-`, `ux `)
- **Testable time:** explicit `now` injection (API: default param; UI: prop/context), never fake timers
- **Co-located tests:** `*.test.ts(x)` beside the implementation in both repos
- **Strict TypeScript:** `strict: true` in both `tsconfig.json` files; CI runs `npx tsc --noEmit` in both repos
- **Styling:** `console.*` only, no logger framework; 2-space/single-quote/trailing-comma style

## Verified Inconsistencies (consolidation candidates)

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

| Repo | Local path | Git remote (verified `git remote -v`) | Role |
|------|-----------|----------------------------------------|------|
| API | `/home/pmi/24pray-api` | `github.com/PhilippMichaly/24pray-server.git` | Fastify 5 + SQLite backend (`24pray-api` on disk; remote is named **24pray-server**) |
| UI | `/home/pmi/24pray-web` | `github.com/PhilippMichaly/24pray-web.git` | Next.js 15 (App Router) frontend |

## System Overview

```text

```
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

- Dependency injection via `BuildAppDeps` (`24pray-api/src/app.ts:20-29`); route modules are `(app, deps) => void` functions; fakes implement the same `Mailer`/`PushSender` interfaces in tests.
- Zod validation at the handler boundary; thrown `ZodError` → 400 in the global error handler (`24pray-api/src/app.ts:61-81`).
- Errors as `Error` objects with a `statusCode` property (local `httpError` helper per route file).
- Fire-and-forget side effects (mail, push, funnel) — never awaited, `.catch(console.error)`.
- SQLite pragmatism: partial unique indexes for atomicity (booking `P2002` → 409), single-statement `$executeRaw` for races, WAL mode.
- App Router with server components for every indexable page: landing, watches list, watch detail fetch data via `api-server.ts` so crawlers see content in first HTML; interactive parts are `'use client'` islands receiving server-fetched data as props (e.g. `initialProject` in `24pray-web/src/app/[locale]/projects/[id]/page.tsx:33-38`).
- Client data fetching happens in `useEffect` (no SWR/React Query); auth state via `useAuth()` polling `/auth/me` once per mount (`24pray-web/src/hooks/use-auth.ts`).
- Local state: one Zustand store per concern (`useSlotGridStore` in `24pray-web/src/components/slots/store.ts:18-37`, `toast-store.ts`); cross-component locale via React context (`24pray-web/src/lib/locale-context.tsx`).
- i18n: 5 locales (de/en/es/he/ar), source-of-truth catalog in `24pray-web/src/lib/i18n.ts`, localized URL slugs in `24pray-web/src/lib/routes.ts`, RTL via `<html dir>`.
- German domain language in comments/user-facing strings (both repos); identifiers and API fields English.

## Layers

- Purpose: URL schema, locale negotiation, metadata/JSON-LD, SSR data prefetch.
- Contains: `middleware.ts` (locale redirect/rewrite, header injection), `[locale]/` public pages, unprefixed app pages (`auth/`, `dashboard`, `profil`, `projects/new`, `join/`), `robots.ts`, `sitemap.ts`.
- Depends on: `lib/routes.ts`, `lib/i18n.ts`, `lib/seo.ts`, `lib/api-server.ts` (server side only).
- Used by: the browser/nginx only.
- Purpose: `ui/` primitives (Button, Sheet, Toast, Tabs…), `patterns/` domain molecules (Globe, AppShell, InviteCard…), `slots/` the slot-grid heart (ChainBand, SlotList, SlotSheet, logic, store).
- Depends on: `lib/api.ts`, `lib/time.ts`, `lib/i18n.ts`, `types/`.
- Used by: app pages.
- Purpose: browser API client, SSR API client, funnel ping, push subscription, i18n catalog, route/slug map, SEO helpers, time formatting, cities autocomplete, share/anbieter/mylocation utilities.
- Depends on: nothing outside the repo (types mirrored by hand).
- Used by: components and server pages.

## Data Flow

### Browser → API request (the primary path)

### SSR prefetch path (SEO)

### Auth/session flow

### Web-push flow

### Background jobs (API)

- Server: SQLite is the only durable store; in-memory only for `/stats/public` TTL cache, jobs overlap flag, and `req.user` decoration.
- Browser: Zustand stores (slot grid, toast) are ephemeral per page load; no cookies are written by the web app itself (locale travels via cookie + `x-locale` header, `24pray-web/src/middleware.ts:39-44`).

## Key Abstractions

- Purpose: single seam for all browser→API traffic; centralizes credentials, JSON handling, 204 handling, error extraction.
- Example: `24pray-web/src/lib/api.ts:3-57`; domain helpers (`bookSlot`, `cancelSlot`, `rotateInvite`, …) build on it in the same file.
- Pattern: one exported `api` instance; new endpoints get a typed helper here, not raw `fetch` in components.
- Purpose: SSR seam with a strictly smaller permission envelope than the browser client.
- Example: `24pray-web/src/lib/api-server.ts:1-61` — PUBLIC-only, anonymous, timeout, fail-soft (`null`/`[]`).
- Pattern: every new SSR fetch must re-assert PUBLIC filtering client-side even if the API filters (see `fetchPublicProjects`, line 48-52).
- Purpose: outbound-channel seams; tests inject fakes; `createMailer` picks console-dev vs nodemailer-SMTP by `SMTP_URL` (`24pray-api/src/lib/mailer.ts:234-266`); `createPushSender` returns `null` when VAPID is unconfigured (fail-closed → routes 404).

## Entry Points

- Triggers: `npm run dev` (tsx watch), `npm start` (`dist/server.js`), Docker `CMD ["./docker-entrypoint.sh"]` → migrations → `node dist/server.js` (`24pray-api/deploy/docker-entrypoint.sh:11-13`).
- Responsibilities: mkdir `DATA_DIR`, SQLite URL `file:<DATA_DIR>/24pray.db`, infra construction, `buildApp`, listen on `HOST:PORT` (default `127.0.0.1:3001`), `startJobs`, graceful shutdown.
- Location: `24pray-api/src/app.ts:31`. Used by `src/server.ts` and every API test via `app.inject`.
- Triggers: `npm run dev` (`next dev`, :3000), `npm start` (`next start`), production systemd unit `24pray-web` (see runbook `24pray-api/deploy/README.md`).
- Responsibilities: render app routes, proxy `/api/*` via `next.config.mjs` rewrites when hit through Next, serve `public/` (sw.js, manifest, earth textures).

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

### Raw `fetch` / direct env reads outside the two API clients (UI)

### Drifting the wire-type mirror (UI)

### Prefixing the unprefixed app routes (UI) or changing mailed link paths (API)

### Check-then-act races and N+1 (API)

### Returning internal error detail to clients (API)

## Error Handling

- Browser client: non-2xx → parses `{message}` and throws a plain `Error`; callers show toast/inline error (e.g. `24pray-web/src/components/slots/store.ts` booking flow). Fire-and-forget pings (`useFunnelPing`, push state checks) swallow errors deliberately.
- SSR: `api-server.ts` returns `null`/`[]` on any failure (timeout 3s) — a broken API must never break an indexable page.
- Global Next error surfaces: `notFound()` for invalid locales/unknown pages (`24pray-web/src/app/[locale]/layout.tsx:22`).

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
