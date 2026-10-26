---
last_mapped_commit: a09e3c06c1da2363a2db1774a9fc13e7c60a3839
last_mapped_at: 2026-10-26
---
# Coding Conventions

**Analysis Date:** 2026-10-26

**Scope:** Both projects of the 24pray system — API (`/home/pmi/24pray-api`, Fastify + SQLite) and UI (`/home/pmi/24pray-web`, Next.js + Tailwind). Paths are written sibling-relative from `/home/pmi/`: `24pray-api/src/...` and `24pray-web/src/...`. Sections label findings **API** and **UI** where they differ; unlabeled statements apply to both.

## Naming Patterns

**Files:**
- **API:** lowercase, camelCase compounds without hyphens: `24pray-api/src/lib/mailer.ts`, `24pray-api/src/lib/slotGrid.ts`, `24pray-api/src/lib/adminNotify.ts`. Tests co-located as `<module>.test.ts`
- **UI:** Components are PascalCase matching the export: `24pray-web/src/components/patterns/ProjectCard.tsx`, `24pray-web/src/components/ui/Button.tsx`. Hooks are `use-*.ts`: `24pray-web/src/hooks/use-auth.ts`. Lib/modules camelCase: `24pray-web/src/lib/api.ts`. Tests co-located as `<module>.test.{ts,tsx}`
- **UI Next.js routes follow the App Router filesystem convention**: `24pray-web/src/app/[locale]/projects/[id]/page.tsx`, `watch-client.tsx` beside it as the client component for the same route

**Functions:**
- camelCase. Factory functions that create injectable services are prefixed `create*`: `createMailer` (`24pray-api/src/lib/mailer.ts:234`), `createPrisma` (`24pray-api/src/db.ts:3`), `createPushSender` (`24pray-api/src/lib/push.ts:29`)
- App composition: API uses `buildApp` (`24pray-api/src/app.ts:31`); UI page renders are default exports named after the page, client logic lives in `*Client` components (`watch-client.tsx`, `landing-client.tsx`)
- Route registration modules export one `*Routes(app, deps)` function: `authRoutes`, `projectRoutes`, `slotRoutes`, `communityRoutes`, `meRoutes`, `funnelRoutes`, `feedbackRoutes`, `pushRoutes` (all in `24pray-api/src/routes/`)
- Fastify plugin-style setup uses `register*`: `registerAuth` (`24pray-api/src/plugins/auth.ts:21`)
- Auth guard uses `require*` and throws: `requireUser` (`24pray-api/src/plugins/auth.ts:44`)
- Boolean predicates use `is*`/`can*`/`has*`: `isAllowedPushEndpoint` (`24pray-api/src/lib/push.ts:9`), `canReadProject` (`24pray-api/src/lib/access.ts`), `isValidTimezone` (`24pray-api/src/schemas/projects.ts:11`); UI: `isDayMode`, `isGapStart`, `cancelAbility` (`24pray-web/src/components/slots/logic.ts`)
- Parsers use `parse*`: `parseEnv` (`24pray-api/src/env.ts:65`), `parseLocale` (`24pray-web/src/lib/i18n.ts`)
- Test helpers use `make*`: `makeTestDb` (`24pray-api/src/test/helpers.ts:14`)

**Variables:**
- camelCase locals (`bookedSlots`, `corsOrigins`, `bookingRateLimit`, `pendingKeys`)
- Module-level constants are SCREAMING_SNAKE: `SESSION_COOKIE` (`24pray-api/src/schemas/auth.ts:11`), `MAX_PROJECT_DAYS` (`24pray-api/src/schemas/projects.ts:8`), `ALLOWED_PUSH_HOSTS` (`24pray-api/src/lib/push.ts:6`), `LOCALE_HEADER` (`24pray-web/src/middleware.ts:16`), `SUPPORTED_LOCALES` (`24pray-web/src/lib/i18n.ts`)
- Capture arrays in tests hold sent values: `captured`, `feedbacks` (`24pray-api/src/routes/auth.test.ts:9`, `24pray-api/src/routes/feedback.test.ts:9`)

