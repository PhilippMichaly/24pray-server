---
last_mapped_commit: a09e3c06c1da2363a2db1774a9fc13e7c60a3839
last_mapped_at: 2026-10-26
---
# Technology Stack

**Analysis Date:** 2026-10-26

## Repositories Covered

- **`24pray-api`** (`/home/pmi/24pray-api`) — backend API: Fastify + SQLite (Prisma) + magic-link auth
- **`24pray-web`** (`/home/pmi/24pray-web`) — frontend UI: Next.js + TailwindCSS, the only consumer of the API

Path convention below: repo-relative paths are prefixed with the repo name (`24pray-api/src/app.ts`, `24pray-web/src/lib/api.ts`). Both repos are siblings under `/home/pmi/`.

## Languages

**Primary:**
- TypeScript (strict mode) — all of `24pray-api/src/` + `24pray-api/scripts/`, and all of `24pray-web/src/`
  - API: target ES2022, ESM modules (`"type": "module"` in `24pray-api/package.json`), `.js`-suffixed imports with `moduleResolution: Bundler` (`24pray-api/tsconfig.json`)
  - UI: target ES2017, JSX preserved, path alias `@/*` → `./src/*` (`24pray-web/tsconfig.json`)

**Secondary:**
- SQL — Prisma migrations in `24pray-api/prisma/migrations/`, raw queries in `24pray-api/src/routes/community.ts:315` (SQLite FTS5) and PRAGMA in `24pray-api/src/app.ts:38`
- CSS (Tailwind utility + semantic design tokens) — `24pray-web/src/app/globals.css`, `24pray-web/tailwind.config.ts`
- Bash — `24pray-api/deploy/docker-entrypoint.sh`, `24pray-api/deploy/24pray-selfcheck.sh`
- Shell/Python 3 — inline Python for SMTP-URL parsing in `24pray-api/deploy/24pray-selfcheck.sh:59` (server-side only, not part of the API)

## Runtime

**API (`24pray-api`):**
- Node.js >= 22 (`engines` in `24pray-api/package.json:7-9`; dev machine runs v22.22.0)
- ES2022 features used natively (`Intl.DateTimeFormat`, `node:crypto`, `node:fs`, `node:url`, `node:readline`)

**UI (`24pray-web`):**
- Node 22 for `next dev` / `next build` / `next start` (CI pins Node 22 in `24pray-web/.github/workflows/ci.yml:24`)
- Browser runtime: modern evergreen browsers; PWA via service worker `24pray-web/public/sw.js` (push only, no caching); no server runtime beyond Next itself

**Package Manager:**
- npm (local v11.13.0) in both repos
- Lockfiles: present in both (`24pray-api/package-lock.json`, `24pray-web/package-lock.json`)

## Frameworks

**API (`24pray-api`) — Core:**
- Fastify `^5.12.7` — HTTP server, instance built in `24pray-api/src/app.ts:45` (`buildApp()`), entry point `24pray-api/src/server.ts`
- @fastify/cookie `^11.1.3` — session cookie parsing (`24pray-api/src/app.ts:50`)
- @fastify/cors `^10.1.0` — origin allowlist `APP_URL` + `CORS_ORIGINS` (`24pray-api/src/app.ts:48-49`)
- @fastify/rate-limit `^10.3.0` — per-route limits, German 429 body via `errorResponseBuilder` (`24pray-api/src/app.ts:53-59`), write-route Pro-IP limits in `24pray-api/src/routes/projects.ts` / `24pray-api/src/routes/slots.ts`
- Prisma `^5.18.0` (`@prisma/client` + `prisma` CLI) — ORM over SQLite, client factory in `24pray-api/src/db.ts`, schema in `24pray-api/prisma/schema.prisma`

**UI (`24pray-web`) — Core:**
- Next.js `~15.5.28` (App Router, pinned via `overrides` in `24pray-web/package.json`) — pages/SSR/metadata in `24pray-web/src/app/`, locale middleware in `24pray-web/src/middleware.ts`
- React `^18.3.0` (+ react-dom) — client components with `'use client'`
- TailwindCSS `^3.4.0` — semantic tokens (`bg-surface`, `text-ink` …) in `24pray-web/tailwind.config.ts`; raw palette classes forbidden by lint rule (`24pray-web/.eslintrc.json`)
- Radix UI primitives (`@radix-ui/react-dialog`, `-dropdown-menu`, `-slot`, `-tabs`, `-tooltip`) — wrapped by components in `24pray-web/src/components/ui/`
- zustand `^4.5.0` — slot-grid client state (`24pray-web/src/components/slots/store.ts`)
- next-themes `^0.4.6` — light/dark theming (`24pray-web/src/app/providers.tsx`)
- zod `^3.23.0`, class-variance-authority `^0.7.1`, clsx, tailwind-merge, lucide-react (icons)

