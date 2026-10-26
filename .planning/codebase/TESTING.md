---
last_mapped_commit: a09e3c06c1da2363a2db1774a9fc13e7c60a3839
last_mapped_at: 2026-10-26
---
# Testing Patterns

**Analysis Date:** 2026-10-26

**Scope:** Both projects of the 24pray system — API (`/home/pmi/24pray-api`) and UI (`/home/pmi/24pray-web`). Paths are written sibling-relative from `/home/pmi/`: `24pray-api/src/...` and `24pray-web/src/...`. Sections label findings **API** and **UI** where they differ.

## Test Framework

**Runner:**
- **API:** Vitest 2.x (`vitest: ^2.0.0`), Node environment. Config: `24pray-api/vitest.config.ts` — `include: ['src/**/*.test.ts']`, `environment: 'node'`, `fileParallelism: false`, `hookTimeout: 20000`, `env: { APP_URL: 'http://localhost:3000' }` (so importing `24pray-api/src/env.ts`, which parses env at module load, never throws in tests)
- **UI:** Vitest 4.x (`vitest: ^4.1.10`), Node environment by default with per-file jsdom opt-in: `24pray-web/vitest.config.ts` sets `environment: 'node'`, `include: ['src/**/*.test.{ts,tsx}']`, the Vitest-4 `oxc: { jsx: { runtime: 'automatic' } }` transform, and `resolve.alias` mirroring the `@ → src` tsconfig alias

**Assertion Library:**
- Vitest built-ins (`expect`, `describe`, `it`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `vi`) — no separate assertion library. UI component tests additionally use `@testing-library/react` queries (no `@testing-library/user-event`, no `jest-dom` — see Common Patterns)

**Run Commands:**

```bash

# API (24pray-api)

npm test              # vitest run
npm run test:watch    # vitest
npx tsc --noEmit      # type-check, CI-enforced (.github/workflows/ci.yml)

# UI (24pray-web)

npm test              # vitest run
npm run lint          # next lint — CI-enforced, no API equivalent
npx tsc --noEmit      # type-check, CI-enforced
```

## Test File Organization

**Location:**
- Co-located in both repos: `24pray-api/src/routes/slots.ts` → `24pray-api/src/routes/slots.test.ts`; `24pray-web/src/components/slots/logic.ts` → `24pray-web/src/components/slots/logic.test.ts`
- API shared helpers: `24pray-api/src/test/helpers.ts`; UI has no shared helper module — fixtures live at the top of each test file

**Naming:**
- `<module>.test.ts` (API), `<module>.test.ts` / `<module>.test.tsx` (UI)
- Verified sizes: API 20 test files, ~4,170 lines, 198 `it` blocks; UI 36 test files, ~2,940 lines, 208 `it` blocks

**Structure:**

```
24pray-api/src/
├── app.test.ts / db.test.ts / env.test.ts   # app-level, WAL mode, pure env unit tests
├── routes/*.test.ts                         # auth, slots, projects, community, me, funnel, feedback, push, adminNotice
├── lib/*.test.ts                            # mailer, push, jobs, calendar, slotGrid, tokens, adminNotify, unsubscribe
└── test/helpers.ts                          # makeTestDb()

24pray-web/src/
├── app/**.test.tsx                          # page tests co-located: login.test.tsx, verify.test.tsx, dashboard.test.tsx, profil.test.tsx, legal.test.tsx
├── app/[locale]/projects/[id]/metadata.test.ts   # generateMetadata unit tests
├── components/patterns/*.test.tsx           # ProjectCard, AppShell, InviteCard, ScheduleCard, LocaleToggle, …
├── components/slots/*.test.tsx|ts           # logic.test.ts (pure), SlotList, SlotSheet, GuestBookingForm, StatsPanel, …
├── lib/*.test.ts(x)                         # api, i18n, locale, routes, time, share, push, funnel
└── content/guides.test.ts                   # content-data validation
```

