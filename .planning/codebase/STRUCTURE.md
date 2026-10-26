---
last_mapped_commit: a09e3c06c1da2363a2db1774a9fc13e7c60a3839
last_mapped_at: 2026-10-26
---
# Codebase Structure

**Analysis Date:** 2026-10-26

**Scope:** Two sibling repositories under `/home/pmi/` form the product:

- **API repo:** `/home/pmi/24pray-api` — remote `github.com/PhilippMaly/24pray-server.git` (directory `24pray-api`, GitHub project **24pray-server**)
- **UI repo:** `/home/pmi/24pray-web` — remote `github.com/PhilippMichaly/24pray-web.git`

**Path convention:** paths starting `24pray-api/` are relative to `/home/pmi/24pray-api`; paths starting `24pray-web/` are relative to `/home/pmi/24pray-web`. Both repos are independent git checkouts with their own `package-lock.json`, CI, and docs.

## Directory Layout

```
/home/pmi/
├── 24pray-api/                 # Backend — Fastify 5 + SQLite (Prisma)
│   ├── src/                    # All runtime code
│   │   ├── server.ts           # Process entry: wiring, listen, jobs, shutdown
│   │   ├── app.ts              # buildApp composition root (Fastify factory)
│   │   ├── env.ts              # Zod-validated environment config
│   │   ├── db.ts               # PrismaClient factory
│   │   ├── *.test.ts           # App/env/db tests (co-located)
│   │   ├── lib/                # Domain libs & adapters (mailer, push, tokens,
│   │   │                       #   access, slotGrid, projectView, calendar,
│   │   │                       #   jobs, adminNotify, unsubscribe) + *.test.ts
│   │   ├── plugins/auth.ts     # Session-cookie preHandler hook + requireUser
│   │   ├── routes/             # 8 domain modules *Routes(app, deps) + *.test.ts
│   │   ├── schemas/            # Shared zod bodies (auth, me, projects, slots)
│   │   └── test/helpers.ts     # makeTestDb: temp SQLite + prisma migrate deploy
│   ├── prisma/
│   │   ├── schema.prisma       # 13 models, SQLite, FTS5 sidecar note
│   │   └── migrations/         # 20+ timestamped dirs (never edit, add new)
│   ├── scripts/import-cities.ts# One-off GeoNames importer (npm run import:cities)
│   ├── deploy/                 # Prod artifacts: Dockerfile refs entrypoint,
│   │                           #   nginx.conf, systemd unit, selfcheck, RUNBOOK
│   ├── docs/                   # Design spec, security audit, NOTIFICATIONS,
│   │                           #   superpowers/plans/
│   ├── data/                   # Runtime SQLite (gitignored)
│   ├── dist/                   # tsc output (gitignored)
│   ├── Dockerfile              # Multi-stage API image (only product containerized)
│   └── .github/workflows/ci.yml# node22: npm ci → prisma generate → tsc → vitest
│
└── 24pray-web/                 # Frontend — Next.js 15 (App Router) + Tailwind
    ├── src/
    │   ├── middleware.ts       # Locale redirect/rewrite, x-locale headers
    │   ├── app/                # App Router tree (see breakdown below)
    │   ├── components/
    │   │   ├── ui/             # Primitives: Button, Sheet, Toast, Tabs, …
    │   │   ├── patterns/       # Domain molecules: Globe, AppShell, InviteCard, …
    │   │   └── slots/          # Slot-grid core: ChainBand, SlotList, SlotSheet,
    │   │                       #   logic.ts (pure), store.ts (zustand), types.ts
    │   ├── lib/
    │   │   ├── api.ts          # Browser ApiClient + domain helpers
    │   │   ├── api-server.ts   # SSR client: anonymous, PUBLIC-only, fail-soft
    │   │   ├── auth.ts         # getMe/logout wrappers
    │   │   ├── funnel.ts       # useFunnelPing (fire-and-forget)
    │   │   ├── push.ts         # VAPID subscribe/unsubscribe flow
    │   │   ├── i18n.ts         # 5-locale catalog (de source of truth)
    │   │   ├── locale-context.tsx # LocaleProvider/useLocale
    │   │   ├── routes.ts       # Slug map, UNPREFIXED_ROUTES, hreflang helpers
    │   │   ├── seo.ts          # JSON-LD builders
    │   │   ├── time.ts         # Timezone-aware formatting
    │   │   ├── cities.ts · mylocation.ts · share.ts · anbieter.ts · utils.ts
    │   ├── hooks/use-auth.ts   # useAuth(): /auth/me once per mount
    │   ├── content/guides.ts   # Guide articles (de/en/es)
    │   └── types/index.ts      # Hand-mirror of API wire types
    ├── public/                 # sw.js (push-only), manifest, icons, earth/, og-image
    ├── docs/                   # DESIGN-VISION, I18N, WHITE-LABEL, BACKLOG, specs/
    ├── .next/                  # Build/dev output (gitignored)
    ├── next.config.mjs         # /api/:path* rewrite → API
    ├── tailwind.config.ts · postcss.config.mjs
    └── .github/workflows/ci.yml# node22: ci (tsc, lint, vitest) + build (/api)
```