**Validation:**
- zod — API: env parsing (`24pray-api/src/env.ts`), request bodies in every route, schemas in `24pray-api/src/schemas/`. UI: client-side input validation only.

**Testing:**
- API: Vitest `^2.0.0` — config `24pray-api/vitest.config.ts` (node environment, `src/**/*.test.ts`, `fileParallelism: false`)
- UI: Vitest `^4.1.10` + @testing-library/react `^16.3.2` + jsdom — config `24pray-web/vitest.config.ts` (oxc JSX transform, `@` alias)

**Build/Dev:**
- API: typescript `^5.5.0` (`tsc` emits to `dist/` with sourcemaps), tsx `^4.16.0` (dev runner + scripts)
- UI: `next build` / `next dev` / `next start`; ESLint `^8.57.1` with `eslint-config-next`; PostCSS + autoprefixer; fonts via `next/font/google` (Fraunces, DM Sans — self-hosted at build time, `24pray-web/src/app/layout.tsx:3-22`)

**Runtime libraries (API only):**
- nodemailer `^10.2.1` — SMTP transport for all transactional mail (`24pray-api/src/lib/mailer.ts:266`)
- web-push `^3.6.7` — VAPID web push notifications (`24pray-api/src/lib/push.ts:33`)

## Key Dependencies

**Critical:**
- `fastify` (API) — the entire API surface; route modules in `24pray-api/src/routes/` receive the instance from `24pray-api/src/app.ts`
- `next` (UI) — the entire UI; app screens in `24pray-web/src/app/`, components in `24pray-web/src/components/`
- `@prisma/client` (API) — all persistence; 13 models in `24pray-api/prisma/schema.prisma` (User, PrayerProject, PrayerSlot, Membership, RecurringCommitment, PrayerRequest, UpdateOptOut, FunnelCount, PushSubscription, ReminderPreference, MagicToken, Session, City)
- `zod` (both) — API: single source of truth for env config, request validation, error shaping (ZodError → 400 in `24pray-api/src/app.ts:62-64`). UI: input validation.
- `nodemailer` (API) — passwordless login (magic link + 6-digit code), reminders, booking confirmations/notices, schedule changes, update notices, feedback, admin notifications
- `web-push` (API) — second notification channel; fail-closed when VAPID env vars are missing (`24pray-api/src/lib/push.ts:29-31`)

**Infrastructure:**
- `@fastify/rate-limit` (API) — brute-force brake on `/auth/*` and booking/project creation
- `@fastify/cookie` + `@fastify/cors` (API) — session transport and cross-origin allowlist
- `@radix-ui/*` + `zustand` + `next-themes` (UI) — component primitives, client state, theming
- `@types/node`, `@types/web-push` (API); `@types/react*`, `@vitejs/plugin-react` (UI) — type/test packages

## Configuration

**API (`24pray-api`) — Environment:**
- All configuration via environment variables, parsed and validated once at import time by zod in `24pray-api/src/env.ts` (`export const env = parseEnv()`)
- Loaded via `node --env-file-if-exists=.env` (`24pray-api/package.json` scripts) — `.env` present locally (never read/committed); `.env.example` present as template
- Startup cross-validation in `24pray-api/src/env.ts:45-60`: `UNSUBSCRIBE_SECRET` (>= 32 chars) required when `SMTP_URL` is set; `DEV_LOGIN_RESPONSE` forbidden with `COOKIE_SECURE` or https `APP_URL`
- Only `APP_URL` is strictly required; everything else has a default

**UI (`24pray-web`) — Environment:**
- `NEXT_PUBLIC_API_URL` — browser API base; in production the relative `/api` (rewritten by nginx/Next to the API), in dev `http://localhost:3001` (template: `24pray-web/.env.example:1`). **Build-time baked** — changes require rebuild.
- `NEXT_PUBLIC_APP_URL` — absolute base for canonical/hreflang/sitemap URLs, build-time baked; default fallback `https://24pray.org` (`24pray-web/src/lib/routes.ts:12`)
- `API_URL_INTERNAL` — server-only SSR fetch base for public pages, default `http://localhost:3001` (`24pray-web/src/lib/api-server.ts:17`)
- Local dev env in `.env.local` (present locally, gitignored — never read); template `.env.example`
- No secrets exist for the UI — all three vars are public by design (`NEXT_PUBLIC_*` ship to the browser)

