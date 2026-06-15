# 24pray-api — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan
**Repo:** `24pray-api` (new), sibling to `24pray-web`

## Purpose

Backend API for the **24pray** prayer-chain platform. Groups organize 24/7 prayer
coverage: an organizer creates a *project* (date range + timezone), members book
*time slots*, others *join* via an invite token, and bookers get notified by email.

The frontend (`24pray-web`, Next.js 14) already exists as a scaffold and calls a
separate API via `NEXT_PUBLIC_API_URL` with httpOnly-cookie sessions. This spec
defines that API plus the frontend wiring needed to make the data pages live.

## Goals / Non-goals

**Goals**
- Implement the four auth endpoints the frontend already calls.
- Implement the Projects/Slots/Join API implied by `24pray-web/src/types/index.ts`.
- Wire the frontend data pages (dashboard, project detail, join) to the API.
- Run on a **simple VPS**: one Node process, SQLite file, systemd + Nginx, no Docker required.

**Non-goals (YAGNI, for now)**
- Telegram delivery (model keeps `notifyChannel`, only `EMAIL` is actually sent).
- Admin UI, password auth, real-time/websocket updates, multi-tenancy.

## Decisions (locked)

| Topic | Choice | Why |
|---|---|---|
| Stack | **Node + Fastify + TypeScript** | Same language as frontend, schlank, single process behind Nginx. |
| Database | **SQLite (file) + Prisma** | No DB server; one file = the whole DB. Typed migrations; later swappable to Postgres. |
| Email | **SMTP via env + dev-console fallback** | Prod uses SMTP; if unset, the magic-link is logged to console — instant local testing. |
| Repo layout | **New repo `24pray-api`** | Mirrors `24pray-web`; clean separation, independently deployable. |

## Architecture

Single Fastify process. Layered, with small single-purpose units behind clear interfaces.

```
src/
  server.ts          # Fastify bootstrap, plugin registration, graceful shutdown
  env.ts             # zod-validated environment (fail fast on bad/missing config)
  db.ts              # Prisma client singleton
  plugins/
    auth.ts          # reads session cookie -> decorates req.user (null if anon)
  lib/
    mailer.ts        # SMTP transport OR dev-console fallback (one interface)
    tokens.ts        # mint/verify magic-link tokens + session tokens
  routes/
    auth.ts          # /auth/*
    projects.ts      # /projects/*  (+ /join/:token)
    slots.ts         # /slots/*
  schemas/           # zod request/response schemas (mirror frontend types)
prisma/
  schema.prisma
  migrations/
deploy/
  24pray-api.service # systemd unit
  nginx.conf         # reverse-proxy snippet (api.<domain> -> 127.0.0.1:3001)
Dockerfile           # optional/bonus
```

**Unit boundaries**
- `lib/mailer.ts` — *what:* send an email; *interface:* `sendMagicLink(email, url)`; *deps:* env (SMTP) or console.
- `lib/tokens.ts` — *what:* create/consume single-use magic tokens and session tokens; *deps:* db, crypto.
- `plugins/auth.ts` — *what:* turn a cookie into `req.user`; *deps:* db (Session lookup).
- each `routes/*.ts` — *what:* one resource group; *deps:* db, schemas, auth plugin.

## Data model (Prisma)

Mirrors `24pray-web/src/types/index.ts`. Enums: `Role(MEMBER|ORGANIZER|ADMIN)`,
`ProjectStatus(DRAFT|ACTIVE|PAUSED|ARCHIVED)`, `ProjectVisibility(PUBLIC|PRIVATE)`,
`SlotStatus(BOOKED|COMPLETED|CANCELLED)`, `NotificationChannel(EMAIL|TELEGRAM)`.

- **User** — id, email (unique), name, role, telegramChatId?, createdAt.
- **PrayerProject** — id, title, description?, status, visibility, startDate, endDate,
  timezone, inviteToken (unique), organizerId -> User, createdAt.
- **PrayerSlot** — id, projectId -> PrayerProject, userId? -> User, startTime, endTime,
  status, guestName?, guestEmail?, notifyChannel.
  Constraint: no two `BOOKED` slots with the same (projectId, startTime).
- **MagicToken** — id, token (unique, hashed), userId -> User, expiresAt, consumedAt?.
  TTL 15 min, single-use.
- **Session** — id, token (unique, hashed), userId -> User, expiresAt, createdAt.
  Logout = delete the row. Cookie holds the opaque token only.

## Auth flow (magic link, cookie session)

1. `POST /auth/magic-link {email}` → upsert User, mint MagicToken (15 min), build link
   `${APP_URL}/auth/verify?token=…`, send via mailer (or log to console). Always `204`
   regardless of whether the email exists (no enumeration).