UI route tree inside `24pray-web/src/app/`:

```
src/app/
├── layout.tsx            # Root layout: fonts, <html lang/dir>, Providers
├── providers.tsx         # ThemeProvider + LocaleProvider + Toaster
├── globals.css           # Tailwind + design tokens
├── robots.ts · sitemap.ts# Generated robots/sitemap (sitemap: PUBLIC watches × 5 locales)
├── [locale]/             # PUBLIC, indexable, locale-prefixed
│   ├── layout.tsx        # Validates locale, else notFound()
│   ├── page.tsx + landing-client.tsx      # Landing (SSR text + client globe/stats)
│   ├── watches/page.tsx                   # Open watches list, fully SSR
│   ├── guide/page.tsx · guide/[slug]/     # Guide (de/en/es)
│   └── projects/[id]/                     # Watch detail: page.tsx (SSR prefetch),
│       # metadata.ts · watch-client.tsx   #   metadata (OG), watch-client (grid/booking)
├── auth/login · auth/verify # Unprefixed app: magic-link + token verify
├── dashboard/             # Own projects + open watches (client)
├── profil/                # Rename, reminder pref, push settings, delete account
├── projects/new/          # Create watch
├── join/[token]/          # Invite landing
└── impressum/ · datenschutz/  # Legal (German only)
```

## Directory Purposes

**`24pray-api/src/`:**
- Purpose: all backend runtime code; only `scripts/import-cities.ts` lives outside and is standalone.
- Key files: `24pray-api/src/server.ts`, `24pray-api/src/app.ts`, `24pray-api/src/env.ts`, `24pray-api/src/db.ts`

**`24pray-api/src/routes/`:** one `xRoutes(app, deps)` module per domain (auth, projects, slots, community, me, funnel, feedback, push); handler-local zod schemas and helpers stay in-file.

**`24pray-api/src/lib/`:** HTTP-free domain logic and adapters; one module per concern with a co-located test. `jobs.ts` is the only background-work module.

**`24pray-api/prisma/`:** data model + migrations; `city_fts` FTS5 sidecar is raw-SQL-only (see `24pray-api/src/routes/community.ts:325-336`).

**`24pray-api/deploy/`:** production packaging for **both** products — nginx config routing `/`→web and `/api/`→API, systemd units, selfcheck, and the full runbook `24pray-api/deploy/README.md` (`24pray-web` has no deploy dir; its deployment is documented there).

**`24pray-api/docs/`:** API design spec, security audit, notification decisions, dated superpowers plans.

**`24pray-web/src/app/`:** App Router pages. Public/indexable pages under `[locale]/` (server components, SEO-first); app interactions unprefixed (`/dashboard`, `/profil`, `/auth/*`, `/join/*`, `/projects/new`); legal pages German-only.

**`24pray-web/src/components/`:** `ui/` primitives, `patterns/` domain molecules, `slots/` the booking grid core (pure logic in `logic.ts`, zustand store in `store.ts`, view-model types in `types.ts`).

**`24pray-web/src/lib/`:** browser API client (`api.ts`), SSR API client (`api-server.ts`), i18n catalog, route/slug map, SEO JSON-LD, time formatting, push/funnel helpers.