**Types:**
- PascalCase interfaces/types: `Mailer`, `BuildAppDeps`, `AuthedUser`, `PushSender` (API); `ProjectWithStats`, `SlotViewModel`, `Locale` (UI)
- **API:** Zod schemas exported as PascalCase consts: `CreateProjectBody`, `UpdateProjectBody`, `BookSlotBody`, `VerifyCodeBody` (`24pray-api/src/schemas/`)
- **UI:** DTO types are hand-maintained in `24pray-web/src/types/index.ts` mirroring the API models (`User`, `PrayerProject`, `PrayerSlot`, `SlotView`); enums as string-literal unions: `ProjectStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'`
- Union kinds use snake_case string literals: `AdminNotice['kind']` is `'project_created' | 'user_activated' | 'slot_booked'` (`24pray-api/src/lib/mailer.ts:73`)

## Code Style

**Formatting:**
- **API:** No ESLint, Prettier, or Biome config — style enforced by convention plus `tsc --strict` (`24pray-api/tsconfig.json`) and CI type-check (`.github/workflows/ci.yml`)
- **UI:** ESLint 8 with `next/core-web-vitals` plus a project-specific `no-restricted-syntax` rule in `24pray-web/.eslintrc.json` that BANS raw Tailwind palette utilities (`bg-blue-…`, `text-gray-…`, `border-red-…` etc.) and arbitrary `bg-[var(--…)]` utilities. Only semantic tokens are legal: `bg-surface`, `bg-surface-sunken`, `text-ink`, `text-ink-muted`, `border-border`, `bg-accent`, `text-accent-ink`, `text-danger`, `text-positive`, `ring-focus` — defined as CSS-var-backed tokens in `24pray-web/tailwind.config.ts`
- Observed style (both repos): 2-space indentation, single quotes, semicolons, trailing commas in multiline literals
- Numeric separators in large literals: `30_000` (`24pray-api/src/env.ts:20`), `86_400_000` (`24pray-api/src/schemas/projects.ts:24`), `60_000` (`24pray-web/src/components/slots/store.ts:55`)
- **API:** ESM only (`"type": "module"`), every relative import carries an explicit `.js` extension: `import { parseEnv } from './env.js'`
- **UI:** ESM via Next bundling; imports use the `@/*` alias (`@/lib/api`, `@/components/ui/Button`), never relative `../` chains across feature folders
- Type-only imports use `import type` in both repos

**Linting:**
- **API:** Not configured — the de-facto gates are `npx tsc --noEmit` (CI) and review
- **UI:** `npm run lint` → `next lint`; runs in CI (`.github/workflows/ci.yml` of `24pray-web`) between type-check and tests. Keep new classes semantic-token-only or the lint rule fails

**Language convention (strict, both repos):**
- Identifiers and code in English; ALL comments in German; ALL user-facing strings in German: `'Nicht angemeldet'` (`24pray-api/src/plugins/auth.ts:46`), `'Serverfehler'` (`24pray-api/src/app.ts:73`); UI catalog `cancel: 'Abbrechen'` (`24pray-web/src/lib/i18n.ts:9`), fallback `'Unbekannter Fehler'` (`24pray-web/src/lib/api.ts:26`)
- Comments cite their decision origin with compact prefixes: `A1:`, `N9`, `W3.2`, `Backlog 7`, `fix2 (HOCH, End-User-Test v2 Befund 2)`, `Ruling R1` (API); `W3`, `W4`, `F2`, `F4`, `P3`, `§3.2`, `Fixpunkt 1` (UI)

## Import Organization

**Order (both repos):**
1. Node builtins with the `node:` prefix: `import { mkdirSync } from 'node:fs'` (`24pray-api/src/server.ts:1`)
2. External packages: `fastify`, `zod`, `@prisma/client` / `next`, `react`, `zustand`, `@radix-ui/*`, `lucide-react`
3. Internal imports last

**Internal import style — differs per repo:**
- **API:** relative paths only, type-only imports where mixed, always ending in `.js`. Exact layering in `24pray-api/src/app.ts:1-18`: fastify externals → zod → `@prisma/client` type → `./env.js` type → `./lib/*` → `./plugins/auth.js` → `./routes/*`
- **UI:** alias paths only: `import { cn } from '@/lib/utils'` (`24pray-web/src/components/ui/Button.tsx:5`), `import { useSlotGridStore } from './logic'` for same-folder. Same-folder siblings use relative `./`

**Path Aliases:**
- **API:** None (`24pray-api/tsconfig.json` has no `paths`)
- **UI:** `@/* → ./src/*` in `24pray-web/tsconfig.json`, mirrored in `24pray-web/vitest.config.ts` (`resolve.alias`) so tests resolve identically

## Error Handling

