---
last_mapped_commit: a09e3c06c1da2363a2db1774a9fc13e7c60a3839
last_mapped_at: 2026-10-26
---
# External Integrations

**Analysis Date:** 2026-10-26

## Repositories Covered

- **`24pray-api`** (`/home/pmi/24pray-api`) — backend API (owns all data, auth, mail, push)
- **`24pray-web`** (`/home/pmi/24pray-web`) — frontend UI (only consumer of the API; holds no secrets and talks to no third-party backend)

Path convention below: repo-relative paths prefixed with the repo name. Both repos are siblings under `/home/pmi/`.

## Cross-Repo Integration (API ↔ UI)

**Topology (production, per `24pray-api/deploy/README.md`):**

```text
Browser ──HTTPS──▶ nginx (24pray.org, TLS via certbot)
                    ├── /api/  ──▶ Fastify   127.0.0.1:3001  (24pray-api, systemd 24pray-api)
                    └── /      ──▶ Next.js   127.0.0.1:3000  (24pray-web, systemd 24pray-web)
                                     └─ API SSR fetches ──▶ 127.0.0.1:3001 (API_URL_INTERNAL)
                                                        └─ SQLite /opt/24pray/data/24pray.db
```

**The UI is the API's only client. Two API clients exist in the UI repo:**
- Browser client — `24pray-web/src/lib/api.ts` (`ApiClient`, `credentials: 'include'` for the httpOnly session cookie, JSON only when a body is present). Base: `NEXT_PUBLIC_API_URL` (production: relative `/api`, same-origin through nginx).
- Server-side SSR client — `24pray-web/src/lib/api-server.ts`, anonymous only, fetches exclusively PUBLIC data over `API_URL_INTERNAL` (default `http://localhost:3001`), 3 s timeout, failure-tolerant by design; the PUBLIC filter is re-applied in the UI before anything reaches HTML/meta tags.

**Contract points between the repos:**
- Session auth: cookie name `session` (set by `24pray-api/src/routes/auth.ts:109`), trusted via `trustProxy` loopback only (`24pray-api/src/app.ts:45`) — same-origin through nginx makes SameSite=Lax work without CORS
- Guest cancellation: `X-Guest-Token` header (`24pray-web/src/lib/api.ts:89-95` ↔ `24pray-api/src/routes/slots.ts`)
- Private-project access: `?invite=` query token (`24pray-web/src/lib/api.ts:64` ↔ `24pray-api/src/routes/projects.ts`)
- Push: UI reads `GET /push/vapid-key`, subscribes via `POST /me/push-subscriptions` (`24pray-web/src/lib/push.ts`) ↔ `24pray-api/src/routes/push.ts`
- Funnel counting: UI pings `POST /funnel/hit` (`24pray-web/src/lib/funnel.ts`) ↔ `24pray-api/src/routes/funnel.ts`
- Endpoint surface consumed by the UI: `/auth/*`, `/me*` (profile, reminder prefs, push subscriptions, delete), `/projects*` (CRUD, slots, requests, stats, shift, invite rotate, unsubscribe), `/slots/*` (book, cancel, recur), `/geocode`, `/push/vapid-key`, `/funnel/hit`, `/feedback`, `/stats/public`, `/health`

**Configuration coupling:**
- API `APP_URL` must equal the public origin (it is the always-allowed CORS origin and the base of all mailed links); additional frontends come in via `CORS_ORIGINS` (`24pray-api/src/env.ts:12-17`)
- UI `NEXT_PUBLIC_API_URL=/api` (relative) keeps the web build domain-independent — nginx strips the `/api/` prefix when proxying (`24pray-api/deploy/nginx.conf:48-54`)
- API mailed links point at UI routes that stay deliberately unprefixed (`/auth/verify`, `/join/<token>`, `/dashboard`, `/projects/new`) so existing mails keep working; the UI middleware only prefixes public/marketing routes (`24pray-web/src/middleware.ts:83-94`, rationale in `24pray-web/README.md:70-74`)

**Deployment coupling:**
- One runbook (`24pray-api/deploy/README.md`) deploys BOTH repos: `rsync ~/24pray-api/ …` + `rsync ~/24pray-web/ …` to `/opt/24pray/{api,web}`, then builds and restarts both services
- The `24pray-web` systemd unit exists only inline in that runbook; the API unit is versioned at `24pray-api/deploy/24pray-api.service`
- The VPS selfcheck (`24pray-api/deploy/24pray-selfcheck.sh`) monitors both services plus the API endpoint behind the public URL

## APIs & External Services