**`24pray-web/src/types/`:** hand-maintained mirror of API wire types (see Architecture → cross-repo coupling).

**`24pray-web/docs/`:** design vision + binding design-system spec, i18n guide, white-label guide, backlog, dated specs.

**`24pray-web/public/`:** static assets — push-only service worker (`sw.js`), PWA manifest/icons, NASA earth textures for the globe.

## Key File Locations

**Entry Points:**
- `24pray-api/src/server.ts`: API process entry (`npm run dev` / `npm start` / Docker)
- `24pray-api/src/app.ts`: `buildApp` factory used by server and all API tests
- `24pray-api/deploy/docker-entrypoint.sh`: container entry (migrations, then `node dist/server.js`)
- `24pray-api/scripts/import-cities.ts`: one-off GeoNames import CLI
- `24pray-web` (package scripts): `npm run dev` → `next dev` (:3000); `npm start` → `next start`; production runs as systemd `24pray-web` per runbook
- `24pray-web/src/middleware.ts`: every page request passes through locale resolution first

**Configuration:**
- `24pray-api/package.json`: scripts (`dev`, `build`→tsc, `start`, `migrate:dev/deploy`, `test`, `import:cities`), `engines.node >=22`, ESM
- `24pray-api/tsconfig.json`: ES2022, `moduleResolution: Bundler`, `rootDir: src`, `outDir: dist`
- `24pray-api/vitest.config.ts`: node env, `src/**/*.test.ts`, `fileParallelism: false`, injects `APP_URL`
- `24pray-api/.env.example`: documented env template (authoritative list lives in `24pray-api/src/env.ts`)
- `24pray-web/next.config.mjs`: `/api/:path*` rewrite to the API (`NEXT_PUBLIC_API_URL || http://localhost:3001`)
- `24pray-web/tsconfig.json`: `noEmit`, paths alias `@/* → ./src/*`, JSX preserve (Vitest transforms JSX itself via `vitest.config.ts` oxc setting)
- `24pray-web/.env.example`: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, optional `API_URL_INTERNAL`

**Core Logic:**
- `24pray-api/src/plugins/auth.ts`: session resolution; `requireUser`
- `24pray-api/src/lib/access.ts`: all project authorization (`canReadProject`, `isParticipant`, …)
- `24pray-api/src/lib/slotGrid.ts` + `24pray-api/src/lib/projectView.ts`: grid math, masking, wire serializers
- `24pray-api/src/lib/jobs.ts`: minutely completion/reminders, hourly cleanup
- `24pray-web/src/lib/api.ts` + `24pray-web/src/lib/api-server.ts`: the only two places the UI talks to the API
- `24pray-web/src/components/slots/logic.ts` + `store.ts`: slot view-models and booking state
- `24pray-web/src/middleware.ts` + `24pray-web/src/lib/routes.ts`: URL schema (localized slugs, unprefixed app routes)

**Testing:**
- `24pray-api/src/test/helpers.ts`: `makeTestDb()` — temp SQLite + `prisma migrate deploy`
- `24pray-api/src/**/*.test.ts`: API suites via `buildApp` + `app.inject` (real DB, fake mailer)
- `24pray-web/src/**/*.test.{ts,tsx}`: UI unit/component tests (jsdom via @testing-library/react, no backend); config `24pray-web/vitest.config.ts`

## Naming Conventions

**Files (both repos):**
- camelCase source modules: `slotGrid.ts`, `adminNotify.ts`, `watch-client.tsx`, `api-server.ts`
- Route/schema modules match their domain exactly: `projects.ts`, `slots.ts`, `[locale]/`, `[id]/`
- kebab-case for standalone scripts and docs: `import-cities.ts`, `2026-10-23-security-audit.md`
- Tests: co-located, same basename + `.test.ts` / `.test.tsx`
- API migrations: `<YYYYMMDDHHMMSS>_<snake_case_topic>/` (Prisma convention)

**Directories:**
- lowercase plural groups: `src/routes/`, `src/schemas/`, `src/components/patterns/`
- UI groups by role: `ui/` (primitives) · `patterns/` (molecules) · `slots/` (domain core)