**API Build:**
- `24pray-api/tsconfig.json` — strict ES2022, `rootDir: src`, `outDir: dist`, sourcemaps, no declarations
- `24pray-api/Dockerfile` — multi-stage `node:22-slim` build (`npm ci` → `prisma generate` → `tsc`), runtime stage with `USER node`, `EXPOSE 3001`, entrypoint `24pray-api/deploy/docker-entrypoint.sh` (runs `prisma migrate deploy` then `node dist/server.js`)
- `24pray-api/.dockerignore` — excludes local artifacts from image context

**UI Build:**
- `24pray-web/next.config.mjs` — `poweredByHeader: false`; rewrite `/api/:path*` → `${NEXT_PUBLIC_API_URL}/:path*` (dev proxy to the API)
- `24pray-web/tsconfig.json` — strict, `noEmit`, incremental, `@/*` alias
- `24pray-web/vitest.config.ts` — vitest 4 with oxc JSX transform
- `24pray-web/.eslintrc.json` — `next/core-web-vitals` + custom `no-restricted-syntax` rules enforcing semantic Tailwind tokens (raw palette classes banned)
- `24pray-web/tailwind.config.ts`, `24pray-web/postcss.config.mjs` — design tokens, content globs
- No Dockerfile and no versioned deploy artifacts in the UI repo — deployment is defined entirely in the API repo (`24pray-api/deploy/README.md`)

**Deploy configuration (versioned in `24pray-api/deploy/`):**
- `24pray-api/deploy/24pray-api.service` — systemd unit with sandbox hardening (`ProtectSystem=strict`, `ProtectHome`, `SystemCallFilter=@system-service`, `ReadWritePaths=/opt/24pray/data`), `EnvironmentFile=/etc/24pray-api.env`
- `24pray-api/deploy/nginx.conf` — production nginx vhost: TLS (certbot), `/api/` → `127.0.0.1:3001`, `/` → Next.js `127.0.0.1:3000`, security headers, token-stripped access log
- `24pray-api/deploy/docker-entrypoint.sh`, `24pray-api/deploy/24pray-selfcheck.sh` — container start and VPS monitoring (checks both `24pray-api` and `24pray-web` services)
- `24pray-api/.github/workflows/ci.yml` — CI: `npm ci` → `prisma generate` → `tsc --noEmit` → `vitest run` on Node 22
- `24pray-web/.github/workflows/ci.yml` — CI: test job (`npm ci` → `tsc --noEmit` → `next lint` → `vitest run`) + build job (`next build` with `NEXT_PUBLIC_API_URL=/api`), Node 22

## Platform Requirements

**Development:**
- Node >= 22, npm; API SQLite created automatically under `DATA_DIR` (default `./data`, see `24pray-api/data/24pray.db` + WAL sidecars)
- `npx prisma migrate dev` for API schema changes; `npm run dev` (API) on `http://localhost:3001`, `npm run dev` (UI) on `http://localhost:3000` — both must run, the UI proxies/rewrites `/api` to the API
- Without `SMTP_URL` API mails are logged to console; `DEV_LOGIN_RESPONSE=true` enables the local/E2E login shortcut (the UI shows a direct-login button)
- UI: never run `next build` next to a running `next dev` (shared `.next/` corrupts the dev server)

**Production:**
- One VPS hosts both repos (per `24pray-api/deploy/README.md`): Ubuntu 24.04+, systemd `24pray-api.service` (from `24pray-api/deploy/24pray-api.service`) behind nginx at `https://24pray.org`, sibling Next.js service `24pray-web` (unit defined inline in the runbook) on port 3000, SQLite at `/opt/24pray/data/24pray.db`
- API migrations run automatically at service start (`ExecStartPre` in the systemd unit, entrypoint in the container)
- Alternative for the API only: Docker image from `24pray-api/Dockerfile` (port 3001, `HOST=0.0.0.0`, non-root `node` user, data volume at `/app/data`). No container setup exists for the UI.

---

*Stack analysis: 2026-10-26*