2. `POST /auth/verify {token}` → validate + consume MagicToken, create Session, set cookie
   **httpOnly, SameSite=Lax, Secure in prod, path=/**, return `User`.
3. `GET /auth/me` → `User` (200) or `401` if no/invalid session.
4. `POST /auth/logout` → delete Session row, clear cookie, `204`.

## Endpoints

**Auth** (wired by frontend today)
- `POST /auth/magic-link` — body `{ email }` → `204`
- `POST /auth/verify` — body `{ token }` → `User`, sets cookie
- `GET  /auth/me` → `User` | `401`
- `POST /auth/logout` → `204`

**Projects**
- `GET  /projects` → `ProjectWithStats[]` (public projects + caller's own)
- `POST /projects` (auth) → create; caller becomes organizer; generates `inviteToken` → `ProjectWithStats`
- `GET  /projects/:id` → `ProjectWithStats` (403 if private and not member/organizer)
- `PATCH /projects/:id` (organizer) → update mutable fields → `ProjectWithStats`

**Slots**
- `GET    /projects/:id/slots` → `SlotView[]` (computed grid across [startDate,endDate] by slot length; FREE/BOOKED + userName)
- `POST   /projects/:id/slots` (auth or guest) — body `BookSlotRequest` → created `PrayerSlot` (409 if already booked)
- `DELETE /slots/:id` (booker or organizer) → cancel → `204`

**Join**
- `GET /join/:token` → resolve `inviteToken` → `ProjectWithStats` (404 if unknown) — drives the join page

**Cross-cutting**
- CORS: origin = `APP_URL`, `credentials: true`.
- zod validation on every body/param; central error handler returns `{ message }`
  (the frontend `api.ts` reads exactly `error.message`).
- Rate-limit `POST /auth/magic-link` (e.g. 5/min/IP).
- Slot grid length configurable per project? **No** — fixed 1-hour slots for v1 (YAGNI);
  derive grid from project start/end. Revisit if needed.

## Frontend wiring (`24pray-web`)

The data pages are placeholders today. This spec includes wiring them:
- **`/dashboard`** — `GET /projects`, render the caller's projects (uses `useAuth`).
- **`/projects/[id]`** — `GET /projects/:id` + `GET /projects/:id/slots`; book via
  `POST /projects/:id/slots`; cancel via `DELETE /slots/:id`.
- **`/join/[token]`** — `GET /join/:token`, then "join" leads into the project/slots view.
- Carry over the `next.config.ts → next.config.mjs` fix (Next 14 can't load a TS config);
  this is a real scaffold bug found while starting the dev server.

No new API client abstraction — reuse the existing `src/lib/api.ts`.

## VPS deployment

- Build: `npm run build` → `dist/`. Start: `node dist/server.js` (via `npm start`).
- SQLite path: `DATA_DIR/24pray.db`, `DATA_DIR` from env (default `./data`).
- Release: `prisma migrate deploy` then restart the service.
- `deploy/24pray-api.service` — systemd unit (Restart=always, EnvironmentFile=/etc/24pray-api.env).
- `deploy/nginx.conf` — `api.<domain>` → `127.0.0.1:3001`, TLS terminated at Nginx.
- Backup = copy the single SQLite file (document a cron one-liner).
- `.env.example` documents every variable; `env.ts` validates at boot.

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3001` | listen port |
| `APP_URL` | yes | — | frontend origin (CORS + magic-link base) |
| `DATA_DIR` | no | `./data` | SQLite directory |
| `SESSION_TTL_DAYS` | no | `30` | session lifetime |
| `COOKIE_SECURE` | no | `true` in prod | cookie Secure flag |
| `SMTP_URL` | no | — | if unset → magic-link logged to console |
| `SMTP_FROM` | no | `24pray <no-reply@…>` | sender |

## Testing

Vitest + Fastify `.inject()` (in-process, no network):
- Auth cycle: magic-link → verify → me(200) → logout → me(401).
- Magic-link never reveals user existence; token is single-use + expires.
- Projects: create → appears in list with correct stats; private project 403 for non-member.
- Slots: book → grid shows BOOKED; double-book same slot → 409; cancel → FREE again.
- Auth guards: protected routes return 401 unauth, 403 wrong-role.
- Mailer uses a console-capture transport in tests (assert link generated).

## Open questions / explicitly deferred

- Telegram notifications — field kept, not implemented.
- Configurable slot length — fixed 1h for v1.
- Membership table — implicit for v1 (organizer + bookers); add if visibility rules grow.