**Email (SMTP) — `24pray-api` only:**
- Outbound transactional mail only — magic links, booking confirmations/notices, reminders, schedule-change and farewell mails, localized update notices, user feedback, admin notifications
- SDK/Client: `nodemailer` (`24pray-api/src/lib/mailer.ts:266`), transport created from `SMTP_URL` (URL form, e.g. `smtps://…@smtp.strato.de:465` in production per `24pray-api/deploy/README.md`)
- Auth: credentials embedded in `SMTP_URL` (percent-encoded user/password); sender identity via `SMTP_FROM`
- Dev fallback: empty `SMTP_URL` → console-logging mailer (`24pray-api/src/lib/mailer.ts:234-265`), no external calls
- Server-side monitoring mail: `24pray-api/deploy/24pray-selfcheck.sh` sends alarm mails directly via `curl` SMTP upload (not through the API), reading `SMTP_URL` and `SELFCHECK_TO` from `/etc/24pray-api.env`

**Web Push (VAPID):**
- API side (sending): `web-push` (`24pray-api/src/lib/push.ts:33`), auth via `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` env vars — all three empty = feature off (routes 404, jobs no-op)
- SSRF guard: endpoints restricted to allowlisted hosts `fcm.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com`, `push.apple.com` (`24pray-api/src/lib/push.ts:6-22`); expired subscriptions (404/410) auto-deleted (`24pray-api/src/lib/push.ts:56-59`)
- UI side (receiving): service worker `24pray-web/public/sw.js` (push + notificationclick only, no caching), PushManager subscription in `24pray-web/src/lib/push.ts`; iOS requires installed PWA (iOS 16.4+)

**Build-time font fetch — `24pray-web` only:**
- `next/font/google` downloads Fraunces + DM Sans at build time and self-hosts the output (`24pray-web/src/app/layout.tsx:3-22`) — the only build-time network dependency; no runtime font CDN

**Share intents — `24pray-web` only (plain links, no SDK):**
- WhatsApp `https://wa.me/?text=…`, Telegram `https://t.me/share/url?…` helpers in `24pray-web/src/lib/share.ts`; Web Share API with clipboard fallback in `24pray-web/src/components/patterns/ShareButton.tsx`

**Structured data — `24pray-web` only:**
- schema.org JSON-LD builders in `24pray-web/src/lib/seo.ts` (static vocabulary IRIs, no requests)

**Calendar (link/file generation only, no API calls) — `24pray-api`:**
- `.ics` generation in `24pray-api/src/lib/calendar.ts`, Google Calendar deep links embedded in mails

**Group chat links (validation only, no API calls) — both repos:**
- API validates stored URLs per service in `24pray-api/src/schemas/projects.ts:52-54,71-73`; UI renders them via `24pray-web/src/components/patterns/GroupLinks*.tsx`

**Geodata — `24pray-api` only:**
- GeoNames `cities500` dataset (CC-BY 4.0) — one-time/offline import of a `download.geonames.org` dump via `24pray-api/scripts/import-cities.ts` (manual `curl` + `npm run import:cities -- <file>`); NOT fetched at runtime. UI consumes it through the API's `/geocode` endpoint (`24pray-web/src/lib/api.ts:128-130`)

**Analytics/tracking: none** — no Google Analytics, no tag managers, no error-tracking SaaS in either repo. Usage counting is the cookieless self-hosted funnel (`24pray-web/src/lib/funnel.ts` → `24pray-api/src/routes/funnel.ts`, aggregate day counters only).

**Telegram bot: not implemented.** `User.telegramChatId` and `ReminderPreference.channel = "TELEGRAM"` exist in `24pray-api/prisma/schema.prisma` ("Telegram exists only in the model" — `24pray-api/src/lib/jobs.ts:18`); no Telegram API client or token exists in either repo.

## Data Storage

**Databases (`24pray-api` only):**
- SQLite (single file, embedded) — datasource `sqlite` in `24pray-api/prisma/schema.prisma:5-8`
  - Connection: runtime URL built as `file:${DATA_DIR}/24pray.db` in `24pray-api/src/server.ts:12` (default `./data`); `DATABASE_URL` env var is consumed only by Prisma CLI/migrations (`24pray-api/deploy/docker-entrypoint.sh:7-8`)
  - Client: Prisma Client 5.18 via factory `createPrisma()` in `24pray-api/src/db.ts`
  - Journal mode WAL set at startup (`PRAGMA journal_mode=WAL`, `24pray-api/src/app.ts:38`)
  - FTS5 virtual table `city_fts` (external content on `City`, synced by SQLite triggers) queried via `$queryRaw` for `/geocode` (`24pray-api/src/routes/community.ts:315-321`)
- Migrations: 19 versioned migrations in `24pray-api/prisma/migrations/`, applied by `prisma migrate deploy` at container/service start

**File Storage:**
- Local filesystem only — SQLite DB (+ WAL/SHM sidecars) under `DATA_DIR`; UI serves static assets from `24pray-web/public/` (earth textures, icons, manifest, service worker). No object storage.