**Patterns (API):**
- Throw `Error` objects carrying a `statusCode` property — never Fastify reply objects from business logic. Three idioms are all in use; the local `httpError` helper is the dominant one in routes:
  1. Local helper at the top of each route file:
     ```typescript
     function httpError(status: number, message: string) {
       const e = new Error(message) as Error & { statusCode?: number };
       e.statusCode = status;
       return e;
     }
     ```
     (`24pray-api/src/routes/slots.ts:15-19`)
  2. `throw Object.assign(new Error(message), { statusCode: 400 })` (`24pray-api/src/schemas/projects.ts:27`)
  3. Mutate-then-throw in the auth guard (`24pray-api/src/plugins/auth.ts:46-48`)
- One central error handler normalizes everything (`24pray-api/src/app.ts:61-81`): `ZodError` → 400 with the first issue's message; `statusCode >= 500` → `console.error` + generic `'Serverfehler'` (internal details like SQL fragments MUST NOT reach the client); anything else → its string `message` or `'Serverfehler'`
- Zod validation errors surface via the same handler — schemas attach German messages at the field level (`z.string().regex(/^\d{6}$/, 'Code ist 6-stellig')`, `24pray-api/src/schemas/auth.ts:8`)
- Fail-closed by configuration: a missing env value disables the feature rather than crashing — no `FEEDBACK_TO` → `/feedback` returns 404 (`24pray-api/src/routes/feedback.ts:20-22`), no VAPID keys → `createPushSender` returns `null` (`24pray-api/src/lib/push.ts:29-30`)
- Prisma unique-constraint conflicts (`P2002`) map to 409 via the partial unique index instead of transactions (`24pray-api/src/routes/slots.ts:113-114`)
- Fire-and-forget async work catches internally and logs, never crashing the caller: `console.error('[push] reminder push failed:', err)` (`24pray-api/src/lib/jobs.ts:75`)

**Patterns (UI):**
- The `ApiClient` (`24pray-web/src/lib/api.ts:10-34`) is the single fetch seam: non-OK responses throw `new Error(error.message)` from the JSON body (fallback `'Unbekannter Fehler'`); 204/empty bodies return `undefined`. Callers catch `(e as Error).message` and route it into toast or local error state (`24pray-web/src/components/slots/store.ts:63-65,133-141`)
- Optimistic UI with rollback: `bookOptimistic` patches local state, then on `409|belegt` rolls back, sets conflict state, toasts, and refetches (`24pray-web/src/components/slots/store.ts:100-145`). Follow this pattern for new mutations: patch → request → reconcile on error
- No try/catch around render; errors live in state (`const [error, setError] = useState<string | null>(null)`) or in the toast store (`24pray-web/src/components/ui/toast-store.ts`)

**When adding a new route error (API):** use `throw httpError(<status>, '<deutsche Meldung>')`; 404 is preferred over 403 when revealing existence would leak ("kein Existenz-Orakel", `24pray-api/src/routes/slots.ts:88-93`).

## Logging

**Framework:** `console` only, both repos. API Fastify runs with `logger: false` (`24pray-api/src/app.ts:45`); UI has no logger library.

**Patterns:**
- **API:** Tag-prefixed messages: `[api]` for HTTP 500s (`24pray-api/src/app.ts:72`), `[push]` (`24pray-api/src/lib/push.ts:60`), `[jobs]` (`24pray-api/src/lib/jobs.ts:79`), `[mailer:dev]` (`24pray-api/src/lib/mailer.ts:238`)
- **UI:** `[mailer:dev]`-style tags appear in dev paths too; client-side failures surface in UI (toasts), so console use is reserved for unexpected dev output
- 500s MUST be logged server-side because `logger: false` would otherwise swallow them silently (rationale at `24pray-api/src/app.ts:66-70`)
- Tests in both repos spy on `console` with `vi.spyOn(console, 'error').mockImplementation(() => {})` — keep new log callings as direct `console.*` calls, not wrappers

## Comments

**When to Comment:**
- Every comment explains WHY (decision, threat model, ruling reference), not what. Examples: SSRF parser-differential rationale (`24pray-api/src/lib/push.ts:12-14`), disabled-button contrast rationale (`24pray-web/src/components/ui/Button.tsx:12-13`), middleware locale-header rationale (`24pray-web/src/middleware.ts:13-15`)
- Comments are written in German in both repos
- Non-obvious security and correctness invariants carry their ticket/ruling ID inline: `A2:`, `N1:`, `N5:` (`24pray-api/src/routes/slots.ts`); `W4`, `F2` (`24pray-web/src/components/slots/store.ts:85,99`)

