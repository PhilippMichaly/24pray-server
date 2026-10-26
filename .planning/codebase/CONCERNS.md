---
last_mapped_commit: a09e3c06c1da2363a2db1774a9fc13e7c60a3839
last_mapped_at: 2026-10-26
---
# Codebase Concerns — 24pray-api + 24pray-web

**Analysis Date:** 2026-10-26

Scope: both sibling repositories — `24pray-api` (Fastify + SQLite backend, `/home/pmi/24pray-api`) and `24pray-web` (Next.js frontend, `/home/pmi/24pray-web`). All paths below carry the repo prefix. Ground truth (measured 2026-10-26): API suite green (198 tests, ~148s), web suite green (208 tests, ~8s), `npm audit` run in both repos, PATCH-date desync bug in the API reproduced against a throwaway DB. A 2026-10-23 security audit (`24pray-api/docs/specs/2026-10-23-security-audit.md`) covered both repos; every listed finding was verified fixed at HEAD of each repo and is referenced, not re-listed as open.

## Tech Debt

### 24pray-api

**No lint/format tooling:**
- Issue: No ESLint/Prettier/biome config anywhere; CI (`24pray-api/.github/workflows/ci.yml`) runs only `tsc --noEmit` + vitest. (The web repo *has* ESLint — see web section; tooling is asymmetric across the two repos.)
- Files: `24pray-api/.github/workflows/ci.yml`, repo root (missing `eslint.config.*`, `.prettierrc*`)
- Impact: Style drift is only caught by review; no static analysis beyond the type checker.
- Fix approach: Add a minimal eslint flat config (typescript-eslint recommended) + Prettier, run in CI.

**Slow test suite (~148s for 198 tests, measured 2026-10-26):**
- Issue: `makeTestDb` shells out to `npx prisma migrate deploy` (execSync) for nearly every test, spawns a fresh PrismaClient (new query-engine binary) per test DB, and `fileParallelism: false` serializes everything. Push tests spend ~6s each on DB setup alone.
- Files: `24pray-api/src/test/helpers.ts:14-19`, `24pray-api/vitest.config.ts` (`fileParallelism: false`, `hookTimeout: 20000`)
- Impact: Feedback loop and CI duration; discourages running the suite.
- Fix approach: One migrated template DB per worker, copied per test (`cp` of a migrated SQLite file is cheap); or per-file DB with `fileParallelism: true`.

**Stringly-typed domain values in the DB:**
- Issue: `status`, `visibility`, `role`, `notifyChannel`, `channel` are plain `String` in the schema (SQLite has no enums in Prisma). Values are enforced only by zod schemas and app code; raw SQL paths compare string literals directly.
- Files: `24pray-api/prisma/schema.prisma` (User.role, PrayerProject.status/visibility, PrayerSlot.status/notifyChannel, ReminderPreference.channel), raw comparisons in `24pray-api/src/routes/auth.ts:141-145` and `24pray-api/src/routes/projects.ts:256-262`
- Impact: A typo in a raw SQL literal fails silently or corrupts state; no DB-level backstop.
- Fix approach: Keep zod enums as the single source and add tests pinning the literals used in raw SQL.

**Modeled-but-unimplemented capabilities (dead fields):**
- Issue: Telegram notifications exist only in the data model (`telegramChatId`, `notifyChannel`, `ReminderPreference.channel`); the reminder job is EMAIL-only and no API changes the channel. `User.role` (MEMBER/ORGANIZER/ADMIN) is carried through auth but no route checks it — ADMIN is a dead capability.
- Files: `24pray-api/prisma/schema.prisma:14-15,77,170`, `24pray-api/src/lib/jobs.ts:18-19`, `24pray-api/src/routes/community.ts:350-359` (PUT accepts only `minutesBefore`), `24pray-api/src/plugins/auth.ts:6-13`
- Impact: Schema suggests features that don't exist; invites wrong assumptions in planners/executors.
- Fix approach: Either implement or document-as-dead in schema comments (partially done); remove from API types if never coming.

**Transitional token-in-query parameters (marked "Backlog: entfernen" in code):**
- Issue: `DELETE /slots/:id?guestToken=…` and `GET /stats/funnel?token=…` still accept secrets in the URL; header/Bearer is the preferred path. nginx strips query strings from access logs, but URLs still leak via browser history/referrer until removed. The web repo's own backlog (`24pray-web/docs/BACKLOG.md`, last item) sets the earliest removal date: 2 weeks after the web security deploy.
- Files: `24pray-api/src/routes/slots.ts:276`, `24pray-api/src/routes/funnel.ts:41`, removal tracked in `24pray-web/docs/BACKLOG.md`
- Impact: Secret-in-URL exposure class; log hygiene depends on nginx staying configured.
- Fix approach: Remove the query fallbacks once the grace window in the web backlog has passed and the web is confirmed to send headers only.