**Caching:**
- API: in-process memory only — public stats cache with TTL `STATS_CACHE_TTL_MS` (default 30 s) in `24pray-api/src/routes/community.ts`
- UI: Next.js ISR revalidation windows on SSR fetches (60 s project, 300 s list — `24pray-web/src/lib/api-server.ts:38,48`); service worker deliberately caches nothing

**Client-side storage (`24pray-web`):**
- `localStorage` for locale choice and "my location" (`24pray-web/src/lib/mylocation.ts`); locale cookie for middleware detection; browser Geolocation API used client-side for optional prayer-location pins (coordinates only)

## Authentication & Identity

**Auth Provider: custom, passwordless magic link — implemented entirely in `24pray-api` (no external IdP/OAuth in either repo)**
- `POST /auth/magic-link` issues a 15-minute single-use token (+ optional 6-digit code for other devices), `POST /auth/verify` / `POST /auth/verify-code` consume it and set an HttpOnly session cookie named `session` (`24pray-api/src/routes/auth.ts`, `24pray-api/src/schemas/auth.ts:11`)
- Session: opaque token, sha256-hashed at rest (`hashToken`, `24pray-api/src/lib/tokens.ts:7-9`), `Session`/`MagicToken` rows in SQLite, TTL `SESSION_TTL_DAYS` (default 30), sliding expiry check in `24pray-api/src/plugins/auth.ts:24-41`
- Cookies: `Secure` controlled by `COOKIE_SECURE` (forced on for https production), `SameSite=Lax`; clearing in `24pray-api/src/routes/me.ts:68` / `24pray-api/src/routes/auth.ts:158`
- Signed unsubscribe links for update mails: HMAC-SHA256 over `projectId:email` with `UNSUBSCRIBE_SECRET` (`24pray-api/src/lib/unsubscribe.ts`), verified at `GET /projects/:id/updates/unsubscribe`
- Invite/guest tokens: single-use `inviteToken` (project), `guestToken` (self-cancellation), random 32-byte base64url, sha256-hashed before storage

**UI side (`24pray-web`):** no auth system of its own — the browser client sends `credentials: 'include'` (`24pray-web/src/lib/api.ts:21`), session state via `GET /auth/me` (`24pray-web/src/lib/auth.ts`, hook `24pray-web/src/hooks/use-auth.ts`). Its own cookies (locale) carry no auth meaning.

## Monitoring & Observability

**Error Tracking:**
- None in either repo (no Sentry/etc.). API logs 5xx server-side via `console.error` in the Fastify error handler (`24pray-api/src/app.ts:71-74`, Fastify runs `logger: false`). UI errors surface to users via toast components.

**Logs:**
- API: plain `console.log`/`console.error` to stdout/stderr → journald in production (`journalctl -u 24pray-api`, `24pray-api/deploy/README.md`)
- UI: Next.js server output → journald (`journalctl -u 24pray-web`); unit defined inline in `24pray-api/deploy/README.md`

**Uptime/health:**
- API endpoint `GET /health` (`24pray-api/src/app.ts:84`)
- VPS selfcheck: `24pray-api/deploy/24pray-selfcheck.sh` via systemd timer every 15 min — checks `24pray-api`, `24pray-web`, and `nginx` services, disk >= 85 %, TLS expiry < 14 days, today's backup, SQLite `quick_check`, and `https://24pray.org/api/stats/public`; state-change-only alarm mails through the same Strato SMTP
- External uptime check: planned as GitHub Actions cron — still pending a `workflow`-scope token (`24pray-api/deploy/README.md` monitoring section); no third-party monitoring service in use

## CI/CD & Deployment

**Hosting:**
- Production: single VPS (Strato, Ubuntu 24.04+, per `24pray-api/deploy/README.md`) serving `https://24pray.org` — nginx reverse proxy: `/api/` → Fastify on `127.0.0.1:3001`, `/` → Next.js on `127.0.0.1:3000`; TLS via certbot/Let's Encrypt
- Alternative for the API only: Docker image from `24pray-api/Dockerfile` (`node:22-slim`, port 3001, non-root). No container setup exists for the UI.
- Deploy mechanism: manual `rsync` + `npm ci` + build + service restart over SSH, one runbook (`24pray-api/deploy/README.md`) covering both repos; no automated pipeline deploys to the server

**CI Pipelines:**
- `24pray-api/.github/workflows/ci.yml` — push/PR to `main`: checkout → setup-node 22 → `npm ci` → `npx prisma generate` → `npx tsc --noEmit` → `npx vitest run`. No deploy job, no secrets.
- `24pray-web/.github/workflows/ci.yml` — push/PR to `main`: test job (`npm ci` → `tsc --noEmit` → `next lint` → `vitest run`) + build job (`next build`, `NEXT_PUBLIC_API_URL=/api`, comment "no secrets needed"). Same pinned action SHAs as the API workflow (shared copy-paste origin).