**JSDoc/TSDoc:**
- `/** ... */` on exported functions/interfaces that have a contract: `safeEqual` timing-safety note (`24pray-api/src/lib/tokens.ts:16-20`), `pushToUsers` failure-isolation contract (`24pray-api/src/lib/push.ts:41-42`), `cn` (`24pray-web/src/lib/utils.ts:4`), `isAllowedPushEndpoint` (`24pray-api/src/lib/push.ts:8`)
- API interface fields get trailing inline type annotations: `startTime: string; // ISO` (`24pray-api/src/lib/mailer.ts:7`)
- UI route-level intent uses plain `//` above handlers/JSX blocks

## Function Design

**Size:** Small and single-purpose. API route handlers delegate to `buildSlotGrid` (`24pray-api/src/lib/slotGrid.ts`) and `src/lib/access.ts`; UI logic is extracted into pure functions in `24pray-web/src/components/slots/logic.ts` (386-line test file against it) so components stay thin.

**Parameters:**
- **API:** Dependencies arrive as a single destructured `deps` object: `feedbackRoutes(app, deps: { mailer?: Mailer; env?: Env })` (`24pray-api/src/routes/feedback.ts:12`), `buildApp(deps: BuildAppDeps)` (`24pray-api/src/app.ts:31`)
- **API:** Time-dependent functions take an injectable clock via default parameter: `completeElapsedSlots(prisma, now = new Date())` (`24pray-api/src/lib/jobs.ts:7`). Do NOT call `new Date()` deep inside logic when a parameter can carry it — tests rely on this instead of fake timers
- **UI (parallel idiom):** Components that render time-relative output accept an explicit `now` prop with an internal default: `ProjectCard` is rendered as `<ProjectCard … now={DURING} />` in tests (`24pray-web/src/components/patterns/ProjectCard.test.tsx:55`); pure logic takes `now` in the derivation context (`ctx({ now: NOW })`, `24pray-web/src/components/slots/logic.test.ts:38-45`)
- Optional capabilities on API interfaces use optional methods so partial fakes suffice: `sendReminder?(email, reminder)` on `Mailer` (`24pray-api/src/lib/mailer.ts:132-142`); callers use `mailer.sendReminder?.(...)` (`24pray-api/src/lib/jobs.ts:58`)

**Return Values:**
- API route handlers return serialized objects directly or `reply.code(n).send(...)` / `reply.code(204).send()` (`24pray-api/src/routes/feedback.ts:29`)
- UI hooks return a bag of view models + actions: `useSlotGrid` returns `{ models, days, gap, booked, error, now, tz, dayMode, reload, bookOptimistic, cancelBooked }` (`24pray-web/src/components/slots/store.ts:147-161`)
- Library predicates return plain booleans; null-object pattern for disabled services: `createPushSender` returns `PushSender | null` and callers guard (`24pray-api/src/lib/jobs.ts:70`)

## Module Design

**Exports:**
- One primary export per module plus its types. API route modules export the `*Routes` function; UI component files export the component (+ `buttonVariants` alongside `Button`, `24pray-web/src/components/ui/Button.tsx:8,44`)
- Types are exported alongside implementations: `export type Env = z.infer<typeof EnvSchema>` (`24pray-api/src/env.ts:63`); central UI DTOs in `24pray-web/src/types/index.ts`
- Internal helpers stay unexported (`httpError` in `24pray-api/src/routes/slots.ts:15` is file-private)

**Barrel Files:**
- None in either repo. API consumers import directly from the owning file; UI consumers use the `@/` alias to the owning file. Cross-module imports are explicit

**Layering (UI):**
- `24pray-web/src/components/ui/` — primitive, design-token-bound components (Button, Card, Input, Sheet, Toast…) built on Radix primitives + `cn()`
- `24pray-web/src/components/patterns/` — feature-composed blocks (ProjectCard, AppShell, FeedbackDialog…)
- `24pray-web/src/components/slots/` — one feature domain with its own `logic.ts` (pure functions), `store.ts` (zustand + hooks), `types.ts`
- `24pray-web/src/lib/` — framework-free helpers (api, i18n, time, share, funnel, cities, seo)
- `24pray-web/src/app/` — routes; thin server components delegate to `*Client` components (`'use client'`)