**Test naming language (both repos):**
- Behavior suites use German `describe`/`it` names (`describe('Feedback-Endpoint (User-Zusatzpunkt)')`, `24pray-api/src/routes/feedback.test.ts:25`; `describe('Locale-Erkennung + Umschaltung')`, `24pray-web/src/lib/locale.test.tsx:18`)
- Pure unit suites may use English (`describe('parseEnv')`, `24pray-api/src/env.test.ts:4`; `describe('ApiClient — body-lose Requests')` mixes, `24pray-web/src/lib/api.test.ts:7`)

## Test Structure

**Suite shape — API (integration suites):**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string; code?: string }[] = [];

beforeAll(async () => {
  db = await makeTestDb();
  app = await buildApp({
    prisma: db.prisma,
    env: parseEnv({ APP_URL: 'http://localhost:3000' }),
    mailer: { async sendMagicLink(email, url, code) { captured.push({ email, url, code }); } },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.cleanup();
});
```

(verbatim shape from `24pray-api/src/routes/auth.test.ts:1-25`)

**Suite shape — UI (component/page suites):**

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/auth/login',
  useSearchParams: () => new URLSearchParams(),
}));
const post = vi.fn();
vi.mock('@/lib/api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

import LoginPage from './page';
```

(`24pray-web/src/app/auth/login/login.test.tsx:1-14`)

**Patterns:**
- **API:** module-level `let db: TestDb; let app: FastifyInstance;` + `beforeAll`/`afterAll`; always `await app.ready()` after `buildApp`; `afterAll` closes the app BEFORE `db.cleanup()`. HTTP via `app.inject({ method, url, payload, cookies, headers, remoteAddress })` — no port binding
- **API:** `remoteAddress` is set explicitly whenever rate limiting matters (all inject calls otherwise share `127.0.0.1`): `24pray-api/src/routes/auth.test.ts:90`, `24pray-api/src/app.test.ts:122`
- **UI:** per-file jsdom pragma as line 1; `beforeEach(() => cleanup())` + `afterEach(() => vi.clearAllMocks())`; page tests render the default-exported page directly (`render(<LoginPage />)`)
- **UI:** queries via `screen.getByRole/getByLabelText/getByText`, existence assertions via `.toBeTruthy()` / `.toBeNull()` — there is NO jest-dom, so no `.toBeInTheDocument()`; attribute checks use `el.getAttribute('href')` (`24pray-web/src/components/patterns/AppShell.test.tsx:23`)
- **UI:** async UI settled with `await waitFor(() => expect(...))` after `fireEvent` (`24pray-web/src/lib/locale.test.tsx:85-95`)
- **Both:** pure unit suites skip all setup and call functions directly (`24pray-api/src/env.test.ts`; `24pray-web/src/components/slots/logic.test.ts`)

## Mocking

**Framework:** Vitest `vi` in both repos — but the philosophy differs sharply:

**API — DI over module mocks:**
- Mailer fakes are inline object literals implementing only the required `sendMagicLink`; optional methods are added as needed and record into a capture array:
  ```typescript
  const feedbacks: { to: string; f: { message: string; replyTo?: string; page?: string } }[] = [];
  mailer: {
    async sendMagicLink() {},
    async sendFeedback(to, f) { feedbacks.push({ to, f }); },
  },
  ```
  (`24pray-api/src/routes/feedback.test.ts:9-20`)
- Partial fakes that don't satisfy the full interface structurally are cast: `mailer: { async sendMagicLink() {}, sendAdminNotice } as Mailer` (`24pray-api/src/lib/adminNotify.test.ts:24`)
- Function-level mocks with `vi.fn`: `const sendAdminNotice = vi.fn(async (_to, _n) => {})`, asserted via `sendAdminNotice.mock.calls[0][0]` (`24pray-api/src/lib/adminNotify.test.ts:22,39`)
- The push sender seam is a plain function type, so tests inject `vi.fn` directly (`24pray-api/src/lib/push.test.ts:22`)
- Console spying with guaranteed restore:
  ```typescript
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { /* … */ expect(spy).toHaveBeenCalled(); } finally { spy.mockRestore(); }
  ```
  (`24pray-api/src/app.test.ts:107-115`)
- The ONE module-level spy, for the SMTP boundary: `vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never)` (`24pray-api/src/lib/mailer.test.ts:145-146`)

**UI — module factories + global stubs:**
- `next/navigation` is mocked in EVERY component/page test with the same factory (returns stub `useRouter/usePathname/useSearchParams`): `24pray-web/src/lib/locale.test.tsx:7-11`, `24pray-web/src/components/patterns/AppShell.test.tsx:5-9`
- The API layer is mocked per test file: `vi.mock('@/lib/api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }))` (`24pray-web/src/app/auth/login/login.test.tsx:12`); multi-endpoint variant in `24pray-web/src/app/dashboard/dashboard.test.tsx:26-29`
- Hooks are replaced wholesale: `vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: {...}, loading: false }) }))` (`24pray-web/src/components/patterns/AppShell.test.tsx:10-12`)
- `fetch` is stubbed globally with real `Response` objects:
  ```typescript
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  ```
  (`24pray-web/src/lib/api.test.ts:8-14`; also `24pray-web/src/app/[locale]/projects/[id]/metadata.test.ts:32-37`)
- To vary a mocked module's behavior inside one test, re-import it dynamically and cast: `const { api } = await import('@/lib/api'); (api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([...])` (`24pray-web/src/app/dashboard/dashboard.test.tsx:48-52`)
- Multi-step flows sequence resolutions with `post.mockResolvedValueOnce({})` in call order (`24pray-web/src/app/auth/login/login.test.tsx:23,30,47`)

**What to Mock — API:**
- `Mailer` (via `buildApp({ mailer })` injection, capture arrays); `PushSender` (direct argument); `console.*`; `nodemailer.createTransport` only when testing the real SMTP mailer

**What NOT to Mock — API:**
- The database: real throwaway SQLite per `makeTestDb()` with migrations applied via `execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } })` (`24pray-api/src/test/helpers.ts:19-22`)
- Time: no `vi.useFakeTimers` anywhere; clock-sensitive functions accept `now = new Date()` (`24pray-api/src/lib/jobs.ts:7,20`), tests pass explicit dates or shift `Date.now()` via row expiry arithmetic (`24pray-api/src/routes/auth.test.ts:128-130`)

**What to Mock — UI:**
- `next/navigation`, `@/lib/api`, feature hooks (`@/hooks/use-auth`), global `fetch`, `navigator` (`vi.stubGlobal('navigator', { ...navigator, language: lang })`, `24pray-web/src/lib/locale.test.tsx:14-16`), `localStorage` is the real jsdom one (cleared per test)

**What NOT to Mock — UI:**
- Pure logic: `24pray-web/src/components/slots/logic.test.ts` runs in node env with zero mocks; `next/navigation` is the only framework seam ever mocked — real `Response`, real jsdom DOM, real `Intl` timezones

## Fixtures and Factories

**Test Data:**
- Built inline with plain calls; no fixture files, no factory library:
  - **API:** Prisma creates + local helpers at the top of the file: `makeUser`, `makeDueProject` (`24pray-api/src/lib/jobs.test.ts:6-20`)
  - **UI:** typed constant objects spread per case: `const base: ProjectWithStats = { id: 'p1', … }` then `render(<ProjectCard project={{ ...base, description: '…' }} … />)` (`24pray-web/src/components/patterns/ProjectCard.test.tsx:8-23,45`); incomplete literals cast: `{ id, title, status: 'ACTIVE', … } as ProjectWithStats` (`24pray-web/src/app/dashboard/dashboard.test.tsx:45-47`)
  - **UI pure-logic builders:** `function slot(hour, over = {}): SlotView` and `const ctx = (over = {}): DerivationContext => ({ now: NOW, …, ...over })` (`24pray-web/src/components/slots/logic.test.ts:25-45`)
- Pinned time via `Date.parse` constants: `const NOW = Date.parse('2026-07-06T05:30:00.000Z')` (`24pray-web/src/components/slots/logic.test.ts:23`), `const DURING = Date.parse('2026-07-03T00:00:00.000Z')` (`24pray-web/src/components/patterns/ProjectCard.test.tsx:39`); API uses `new Date(Date.now() - 1000)` for expiry edges (`24pray-api/src/lib/jobs.test.ts:28-31`)
- Scenario prefixes in fixture values for greppability: API emails `wb-cleanup-session@…`, `un9-push@…`; UI ids/titles `p-pub`, `ux Alte Wache`

**Location:**
- API shared: `24pray-api/src/test/helpers.ts` (`makeTestDb` contract: temp dir + `test.db`, migrate, return `{ prisma, url, cleanup }`; call `cleanup()` in `afterAll` or `finally`)
- UI: per-file, top of the owning `*.test.*`

## Coverage

**Requirements:** None enforced, either repo. No coverage thresholds, no `coverage` config in either `vitest.config.ts`, no coverage step in either `.github/workflows/ci.yml`.

**View Coverage:**

```bash
npx vitest run --coverage   # ad hoc in either repo (needs @vitest/coverage-v8); not part of any standard workflow
```

## Test Types

**Unit Tests:**
- **API:** pure function/module scope, no app: `24pray-api/src/env.test.ts`, `src/lib/tokens.test.ts`, `src/lib/slotGrid.test.ts`, `src/lib/calendar.test.ts`, most of `src/lib/mailer.test.ts`
- **UI:** three flavors: pure logic (`24pray-web/src/components/slots/logic.test.ts`, 386 lines, zero mocks), module unit (`24pray-web/src/lib/api.test.ts`, `i18n.test.ts`, `routes.test.ts`, `time.test.ts`, `content/guides.test.ts`), and server-function unit (`metadata.test.ts` — `generateMetadata` driven with stubbed `fetch`; Next 15 async params passed as `Promise.resolve({ locale: 'de', id: 'p-pub' })`, `24pray-web/src/app/[locale]/projects/[id]/metadata.test.ts:41`)

**Integration Tests:**
- **API (dominant style):** full `buildApp` + real SQLite + `app.inject`: every `24pray-api/src/routes/*.test.ts` plus `app.test.ts`, `lib/jobs.test.ts`, `lib/push.test.ts`. Largest suites: `projects.test.ts` (47 KB), `community.test.ts` (34 KB)
- **UI (component/page level):** rendered pages/components against mocked API modules — `login.test.tsx` walks magic-link → code → verify-code → redirect (`24pray-web/src/app/auth/login/login.test.tsx:22-38`); `dashboard.test.tsx` covers anonymous dashboard behavior (F4)

**E2E Tests:**
- Not used in either repo. API has the operational smoke script `24pray-api/deploy/24pray-selfcheck.sh` (live instance check, not part of `npm test`); UI relies on CI `next build` (`24pray-web/.github/workflows/ci.yml`) as the closest end-to-end gate

## Common Patterns

**Async Testing:**
- Standard `async` `it` with full `await`, both repos
- **API fire-and-forget:** flush the microtask queue first:
  ```typescript
  /** Mikrotask-Queue leeren — notifyAdmin ist bewusst fire-and-forget (kein await im Aufrufer). */
  const flush = () => new Promise((r) => setTimeout(r, 0));
  ```
  (`24pray-api/src/lib/adminNotify.test.ts:17-18,27`)
- **UI async render:** `await waitFor(() => expect(screen.getByText('…')).toBeTruthy())` after `fireEvent` (`24pray-web/src/app/dashboard/dashboard.test.tsx:39`)

**Error Testing:**
- Sync throwers: `expect(() => parseEnv({})).toThrow()` (`24pray-api/src/env.test.ts:13`); UI rejected promises: `post.mockRejectedValueOnce(new Error('Code ungültig oder abgelaufen'))` then assert the message renders (`24pray-web/src/app/auth/login/login.test.tsx:47-50`)
- API HTTP error responses: assert `res.statusCode` + `res.json().message`, and verify internals do NOT leak:
  ```typescript
  expect(res.statusCode).toBe(500);
  expect(res.json().message).not.toContain('geheime UNIQUE-Interna');
  expect(res.json().message).toBe('Serverfehler');
  ```
  (`24pray-api/src/app.test.ts:99-104`)
- Tests build the same `statusCode`-carrying errors as production: `const e = new Error('gone') as Error & { statusCode?: number }; e.statusCode = 410; throw e;` (`24pray-api/src/lib/push.test.ts:25-27`)

**App/instance variations in one file:**
- **API:** second app instance with different env/deps — direct reference `const quietApp = await buildApp({...}); try { … } finally { await quietApp.close(); }` (`24pray-api/src/routes/auth.test.ts:58-70`), or dynamic re-import alias `const { buildApp: build } = await import('../app.js')` to avoid shadowing (`24pray-api/src/routes/feedback.test.ts:46-56`)
- **UI:** same technique against module mocks — reset behavior per test via `mockReset()` in `beforeEach` and `mockResolvedValueOnce` sequencing; `metadata.test.ts` dynamically imports the unit under test to control timing: `const load = async () => (await import('./metadata')).generateMetadata` (`24pray-web/src/app/[locale]/projects/[id]/metadata.test.ts:29`)

**Database isolation (API):**
- One shared `makeTestDb()` per suite for route tests (fast; `fileParallelism: false` in `24pray-api/vitest.config.ts` serializes suites)
- A fresh `makeTestDb()` per `it` with `try { … } finally { await db.cleanup(); }` when the test mutates broadly or asserts counts (`24pray-api/src/lib/jobs.test.ts:23-42`, `24pray-api/src/lib/push.test.ts:12-34`)

**Repeated-call helpers:**
- API: `function allowOrigin(origin: string) { return app.inject({ method: 'OPTIONS', url: '/auth/me', headers: { origin, 'access-control-request-method': 'GET' } }); }` (`24pray-api/src/app.test.ts:30-39`)
- UI: shared mock factories (`const push = vi.fn()` hoisted beside `vi.mock`, `24pray-web/src/app/auth/login/login.test.tsx:5-12`) so both the mock factory and assertions reference the same fn

**Debugging notes:**
- API `hookTimeout: 20000` accommodates per-suite `npx prisma migrate deploy` in `makeTestDb` — keep heavy setup in `beforeAll`, stay within budget
- UI tests depend on the `@` alias resolution in `24pray-web/vitest.config.ts` — imports under test must use `@/…` exactly as the app does

## Cross-Project Testing Notes

- Same command surface: `npm test` = `vitest run` in both repos; both CI pipelines run `tsc --noEmit` then `vitest run` on Node 22
- Same naming/fixture language (German titles, prefixed scenario values, pinned `now`)
- Opposite mocking philosophies by design: API injects fakes through `buildApp` deps + real SQLite; UI mocks modules (`vi.mock`) and globals (`vi.stubGlobal`) because Next.js has no DI seam. When adding features touching BOTH repos, write API tests in the DI style and UI tests in the module-mock style — do not cross them
- Time control is fake-timer-free in BOTH repos: API via `now` default params, UI via `now` props/context values
- Consolidation candidates (verified 2026-10-26): Vitest majors skew (`^2` vs `^4` — see CONVENTIONS.md "Verified Inconsistencies"); UI CI additionally runs `next lint` while API has no lint step; no coverage tooling in either repo

---
*Testing analysis: 2026-10-26*