## Environment Configuration

**API (`24pray-api`) — required env vars:**
- `APP_URL` — the only hard requirement (zod `.url()`, no default): magic-link base and always-allowed CORS origin

**API — feature-gating vars (empty = feature disabled, mostly answered with 404):**
- Mail: `SMTP_URL`, `SMTP_FROM`, `UNSUBSCRIBE_SECRET` (required ≥ 32 chars when SMTP is set)
- Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Ops/notify: `ADMIN_NOTIFY_TO`, `FEEDBACK_TO`, `FUNNEL_TOKEN` (bearer for `GET /stats/funnel`), `SELFCHECK_TO` (read only by the selfcheck script, not the API)
- Behavior: `PORT` (3001), `HOST` (127.0.0.1; 0.0.0.0 in container), `DATA_DIR` (./data), `CORS_ORIGINS`, `SESSION_TTL_DAYS`, `STATS_CACHE_TTL_MS`, `COOKIE_SECURE`, `DEV_LOGIN_RESPONSE` (local/E2E only, startup-refused in secure configs)
- Prisma CLI only: `DATABASE_URL`

**UI (`24pray-web`):**
- `NEXT_PUBLIC_API_URL` — build-time, browser API base (production: `/api`)
- `NEXT_PUBLIC_APP_URL` — build-time, absolute public base for canonical/hreflang/sitemap
- `API_URL_INTERNAL` — runtime, server-only SSR fetch base (default `http://localhost:3001`)
- No secrets: the UI holds no credentials; everything it ships to the browser is public

**Secrets location:**
- Server: `/etc/24pray-api.env` (root-owned, chmod 600, loaded via systemd `EnvironmentFile` — `24pray-api/deploy/24pray-api.service:11`); shared by the API and the selfcheck script
- Container: environment variables (entrypoint reads `DATABASE_URL`/defaults)
- Local API: `24pray-api/.env` (gitignored, loaded via `--env-file-if-exists=.env`); template `.env.example`
- Local UI: `24pray-web/.env.local` (gitignored, present); template `.env.example`
- In-repo secrets: none in either repo — session/magic tokens are stored sha256-hashed in the DB only

## Webhooks & Callbacks

**Incoming:**
- None — neither repo consumes provider webhooks. Closest equivalents are user-facing signed/tokenized GET endpoints in the API: magic-link verification (`/auth/verify`), guest self-cancellation via `guestToken` (header), invite join via `/join/:token` / `/api/join/:token`, and HMAC-signed update-mail unsubscribe (`/projects/:id/updates/unsubscribe`)

**Outgoing:**
- None — no callbacks to third-party systems. Outbound communication is one-way SMTP mail and VAPID push sends; UI share links are plain `wa.me`/`t.me` URLs with no callback. The UI service worker receives push events from the browser's push service, but nothing POSTs back into either application.

## Consolidation Evidence (facts for a possible future merge)

Documented observations only — no restructuring performed or recommended here.

- **One deployment pipeline for both repos:** `24pray-api/deploy/README.md` rsyncs, builds, and restarts `24pray-api` AND `24pray-web` together; the UI repo contains zero deploy artifacts (no Dockerfile, no systemd unit, no nginx config)
- **Asymmetric versioning of deploy config:** the API systemd unit is versioned (`24pray-api/deploy/24pray-api.service`) while the `24pray-web` unit exists only inline in the runbook — a change to web deployment has no versioned home
- **Duplicated domain contracts:** UI types mirror API models by hand (`24pray-web/src/types/index.ts` ↔ `24pray-api/prisma/schema.prisma` + `24pray-api/src/schemas/*`); both repos maintain zod validation for the same payloads; the locale set `de|en|es|he|ar` is duplicated (API mail texts `24pray-api/src/lib/mailer.ts:113-125`, UI i18n `24pray-web/src/lib/i18n.ts`)
- **Dependency drift between repos:** Vitest `^2.0.0` (API) vs `^4.1.10` (UI); TypeScript `^5.5.0` vs `^5.3.0`; zod `^3.23.8` vs `^3.23.0`; no lockstep or shared workspace
- **Identical CI skeletons:** both workflows use the same pinned `actions/checkout`/`actions/setup-node` SHAs with near-identical structure — evidence of manual copy-paste sync
- **Naming/version drift in docs:** `24pray-web/README.md:23` refers to the API repo as `24pray-server` (actual: `24pray-api`) and its stack line says "Next.js 14" while `24pray-web/package.json` pins `next ~15.5.28`
- **Runtime coupling already tight:** same origin via nginx, shared session cookie trust boundary, `API_URL_INTERNAL` hard-coupling the Next SSR to the API port, and the API's mailed URLs constraining the UI's route-prefix policy

---

*Integration audit: 2026-10-26*