**State (UI):**
- Server-fetched data flows through the `ApiClient`; client state lives in zustand stores colocated with the feature (`useSlotGridStore`, `24pray-web/src/components/slots/store.ts:23`) plus `'use client'` hooks (`useAuth`, `24pray-web/src/hooks/use-auth.ts`)
- i18n is module-level, not React-context-only: `t()`/`setLocale()` from `24pray-web/src/lib/i18n.ts` (de catalog = source of truth, typed so missing keys fail compilation); `LocaleProvider` (`24pray-web/src/lib/locale-context.tsx`) remounts non-consumer children on switch and sets `<html lang>`/`dir` (RTL for he/ar)

**Composition root (API):**
- `24pray-api/src/app.ts` is the only place all routes/plugins are wired (plugin registration, error handler, route calls). New API routes are added here, not in `24pray-api/src/server.ts`
- DI flows: `24pray-api/src/server.ts` builds real services → `buildApp(deps)` accepts overrides (`mailer?`, `pushSender?`, `disableWriteRateLimits?`) so tests substitute fakes (`24pray-api/src/app.ts:20-29`)

**Validation split (API):**
- Shared request schemas in `24pray-api/src/schemas/`, reused across routes
- One-off schemas at the top of the consuming route file: `FeedbackBody` (`24pray-api/src/routes/feedback.ts:6-10`), `CancelQuery`/`InviteQuery` (`24pray-api/src/routes/slots.ts:21-22`)
- All request parsing goes through Zod `.parse()` inside handlers — there is no Fastify JSON schema wiring
- **UI:** has no runtime request validation; it trusts its own typed `ApiClient` calls and the API's Zod gate

**Configuration:**
- **API:** All environment access is centralized in `24pray-api/src/env.ts` (Zod schema, defaults, `superRefine` cross-field rules, injectable `parseEnv`). Never read `process.env` outside `src/env.ts` (and `scripts/`)
- **UI:** `NEXT_PUBLIC_API_URL` is read in exactly one place (`24pray-web/src/lib/api.ts:1`); `next.config.mjs` rewrites `/api/:path*` to the API for same-origin fetches in production

## Cross-Project Consistency

Verified conventions shared by both repos — keep new code aligned with ALL of these:
- **Comment language:** German, with ruling/ticket ID prefixes (`A1`, `W3`, `F2`, `Backlog N`, `fixN`)
- **User-facing strings:** German (API error messages; UI catalog in `24pray-web/src/lib/i18n.ts`, de = source of truth, all 5 locales `de|en|es|he|ar` kept key-complete via types)
- **Test naming:** German `describe`/`it` titles in behavior suites; scenario prefixes in fixture values (`un7-`, `wb-`, `ux `)
- **Testable time:** explicit `now` injection (API: default param; UI: prop/context), never fake timers
- **Co-located tests:** `*.test.ts(x)` beside the implementation in both repos
- **Strict TypeScript:** `strict: true` in both `tsconfig.json` files; CI runs `npx tsc --noEmit` in both repos
- **Styling:** `console.*` only, no logger framework; 2-space/single-quote/trailing-comma style

## Verified Inconsistencies (consolidation candidates)

Verified on 2026-10-26 — flag for a future tooling-consolidation phase; do NOT "fix" silently:
1. **Vitest major-version skew:** `24pray-api/package.json` pins `vitest ^2.0.0`; `24pray-web/package.json` pins `vitest ^4.1.10` (and uses the Vitest-4 `oxc` JSX option in `24pray-web/vitest.config.ts`). Same test syntax, different majors and lockfiles
2. **Linting gap:** UI has ESLint (`next lint` in CI via `24pray-web/.eslintrc.json`); API has no linter at all
3. **Import systems:** UI uses the `@/*` alias (tsconfig + vitest alias); API uses relative `.js`-suffixed imports, no alias
4. **Test environment strategy:** API runs everything in `node`; UI defaults to `node` and opts DOM-heavy files into jsdom per file via `// @vitest-environment jsdom`
5. **Test parallelism:** API sets `fileParallelism: false` (shared SQLite migration workloads); UI leaves the default
6. **tsconfig targets:** API `target ES2022 / module ES2022` with emit to `dist/`; UI `target ES2017 / module esnext / jsx preserve / noEmit` (Next-compiled)
7. **Mocking philosophy:** API — almost no module mocks (DI + real SQLite); UI — heavy `vi.mock` factories + `vi.stubGlobal('fetch', …)`. This is framework-driven (Fastify DI vs Next module graph) and should stay as-is per repo
8. **Node engine declaration:** API declares `engines: { node: ">=22" }`; UI pins Node only in CI (`node-version: '22'`)

---
*Convention analysis: 2026-10-26*