**Code:**
- API route factories `xRoutes(app, deps)`; plugins `registerX(app, …)`; factories `createX` (`createMailer`, `createPrisma`); limits as SCREAMING_SNAKE near top of file
- UI hooks `useX` (`useAuth`, `useSlotGrid`, `useFunnelPing`); client components carry `'use client'`; zustand stores `useXStore`
- User-facing strings and comments: German (both repos); identifiers and API fields: English
- Path alias `@/*` for UI imports (`24pray-web/tsconfig.json`); the API uses explicit relative `./`/`../` imports with `.js` extensions (ESM)

## Where to Add New Code

**New API endpoint:**
- Route handlers: `24pray-api/src/routes/<domain>.ts` (follow `(app, deps) => void`, local `httpError`, `config.rateLimit` on public mutations)
- Register: `24pray-api/src/app.ts` next to existing registrations (`:85-92`)
- Shared schemas: `24pray-api/src/schemas/<domain>.ts` (single-use schemas may stay inline)
- Tests: `24pray-api/src/routes/<domain>.test.ts` using `makeTestDb` + `buildApp` + `inject`
- **Cross-repo:** mirror the response shape in `24pray-web/src/types/index.ts` and add a typed helper in `24pray-web/src/lib/api.ts` (browser) or `24pray-web/src/lib/api-server.ts` (SSR, PUBLIC-only + fail-soft)

**New UI page:**
- Public/indexable: under `24pray-web/src/app/[locale]/` (server component for content; client island for interaction), localized slug if it is a section (`24pray-web/src/lib/routes.ts` SECTION_SLUGS), middleware rules updated if needed
- App page: unprefixed under `24pray-web/src/app/<name>/` and add to `UNPREFIXED_ROUTES` in `24pray-web/src/lib/routes.ts` so middleware leaves it alone — only if it must be link-stable like the other app routes

**Cross-cutting behavior:**
- API: `24pray-api/src/plugins/<name>.ts`, registered in `buildApp` before routes
- UI: primitives → `24pray-web/src/components/ui/`; domain molecules → `24pray-web/src/components/patterns/`

**Outbound email kind (API):**
- Add to the `Mailer` interface and BOTH transports in `24pray-api/src/lib/mailer.ts` (console branch ~line 234, SMTP branch ~line 266); call fire-and-forget from the route; if the mail links into the UI, check the path against `UNPREFIXED_ROUTES` / middleware first

**New env var:**
- API: `24pray-api/src/env.ts` + `.env.example` + `env.test.ts`
- UI: `.env.example` + read it at the top of the relevant `lib/` module (browser: `NEXT_PUBLIC_*`, baked at build; SSR-only: plain `process.env`, runtime)

**New DB model/field (API):**
- `24pray-api/prisma/schema.prisma` + `npm run migrate:dev` (new timestamped migration); FTS access via `$queryRaw` only

**Utilities:**
- API: `24pray-api/src/lib/` + co-located test (take `prisma` as parameter)
- UI: `24pray-web/src/lib/` + co-located test; page-scoped helpers stay in the page file

## Special Directories

**`24pray-api/dist/`:** tsc build output (`npm run build`); gitignored; consumed by `npm start`/Docker.

**`24pray-api/data/`:** runtime SQLite DB (`24pray.db` + WAL sidecars) from `DATA_DIR`; gitignored; live file exists in the working tree.

**`24pray-web/.next/`:** Next build/dev output; gitignored; **never run `npm run build` while `npm run dev` is running** (shared `.next/` breaks the dev server — `24pray-web/README.md`).

**`node_modules/.prisma/` (API):** generated Prisma client; regenerate via `npx prisma generate`.

**`.planning/` (API repo):** GSD workflow artifacts, including this map (`24pray-api/.planning/codebase/`). There is no `.planning/` in `24pray-web`.

**`.superpowers/` (both repos):** SDD workflow state (security-hardening run, 2026-10-23); generated by the workflow.

**`docs/superpowers/plans/` (API) and `docs/` (web):** authored specs/plans, dated filenames; committed.

---

*Structure analysis: 2026-10-26 (API + UI repositories)*