**Anti-double-booking index lives outside the Prisma schema:**
- Issue: The partial unique index `PrayerSlot_active_slot_unique` (projectId+startTime WHERE status IN BOOKED/COMPLETED) exists only as raw migration SQL; `24pray-api/prisma/schema.prisma` does not declare it. `prisma migrate dev` will report drift.
- Files: `24pray-api/prisma/migrations/20260708093158_unique_active_slot/migration.sql`, `24pray-api/prisma/schema.prisma` (PrayerSlot, no `@@unique`)
- Impact: The core booking invariant is invisible to the schema; a careless `migrate dev` resolution could drop it.
- Fix approach: Document in schema.prisma comment (partial indexes aren't representable) + a test asserting the index exists.

**Logging is ad-hoc `console.*` with the Fastify logger off:**
- Issue: `logger: false` (`24pray-api/src/app.ts:45`); 500s are logged via `console.error` in the error handler (`24pray-api/src/app.ts:72`); jobs/mail log via console. No request IDs, no structured logs, no error tracking. The only access log is nginx `notokens`.
- Files: `24pray-api/src/app.ts:45,72`, `24pray-api/src/lib/jobs.ts:172,176`, `24pray-api/deploy/nginx.conf`
- Impact: Debugging production issues means journal archaeology; no alerting except `24pray-api/deploy/24pray-selfcheck.sh`.
- Fix approach: Acceptable at current scale; if pain grows, enable pino with redact paths.

### 24pray-web

**Hand-duplicated API contract types (largest single piece of web debt):**
- Issue: `24pray-web/src/types/index.ts` manually mirrors API response shapes (`User`, `PrayerSlot`, `SlotView`, `ProjectWithStats`, …). Drift is already visible: `language?`, `maskNames?`, `notifyOnBooking?` are typed optional "für alte API-Antworten" while the API has returned them unconditionally for months (`24pray-api/src/lib/projectView.ts:87-111`). No codegen, no shared package — every API response change needs a hand-sync in the other repo with no compiler help across the boundary.
- Files: `24pray-web/src/types/index.ts`, `24pray-web/src/lib/api.ts` (call sites), source of truth `24pray-api/src/lib/projectView.ts`, `24pray-api/src/lib/slotGrid.ts`
- Impact: Type-level lies accumulate silently; runtime shapes and compile-time types can diverge.
- Fix approach: Generate the web types from the API (zod schemas → inferred types exported via a small shared package, or OpenAPI); at minimum, regenerate `types/index.ts` from API source in one scripted step.

**Duplicated locale lists and translations across repos:**
- Issue: The 5 supported locales are declared independently in `24pray-api/src/schemas/auth.ts` (`MailLocale`) and `24pray-web/src/lib/i18n.ts` (`SUPPORTED_LOCALES`); the owner-update mail translations exist twice (`24pray-api/src/lib/mailer.ts:113-125` `UPDATE_NOTICE_TEXTS` vs the web i18n catalog), and the he/ar native-review backlog item exists in both repos' docs.
- Files: `24pray-api/src/schemas/auth.ts`, `24pray-web/src/lib/i18n.ts`, `24pray-api/src/lib/mailer.ts:110-125`
- Impact: Adding a locale touches two repos and two translation stores; risk of shipping one side only.
- Fix approach: Single locale registry shared via the same mechanism chosen for contract types.

**README stale on the framework major version:**
- Issue: `24pray-web/README.md` still advertises "Next.js 14"; `24pray-web/package.json` pins `next ~15.5.28` (upgraded 2026-10 for security advisories, commit 5f7141b).
- Impact: Onboarding/doc drift; the README's "nie `npm run build` neben `npm run dev`" warning remains accurate, but the stack description does not.
- Fix approach: One-line README fix; sweep docs on the next dependency bump.

**Funnel ping rides the authenticated API client:**
- Issue: `pingFunnel` posts through the shared `api` client, so pings carry `credentials: 'include'` — the session cookie goes to the funnel endpoint even though nothing stores it. Listed as a low backlog item and still present.
- Files: `24pray-web/src/lib/funnel.ts:10-14`, backlog entry in `24pray-web/docs/BACKLOG.md` ("Funnel-Ping sendet credentials:'include' mit")
- Impact: Cookie header on an analytics endpoint (privacy hygiene, no functional bug).
- Fix approach: Dedicated `fetch` with `credentials: 'omit'` — a two-line change.

**Lint tooling on a deprecated ESLint line:**
- Issue: `24pray-web/.eslintrc.json` extends `next/core-web-vitals` on ESLint 8; ESLint 9 flat config is the maintained line. Asymmetric with the API repo, which has no lint at all.
- Files: `24pray-web/.eslintrc.json`, `24pray-web/package.json` (`eslint ^8.57.1`)
- Impact: Upgrade friction accumulates; two repos with two different lint stories.
- Fix approach: Migrate to `eslint.config.mjs` when touching lint next; align both repos on one config.

## Known Bugs

### 24pray-api

**PATCH /projects/:id with startDate/endDate silently desyncs the slot grid (reproduced 2026-10-26):**
- Symptoms: Organiser PATCHes the project window (e.g. +30 min) without using `/shift`. Existing bookings fall off the grid (`GET /projects/:id/slots` shows FREE where a slot is BOOKED in the DB), and the partial unique index no longer prevents overlapping bookings at shifted wall-clock times (verified: 12:00–13:00 booking invisible after PATCH; 12:30 booking not blocked — overlaps it). Reminder mails still fire for the invisible slot.
- Files: `24pray-api/src/routes/projects.ts:155-183` (PATCH applies dates directly; only span is validated), `24pray-api/src/routes/slots.ts:96-105` (grid alignment checks run against the *new* startDate, so the phantom-overlap class the booking guard prevents is re-introducible via PATCH)
- Trigger: `PATCH /projects/:id` with `startDate`/`endDate` on a project that has booked slots, with a delta not equal to a multiple of `slotDurationMinutes` (or any delta combined with bookings).
- Workaround: Always use `POST /projects/:id/shift` to move times (`24pray-api/src/routes/projects.ts:225-285`).
- Fix approach: Reject `startDate` changes while slots exist (force `/shift`), or move slots in the same transaction. Add a regression test — none exists (`24pray-api/src/routes/projects.test.ts:259-273` only covers span validation).

**recur treats every DB error as "slot clash → skip":**
- Symptoms: The bare `catch {}` around each follow-up slot creation swallows non-race errors (connection loss, constraint other than P2002). Response is 200 with a partial `createdSlotIds` and no error signal — users believe all weeks were taken over.
- Files: `24pray-api/src/routes/slots.ts:246-268` (catch at line 265)
- Trigger: Any DB error other than a booking race during `POST /slots/:id/recur`.
- Workaround: None; inspect `createdSlotIds` length vs expectation.
- Fix approach: Catch only the unique-violation code (pattern exists in the booking handler, `24pray-api/src/routes/slots.ts:134-139`); let other errors propagate as 500.

**recur creates a RecurringCommitment even with zero follow-up slots:**
- Symptoms: Calling recur on a base slot in the project's last week creates a commitment row connected only to the base slot; `createdSlotIds` is empty.
- Files: `24pray-api/src/routes/slots.ts:236-269`
- Trigger: `POST /slots/:id/recur` where base.startTime + 1 week is beyond the project end.
- Workaround: Harmless today (no query aggregates commitments beyond their slots); listed for completeness.
- Fix approach: Create the commitment only if at least one follow-up will be attempted, or accept and document.

### 24pray-web

No new bugs were reproduced in the web repo during this pass. The following backlog-tracked defects remain open there (current state, not new findings):

- `24pray-web/public/sw.js` — `notificationclick` `navigate()` on an uncontrolled client can reject on first visit; click then only focuses (self-heals on next load). Tracked in `24pray-web/docs/BACKLOG.md` (Review P7-F3, Low).
- Landing stats deliberately render no numbers (`24pray-web/docs/BACKLOG.md` Paket Web2 #2) — a product decision (numbers would be fake before anyone prays), not a bug; the code is built and switched off in `24pray-web/src/components/patterns/LandingStats.tsx`.

## Security Considerations

### 24pray-api

**Audit status (context):** The 2026-10-23 audit's 22 API findings (A1–A12, N1–N11) are all verified fixed at HEAD: `trustProxy` loopback-only (`24pray-api/src/app.ts:43-45`), HTML escaping in all mails (`24pray-api/src/lib/mailer.ts:128-130`), project-span limits (`24pray-api/src/schemas/projects.ts:15-25`), booking guard (`24pray-api/src/routes/slots.ts:88-107`), atomic login-code attempt reservation (`24pray-api/src/routes/auth.ts:133-146`), `DEV_LOGIN_RESPONSE`/`UNSUBSCRIBE_SECRET`/`HOST` env hardening (`24pray-api/src/env.ts:45-59`), maskNames for all non-participants (`24pray-api/src/lib/slotGrid.ts:47`), push-URL allowlist with parser-differential guard (`24pray-api/src/lib/push.ts:9-22`), timing-safe secret compares (`24pray-api/src/lib/tokens.ts:21-25`), hardened nginx (`24pray-api/deploy/nginx.conf`), non-root container (`24pray-api/Dockerfile`), hardened systemd unit (`24pray-api/deploy/24pray-api.service`), WAL-safe backups (`24pray-api/deploy/README.md:259-293`). Accepted-by-audit items (N7 push subscription owner change; guest-mail invite token) remain accepted.

**Guest booking confirmation mails the live PRIVATE invite token:**
- Risk: For PRIVATE projects the confirmation mail to a guest embeds `?invite=<inviteToken>` (`24pray-api/src/routes/slots.ts:161-164`). Anyone BCC'd or forwarding that mail can share access; a leaked mailbox leaks the invite.
- Files: `24pray-api/src/routes/slots.ts:161-164`, mitigation: `POST /projects/:id/invite/rotate` (`24pray-api/src/routes/projects.ts:194-203`)
- Current mitigation: Documented trade-off (mail forward = invitation); rotation endpoint exists.
- Recommendations: Document rotation in the owner UI; consider token-scoped guest access instead of the project-wide invite.

**State-changing GET (unsubscribe):**
- Risk: `GET /projects/:id/updates/unsubscribe?email&sig` mutates opt-out state. Anti-spam/mail-scanner pre-fetches of the exact link unsubscribe the recipient without intent.
- Files: `24pray-api/src/routes/community.ts:167-186`
- Current mitigation: HMAC-signature gated (`24pray-api/src/lib/unsubscribe.ts`), idempotent, rate-limited 30/min, low impact (re-subscribe happens on next booking).
- Recommendations: Accept (standard for mail opt-outs) or move to POST-with-confirm if product insists.

**Cookie secure flag is opt-in, not enforced for HTTPS:**
- Risk: `secure: env.COOKIE_SECURE` (`24pray-api/src/routes/auth.ts:109-111`). A prod deployment with https APP_URL but `COOKIE_SECURE=false` serves the session cookie without the Secure flag. Startup only hard-fails `DEV_LOGIN_RESPONSE` in that combination, not the cookie case.
- Files: `24pray-api/src/env.ts:45-59`, `24pray-api/src/routes/auth.ts:109-111`
- Current mitigation: Deploy docs prescribe `COOKIE_SECURE=true`; nginx terminates TLS.
- Recommendations: Add a superRefine issue when `APP_URL` is https and `COOKIE_SECURE` is falsy.

**No outbox for fire-and-forget mail fan-outs:**
- Risk: Update-notice fan-out (`24pray-api/src/routes/community.ts:126-162`), schedule-change/farewell mails (`24pray-api/src/routes/projects.ts:264-280,304-313`), admin notices (`24pray-api/src/lib/adminNotify.ts`) send after the response; a crash mid-loop delivers to a subset silently.
- Current mitigation: Per-recipient `.catch(console.error)`; idempotent-ish content; accepted in audit.
- Recommendations: Outbox table only if delivery guarantees become a requirement.

**Magic-link user creation for arbitrary addresses:**
- Risk: `POST /auth/magic-link` upserts a User row for any typed email (`24pray-api/src/routes/auth.ts:30-34`).
- Current mitigation: 3 links/15 min per address (`MAX_LINKS_PER_EMAIL`), identical 204 responses (no oracle), inactive-account cleanup after 7 days (`24pray-api/src/lib/jobs.ts:117-131`).
- Recommendations: None open; pattern is documented and tested.

### 24pray-web

**Audit status (context):** The web findings W1–W7 are verified fixed at HEAD: W1 Next 14→15.5 (`24pray-web/package.json` `next ~15.5.28`, commit 5f7141b); W2 `poweredByHeader: false` (`24pray-web/next.config.mjs:2`) plus nginx security headers (`24pray-api/deploy/nginx.conf`); W3 login-CSRF — token redeem requires an explicit click and is stripped from the URL (`24pray-web/src/app/auth/verify/page.tsx:29-50`, commits 645116b/472b6cf); W4 guest token moves in the `X-Guest-Token` header (`24pray-web/src/lib/api.ts:88-95`); W5 path parameters encoded (`24pray-web/src/lib/api.ts:91,129`, `24pray-web/src/app/[locale]/projects/[id]/watch-client.tsx:77`); W6 CR-LF stripped in ICS export (`24pray-web/src/lib/time.ts:120-121`); W7 CI pinned by SHA with minimal permissions (`24pray-web/.github/workflows/ci.yml`).

**Invite token in URL query for PRIVATE watch links:**
- Risk: `?invite=` travels in watch URLs (address bar, browser history, share targets). Inherent to shareable invite links; mitigated by nginx notokens logging (`24pray-api/deploy/nginx.conf`) and invite rotation (`24pray-api/src/routes/projects.ts:194-203`).
- Files: `24pray-web/src/app/[locale]/projects/[id]/watch-client.tsx:77`
- Current mitigation: Documented product pattern; rotation available.
- Recommendations: None open; keep rotation discoverable in the owner UI.

**Server-side fetch trust boundary (`API_URL_INTERNAL`):**
- Risk: `24pray-web/src/lib/api-server.ts:16-18` fetches an env-configured internal API base server-side without auth. Misconfiguration (env pointing elsewhere) would SSR whatever answers into public HTML.
- Current mitigation: Only anonymous PUBLIC endpoints are called; results re-filtered for `visibility === 'PUBLIC'` defensively (`24pray-web/src/lib/api-server.ts:41,51`); 3s timeout; any failure renders empty and the client loads after.
- Recommendations: Acceptable; the double PUBLIC filter is the right shape.

**Service worker is intentionally minimal:**
- `24pray-web/public/sw.js` handles only push + notificationclick, no caching/offline — no cache-poisoning surface. Verified by reading the file.

## Performance Bottlenecks

### 24pray-api

**cleanupExpired runs unindexed full scans (self-documented):**
- Problem: Hourly cleanup (`CLEANUP_EVERY_TICKS = 60`) filters on `Session.expiresAt`, `MagicToken.expiresAt`, `User.activatedAt/createdAt`, `PrayerSlot.guestEmail`, `PrayerProject.endDate` — none indexed; the code comment says "jeder Lauf scannt also".
- Files: `24pray-api/src/lib/jobs.ts:147-153`, missing indexes in `24pray-api/prisma/schema.prisma`
- Cause: Schema has no covering indexes for these filters.
- Improvement path: Add indexes (Session/MagicToken `expiresAt`, User `activatedAt`) if table growth makes the hourly scan measurable; the comment already names the day this becomes necessary.

**Reminder job sends serially through one SMTP round-trip per slot:**
- Problem: `sendDueReminders` awaits each `mailer.sendReminder` inside the tick loop; tick duration grows linearly with due reminders. The overlap guard (`running` flag) skips a whole tick rather than queueing, so a slow SMTP burst delays reminders and the completion job runs late (it runs first, so stats stay correct).
- Files: `24pray-api/src/lib/jobs.ts:38-81,161-180`
- Cause: Deliberate simplicity + overlap guard.
- Improvement path: Batch SMTP (or pooled sending) if reminder volume grows; current volume is low.

**Grid serialization per request:**
- Problem: `GET /projects/:id/slots` builds up to `MAX_GRID_SLOTS = 8,784` view objects with ISO strings per request (`24pray-api/src/lib/slotGrid.ts:21,52-67`). Fine at current caps; payload and CPU grow linearly with project duration.
- Files: `24pray-api/src/lib/slotGrid.ts`, `24pray-api/src/routes/slots.ts:47-79`

**Test suite duration:** see Tech Debt — 148s is the largest day-to-day performance cost in the API repo.

### 24pray-web

**Landing stats poll every 60s per open tab:**
- Problem: `24pray-web/src/app/[locale]/landing-client.tsx:39` re-fetches `/stats/public` once a minute per open landing tab. This exact pattern is what forced the API's 30s in-memory stats cache (`24pray-api/src/routes/community.ts:78`, `STATS_CACHE_TTL_MS`).
- Current state: bounded by the API cache; fine at current traffic.
- Improvement path: Only if traffic grows — backoff on hidden tabs (`document.visibilityState`) is a small change.

**Globe is the heaviest client CPU surface:**
- Problem: `24pray-web/src/components/patterns/Globe.tsx` (622 lines) software-renders a 2048px NASA texture onto canvas per frame (custom per-pixel mapping with a `fatan2` approximation), plus drag inertia, auto-rotation, great-circle network lines and focus flights. Low-end mobile pays a real per-frame cost; `prefers-reduced-motion` is honored (static render).
- Files: `24pray-web/src/components/patterns/Globe.tsx`
- Improvement path: No automated perf coverage (see Test Gaps); consider lowering texture resolution on small screens if field reports come in.

**Minute-tick recompute of the whole slot grid:**
- Problem: `useSlotGrid` ticks `now` every 60s (`24pray-web/src/components/slots/store.ts:50-57`), which recomputes `buildViewModels` over up to 8,784 slots and re-renders the list. Memoized, so cost is the model rebuild, not React diffing — acceptable today.
- Files: `24pray-web/src/components/slots/store.ts:72-83`, `24pray-web/src/components/slots/logic.ts`

**i18n catalog ships all 5 locales in one module:**
- Problem: `24pray-web/src/lib/i18n.ts` (1,929 lines) embeds every locale; the client bundle carries all languages on every page. Low priority at this size, but it grows with every feature × 5.
- Improvement path: Per-locale dynamic import when the catalog starts costing real bytes.

## Fragile Areas

### 24pray-api

**Raw-SQL date arithmetic depends on Prisma's SQLite DateTime storage (INTEGER epoch-ms):**
- Files: `24pray-api/src/routes/projects.ts:218-262` (shift two-phase UPDATE), `24pray-api/src/routes/auth.ts:140-145` (verify-code attempt reservation compares `expiresAt` to `Date.now()`)
- Why fragile: Correctness rests on Prisma storing DateTime as INTEGER epoch-ms in SQLite — verified by manual DB inspection and documented in long comments. A Prisma major upgrade that changes storage format silently corrupts shifted dates or locks all code logins.
- Safe modification: Never touch these without re-verifying the storage assumption against a real DB; add a startup assertion (`PRAGMA table_info` type check) before the next Prisma upgrade.
- Test coverage: Behavior is tested (shift tests in `24pray-api/src/routes/projects.test.ts`, code-attempt tests in `24pray-api/src/routes/auth.test.ts`), but tests cannot detect a Prisma storage-format change in advance — only the added assertion can.

**/shift two-phase OFFSET trick is correctness-critical and non-obvious:**
- Files: `24pray-api/src/routes/projects.ts:242-262`
- Why fragile: The `OFFSET = 4_000_000_000_000_000` two-phase update works around SQLite's per-row unique checking during multi-row UPDATE; a "simplification" re-introduces the crash from End-User-Test v2 Befund 1.
- Safe modification: Treat the fix2 comment block as spec; require the shift tests (`24pray-api/src/routes/projects.test.ts`) to pass before merging any change here.

**verify-code attempt reservation relies on SQLite write-lock serialization:**
- Files: `24pray-api/src/routes/auth.ts:133-146`
- Why fragile: The atomic UPDATE-with-subselect works because SQLite serializes writers; a refactor into aggregate+update (explicitly warned against in the comment) re-opens the brute-force window.
- Safe modification: Keep the single-statement form; test `MAX_CODE_ATTEMPTS` concurrency behavior.

**Fire-and-forget fan-out IIFE spans the response boundary:**
- Files: `24pray-api/src/routes/community.ts:123-162`
- Why fragile: The async IIFE keeps running after the response; errors are only logged, delivery is partial-on-crash, and tests must not assert on fan-out side effects without waiting.
- Safe modification: Keep the `void (async …)().catch(...)` shape; do not await fan-out in the handler (would block the owner's POST on SMTP).

**Calendar/allDay boundary math:**
- Files: `24pray-api/src/lib/calendar.ts:37-75`
- Why fragile: Timezone-dependent day boundaries (`VALUE=DATE` all-day slots) and ICS escaping have a bug history (CR-LF injection fixed in commit 3d1d23a).
- Safe modification: `24pray-api/src/lib/calendar.test.ts` pins both; extend it for any change.

### 24pray-web

**Middleware routing is critical and only half-covered by tests:**
- Files: `24pray-web/src/middleware.ts` (locale negotiation, 308 canonicalization, 307 redirects), helpers tested in `24pray-web/src/lib/routes.test.ts`
- Why fragile: The 307 redirect for `/projects/*` must preserve the query string (invite tokens depend on it — live-verified once, noted in `24pray-web/docs/BACKLOG.md`); `UNPREFIXED_ROUTES` (`24pray-web/src/lib/routes.ts:98-110`) must stay in sync with the app directory or mail-linked app routes break; there is **no `middleware.test.ts`** — the middleware file itself has zero direct tests (helpers have 13).
- Safe modification: Extend `24pray-web/src/lib/routes.test.ts` or add middleware-level tests before changing redirect/rewrite logic.

**Conflict detection parses the API's German error message:**
- Files: `24pray-web/src/components/slots/store.ts:134` (`/409|belegt/i.test(msg)`)
- Why fragile: The UI decides "show conflict UI + refetch" by regex-matching the API's human-facing German error text (`24pray-api/src/routes/slots.ts:136`). Any change to API message wording or language silently breaks conflict handling (falls into the generic error path).
- Safe modification: Have the API return a machine-readable error code (e.g. `{ code: 'SLOT_TAKEN' }`) alongside the message; until then, keep the regex pinned by a cross-repo test.

**Module-level slot-grid store assumes one mounted grid:**
- Files: `24pray-web/src/components/slots/store.ts:22-23` (comment: "Ein Store — Projekt-Detail rendert genau einen Grid gleichzeitig")
- Why fragile: Two watch pages mounted at once (preview, embedded view) would clobber each other's state.
- Safe modification: Accept the invariant; key the store by project id if the invariant ever breaks.

## Scaling Limits

### 24pray-api

**SQLite single-writer:** All writes serialize on one file; WAL gives concurrent reads. Booking contention is deliberately resolved via unique-index conflict rather than transactions (`24pray-api/README.md` "Betriebs-Eigenheiten"). Sufficient for the current single-VPS deployment; real growth (sustained concurrent booking, multi-instance) needs Postgres — a database swap touches every route plus the raw-SQL fragile areas above.

**Single-instance in-memory state:**
- Rate limits are per-instance memory (`@fastify/rate-limit` defaults) — two instances double the effective limit.
- `/stats/public` cache is a module-level variable (`24pray-api/src/routes/community.ts:78`) — inconsistent across instances.
- Jobs run inside the API process (`24pray-api/src/server.ts:21`) — N instances mean N duplicate ticks (reminder double-sends are prevented by `remindedAt`, but completion/cleanup race).
- Scaling path: stay single-instance (documented deployment model); externalize only if scaling forces it.

**SMTP throughput ceiling:** Reminders and fan-outs go through one nodemailer transport (Strato). Serial reminder loop ≈ one mail per SMTP round-trip per tick. Bound by provider limits long before the DB.

**Hard caps that bound growth:** 366-day projects (`MAX_PROJECT_DAYS`), 8,784 grid entries (`MAX_GRID_SLOTS`), 100-entry public project list (`PROJECT_LIST_LIMIT`), 53 recur weeks (`MAX_RECUR_WEEKS`), 10 projects/day/user (`MAX_PROJECTS_PER_DAY`), body sizes via zod. City autocomplete bounded by FTS + `LIMIT 200` (`24pray-api/src/routes/community.ts:315-323`).

### 24pray-web

**Single `next start` process:** The web runs as one Node process on port 3000 behind nginx (`24pray-api/deploy/nginx.conf`); no clustering or horizontal scale-out. The app is effectively stateless (session cookie lives at the API), so adding instances is possible — but today the deployment unit is the one VPS.

**SSR fetch coupling:** Every public watch/list page render hits the internal API with a 3s timeout (`24pray-web/src/lib/api-server.ts:14,20-35`). API downtime degrades web SSR gracefully (empty + client retry) but costs up to 3s of TTFU per render; revalidate windows (60s/300s) mean a briefly-down API is cached around.

## Dependencies at Risk

### 24pray-api

**zod 3.25.76 — HIGH, runtime-reachable:**
- Risk: `npm audit` (2026-10-26, api repo): GHSA-mrhx-c7xc-m3w5 — memory exhaustion while validating oversized constrained collections. zod parses every request body; the advisory is triggerable with crafted large inputs. Fix exists only in zod 4.x (breaking).
- Impact: DoS via request validation; upgrade requires migrating all schemas (`24pray-api/src/schemas/*`, inline schemas in routes).
- Migration plan: Dedicated phase for the zod 4 migration (API first, web separately). Until then, Fastify's default 1MB body limit caps the blast radius but does not eliminate it.

**vitest 2.1.9 / vite 5 / tinypool chain — CRITICAL/HIGH, dev-only:**
- Risk: `npm audit` (2026-10-26): tinypool prototype-pollution RCE (2× critical), esbuild dev-server request forgery (moderate), @vitest/mocker path traversal/code injection (moderate). All live under `vitest → vite` (confirmed via `npm ls`); the API has no vite dev server in production, so exposure is limited to dev machines/CI.
- Impact: CI/dev compromise vector; not production-reachable.
- Migration plan: vitest 5 upgrade (breaking) — bundle with the suite-speed rework (Tech Debt).

**web-push 3.6.7 — maintenance risk, guarded:**
- Risk: Uses legacy `node:url` parsing; the repo carries an explicit parser-differential guard because of it (`24pray-api/src/lib/push.ts:12-15`, tests in `24pray-api/src/lib/push.test.ts`). Package evolves slowly.
- Impact: If the guard is ever removed, SSRF via crafted push endpoints returns.
- Migration plan: Keep the guard as the permanent mitigation; revisit package only with the SSRF tests green.

**Prisma 5.22 (client + CLI):**
- Risk: Several majors behind by 2026-10; upgrade must re-verify the SQLite DateTime storage assumption (Fragile Areas).
- Impact: Staying on 5.x is currently fine (no known critical runtime advisories in `npm audit` output); deferring too long makes the jump harder.
- Migration plan: Pin a phase: upgrade Prisma, then add the storage-format startup assertion, then touch the raw-SQL areas.

**@types/node ^20 vs Node ≥22 runtime:** dev-only type/runtime skew (engines say `>=22`); cosmetic, fix by bumping the dev dependency.

**No automated audit gate:** audits are applied manually (e.g. api commit ba9a5b8 "npm audit fix ohne Major-Updates"). Recommendation: add `npm audit --omit=dev --audit-level=high` to CI with a documented zod exception, so the next non-breaking round applies itself.

### 24pray-web

**zod ^3.23.0 — same HIGH advisory as the API:**
- Risk: `npm audit` (2026-10-26, web repo) flags the identical GHSA-mrhx-c7xc-m3w5 (fix only in zod 4). Practical exposure is far lower than the API's: the web uses zod in exactly one client form (`24pray-web/src/components/slots/GuestBookingForm.tsx`), but the dependency and the upgrade debt are the same.
- Migration plan: Same zod 4 phase as the API; coordinate so both repos land the major together.

**undici chain — multiple HIGH, production-adjacent:**
- Risk: `npm audit` (2026-10-26): 10 undici advisories (response splitting, cookie caching, TLS validation bypass in BalancedPool, decompression DoS, …) via Next's runtime fetch. Most require exotic conditions (interceptors, pools) the app doesn't use, but this is server-side fetch in production, unlike the API's dev-only findings.
- Current state: Non-breaking `npm audit fix` available at audit time.
- Migration plan: Apply the non-breaking undici bump with the next dependency round; keep Next current (the 15.5 upgrade habit from commit 5f7141b is the right one).

**vite 8 — HIGH, dev-only:** launch-editor argument injection / fs.allow bypass class; only touches dev servers/CI. Fix rides along with the vitest line; web is already on vitest 4 while the API is on vitest 2 (see Consolidation).

**next `postcss` override smell:** `24pray-web/package.json` carries `overrides.next.postcss ^8.5.23` to drag Next's bundled postcss past advisories. Works, but re-check on every Next bump — the override can mask a future bundled upgrade.

**Version drift across repos (consolidation-relevant):** same-family tools on different majors — vitest 4 (web) vs 2 (api), both zod 3.x (same GHSA), `@types/node` ^20 in both while runtimes are Node ≥22. No shared lockfile, so audits and fixes are done twice by hand (last pair: api ba9a5b8 / web 21daf8f, same message "npm audit fix ohne Major-Updates" — the duplication is visible in git history).

## Missing Critical Features

### Cross-repo (product level)

**Cancellation notifications (documented gaps):** When a slot is cancelled, the owner gets no notice (a booked hour silently frees); when an organizer cancels someone else's booking, the booker is not informed. Recorded as `Nein — OFFEN` in `24pray-api/docs/NOTIFICATIONS.md` (Offene Zellen 4–5) awaiting a product decision.

**Push coverage gaps:** No push for shift/delete/owner-on-foreign-booking (`24pray-api/docs/NOTIFICATIONS.md` Offene Zellen 1–3). Mail exists for all three.

**E-mail localization:** Only the owner-update notice is localized (de/en/es/he/ar); all other transactional mails are German-only, and he/ar update texts await native-speaker review (`24pray-api/src/lib/mailer.ts:110-112`). The API captures per-user/slot `locale` that most mail types ignore — duplicated as a backlog item in `24pray-web/docs/BACKLOG.md`.

**No operator surface beyond mail:** `ADMIN_NOTIFY_TO` one-way notices are the only admin channel; there is no admin API/UI and `User.role = ADMIN` is unused. Investigating abuse or supporting users requires SQL on the server.

**No structured observability:** No metrics, tracing, or error tracking in either repo; `24pray-api/deploy/24pray-selfcheck.sh` watches disk/TLS/backup/services and mails on state change — the only operational alerting.

### 24pray-api

- Backlog 5 API half (uncertain): project `language` is captured at creation (`24pray-api/prisma/schema.prisma:42`) but `GET /projects` (`24pray-api/src/routes/projects.ts:60-78`) has no language filter; the schema comment says "Listen-Filter (Backlog 5)". Whether the filter landed only in the web repo is unverified from the API repo.
- API-side open items tracked in `24pray-web/docs/BACKLOG.md` (single backlog file lives in the web repo while several items are API work — a doc-ownership quirk, see Consolidation): API startup guard for dev-default `UNSUBSCRIBE_SECRET`, project `updatedAt` for sitemap `lastmod`, removal of the query-token legacy paths.

### 24pray-web

From `24pray-web/docs/BACKLOG.md` (current state): Über-uns/values page blocked on owner-provided content; he/ar native-review batch (SEO texts, UX texts, guides, update mails); PLZ search for places <500 inhabitants; guest-booking adoption into new accounts (guestEmail→userId match); `returnTo` for the login flow; project language editable after creation; title editing for existing watches; cumulative landing stats stay hidden pending a "what counts as prayed" decision; iOS-Safari PWA push UX explanation.

## Test Coverage Gaps

### 24pray-api

**PATCH date desync (Known Bugs #1) — untested:**
- What's not tested: Any interaction between PATCHed project dates and existing slots; `24pray-api/src/routes/projects.test.ts:259-273` covers only span validation.
- Files: `24pray-api/src/routes/projects.ts:148-183`, gap in `24pray-api/src/routes/projects.test.ts`
- Risk: The silent grid-desync/double-booking bug ships again or regresses after a fix.
- Priority: High (write the failing test as the first step of the fix).

**recur error paths:**
- What's not tested: Non-race DB errors inside the loop (swallowed today), zero-follow-up commitment creation.
- Files: `24pray-api/src/routes/slots.ts:236-268`; `24pray-api/src/routes/slots.test.ts` recur-Härtung covers only BOOKED/ACTIVE gating and the 53-week cap.
- Risk: Silent partial recurrence stays silent.
- Priority: Medium.

**No coverage measurement:** `24pray-api/vitest.config.ts` has no coverage config and CI doesn't enforce any threshold.
- Priority: Medium (enable `coverage` with a modest threshold on `src/routes` + `src/lib`).

**Booking-path concurrency has no automated load test:** The unique-index-instead-of-transaction design is load-sensitive by construction (README documents a manual load test). No automated concurrency test protects the no-double-booking invariant against regressions in the guard ordering (`24pray-api/src/routes/slots.ts:88-139`).
- Priority: Medium (a small parallel-request test catches guard reordering).

**`startJobs` interval behavior untested:** `24pray-api/src/lib/jobs.ts` functions are unit-tested (`24pray-api/src/lib/jobs.test.ts`), but the interval wiring/overlap guard (`startJobs`, `24pray-api/src/server.ts:21`) has no test; shutdown doesn't stop in-flight fan-outs.
- Priority: Low.

**Deploy/ops scripts untested:** `24pray-api/deploy/24pray-selfcheck.sh` (state machine, SMTP credential handling via Python/curl-config) and `24pray-api/deploy/docker-entrypoint.sh` (migration gate) are security-relevant shell with only manual verification; `24pray-api/scripts/import-cities.ts` likewise.
- Priority: Medium for the selfcheck (it handles the SMTP password); Low for the rest.

### 24pray-web

**No middleware tests:** `24pray-web/src/middleware.ts` (locale negotiation, 308 canonicalization, 307 redirects with query preservation) has zero direct tests; only the helper module `24pray-web/src/lib/routes.ts` is covered (13 tests in `24pray-web/src/lib/routes.test.ts`). The invite-token-preserving redirect is exactly the kind of behavior a refactor breaks silently.
- Priority: High.

**No cross-repo / E2E tests:** Each repo is tested only against itself. The critical user journeys span both (magic-link login → verify → dashboard; guest booking → token self-cancel; invite join → private booking). The deploy-order coupling (API-before-web for breaking changes, documented in `24pray-api/docs/superpowers/plans/2026-10-23-security-hardening.md` and `24pray-web/docs/BACKLOG.md`) has no automated guard — a breaking API change deployed with a stale web is only caught manually.
- Priority: Medium (a thin Playwright smoke suite against staging would cover the three journeys).

**Optimistic-booking conflict path depends on untested message coupling:** The `/409|belegt/i` regex in `24pray-web/src/components/slots/store.ts:134` has no test pinning it to the API's actual message text — a wording change on either side silently degrades conflict UX.
- Priority: Medium.

**No performance/visual regression tests:** Globe (`Globe.tsx`), grid rendering at the 8,784-slot cap, and RTL layouts (he/ar) have no perf or visual coverage; several backlog items note he/ar texts were "noch nie visuell abgenommen".
- Priority: Low/Medium.

**Otherwise healthy:** 208 tests across 36 files, all green in ~8s (measured 2026-10-26); component tests use jsdom via per-file environment docblocks; CI additionally runs `next lint` and a full `next build` (`24pray-web/.github/workflows/ci.yml`) — the API CI has neither.

## Cross-Repo Concerns & Consolidation Assessment

The user is considering consolidating `24pray-api` + `24pray-web` into one repository. Facts and recommendations are separated; nothing has been moved or merged.

### Current-state facts (evidence-backed)

**Two independent repositories and histories:**
- GitHub remotes: `PhilippMichaly/24pray-server` (API) and `PhilippMichaly/24pray-web` (UI); both default to `main`; separate commit histories, separate tags/releases (release process documented as one release per repo in the hardening plan, `24pray-api/docs/superpowers/plans/2026-10-23-security-hardening.md`).
- Separate lockfiles → separate `npm audit` states as of 2026-10-26: API 10 findings (2 critical, both dev-only tinypool), web 12 findings (6 high, undici production-adjacent + zod shared with API). Manual fix commits appear in both histories with identical messages (api ba9a5b8 / web 21daf8f), showing the duplicated toil concretely.
- Version drift on same-family tooling: vitest 2 (API) vs 4 (web), both zod 3.x under the same unpatched-high advisory, `@types/node` ^20 in both repos against Node ≥22 runtimes.

**Duplicated contracts (the strongest consolidation argument):**
- Response/request shapes hand-mirrored in `24pray-web/src/types/index.ts` with visible drift (optional fields the API always sends; see Tech Debt).
- Locale registry duplicated (`24pray-api/src/schemas/auth.ts` `MailLocale` vs `24pray-web/src/lib/i18n.ts` `SUPPORTED_LOCALES`); owner-update translations exist in both repos; he/ar review backlog item exists in both backlogs.
- The API's German error-message text is an implicit contract the web parses with a regex (`24pray-web/src/components/slots/store.ts:134`) — a machine-readable error code would fix this inside or outside a monorepo.
- Mail-link stability shapes web routing: app routes stay un-prefixed specifically so API e-mail links keep working (`24pray-web/src/lib/routes.ts:92-97`).

**CI/build/deploy coupling:**
- Two near-identical CI workflows (`24pray-api/.github/workflows/ci.yml`, `24pray-web/.github/workflows/ci.yml`); the web adds lint + build jobs the API lacks.
- Deploy runbook lives in the API repo (`24pray-api/deploy/README.md`) but describes both services (systemd units `24pray-api`/`24pray-web`, nginx fronting both, selfcheck monitoring all three services). The web repo has no deploy docs — operational knowledge is asymmetric by location.
- Cross-repo deploy ordering is a real, documented risk: API must deploy before web for breaking changes (guest-invite booking flow in the hardening plan; the UX round notes "zuerst die API, dann das Web" in `24pray-web/docs/BACKLOG.md`). Rollback today means checking out two independent SHAs in the right order.
- Runtime wiring: nginx (`24pray-api/deploy/nginx.conf`) proxies `/api/` → 127.0.0.1:3001 and everything else → 127.0.0.1:3000; the web rewrites `/api/*` to `NEXT_PUBLIC_API_URL` (`24pray-web/next.config.mjs`); web SSR reaches the API via `API_URL_INTERNAL` (`24pray-web/src/lib/api-server.ts:16-18`). The API, in turn, links to the web via `APP_URL`. Both directions of this contract live in different repos.
- The web product backlog physically lives in the web repo while a third of its items are API work; the API's notification-matrix doc references web test files. Doc ownership is already de-facto shared.

**Migration/rollback considerations:**
- API state lives in a Prisma-migrated SQLite file on the VPS (migrations run at container/systemd start: `24pray-api/deploy/docker-entrypoint.sh`, `24pray-api/deploy/24pray-api.service` `ExecStartPre`); the web is stateless builds. Repo consolidation itself moves no data — no DB migration is needed to merge the repos.
- Rollback safety after a consolidation: a single repo means a single revert covers both tiers again — but until history is joined, the two-repos-two-SHAs rollback is the only correct procedure, and it should be written down before any merge (it currently is not; the runbook documents forward-deploy only).

### Recommendations (clearly recommendations, not current state)

1. **If consolidating: prefer a monorepo with shared packages, not a big-bang merge.** Move both repos into one history (preserving each repo's history via `git subtree`/`merge --allow-unrelated-histories` under `apps/api` + `apps/web`), add a `packages/contracts` package holding zod schemas + inferred types + the locale registry, consumed by both apps. That directly attacks the strongest debt item (duplicated contracts) and lets CI type-check the web against real API schemas on every PR.
2. **Unify toolchains during the merge:** one vitest major, one eslint config, one `@types/node`, one audit gate (`npm audit --omit=dev --audit-level=high` with a documented zod-4 exception) — most of the version-drift findings die automatically.
3. **Keep the deploy unit unchanged at first:** one repo does not require one deployable. Keep two systemd services and the same nginx layout; a monorepo release can still ship two artifacts. This preserves the current rollback granularity while removing the ordering hazard via a single versioned release note.
4. **Fix the implicit contracts before or during migration:** API error codes (replace the web's message regex), the documented grace window for removing query-token fallbacks (`24pray-web/docs/BACKLOG.md`), and `COOKIE_SECURE`-vs-https startup enforcement. These are worth doing regardless of consolidation.
5. **If NOT consolidating:** the minimal alternative is a generated contract package published from the API repo and consumed by the web, a shared CI composite action to stop the workflow duplication, and moving the deploy runbook to where both services are described (it is already in the API repo — the web repo should link to it prominently). Cheaper, but leaves two histories, two audits, and the deploy-order risk permanently.
6. **Either way:** add the two high-value tests called out above (API PATCH-date regression; web middleware tests), and write the two-SHA rollback procedure into `24pray-api/deploy/README.md` before the next breaking deploy — that risk exists today, independent of the consolidation decision.

---

*Concerns audit: 2026-10-26 — covers 24pray-api and 24pray-web*
