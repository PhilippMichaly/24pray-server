# Cookiefreies Funnel-Zählen (Backlog 8) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregierte Tageszähler für den Funnel Landing→Liste→Wache→Buchung — ohne Cookies, ohne Personenbezug, ohne Banner-Pflicht; auslesbar über einen token-geschützten JSON-Endpoint.

**Architecture:** Neues Prisma-Modell `FunnelCount { date, step, count }` (`@@unique([date, step])`). Die drei Seiten-Schritte (`landing`, `list`, `watch`) meldet das Web per Fire-and-forget-POST `/funnel/hit` (nur der Step-Name, kein IP-/User-Bezug wird gespeichert); der Conversion-Schritt `booking` wird rein serverseitig im Buchungs-Handler gezählt. `GET /stats/funnel?token=…` liefert die letzten 30 Tage; ohne konfiguriertes `FUNNEL_TOKEN` existiert der Lese-Endpoint praktisch nicht (404).

**Tech Stack:** Bestand — keine neuen Dependencies.

## Global Constraints

- Repos: API = `/home/pmi/24pray-api`, Web = `/home/pmi/24pray-web` (Branch `main`). Committen ja, **NICHT pushen**.
- **Datenschutz ist der Punkt des Features:** Es wird AUSSCHLIESSLICH `(date, step, count)` gespeichert — keine IP, kein User-Agent, keine IDs, keine Referrer. Jede Abweichung davon ist ein Spec-Verstoß.
- **NIEMALS `next build` lokal**; keinen Dev-Server killen; **NIEMALS `prisma migrate dev`** — manuelle Migrations-Prozedur (Ordner von Hand, python3-sqlite `timeout=30` in `data/24pray.db`, `migrate resolve --applied`; bei deterministischem „database is locked": manueller `_prisma_migrations`-INSERT mit sha256-Checksum = etabliertes Repo-Muster; danach `npx prisma generate && touch src/server.ts`).
- Zähl-Fehler dürfen NIE eine Nutzer-Aktion kippen (fire-and-forget, `.catch`).
- Suiten: api vitest+tsc; web vitest+tsc+lint. TDD, Testdaten-Prefix `un8-`.
- Commit-Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_011CPPASHZYersFD37Auq5kB`

---

### Task 1: API — Modell, Hit-Endpoint, Booking-Zähler, Lese-Endpoint

**Files:**
- Modify: `/home/pmi/24pray-api/prisma/schema.prisma` (neues Modell)
- Create: `/home/pmi/24pray-api/prisma/migrations/20260709180000_add_funnel_counts/migration.sql`
- Create: `/home/pmi/24pray-api/src/routes/funnel.ts`
- Modify: `/home/pmi/24pray-api/src/app.ts` (Registrierung)
- Modify: `/home/pmi/24pray-api/src/env.ts` (`FUNNEL_TOKEN`)
- Modify: `/home/pmi/24pray-api/src/routes/slots.ts` (booking-Zähler nach erfolgreicher Buchung)
- Test: `/home/pmi/24pray-api/src/routes/funnel.test.ts` (neu)

**Interfaces:**
- Produces:
  - `POST /funnel/hit` Body `{ step: 'landing' | 'list' | 'watch' }` → 204; Rate-Limit 120/min.
  - `GET /stats/funnel?token=<FUNNEL_TOKEN>` → `{ days: { date: string; landing: number; list: number; watch: number; booking: number }[] }` (letzte 30 Tage, absteigend); 404 wenn `FUNNEL_TOKEN` leer ODER Token falsch (kein Unterschied nach außen).
  - Helper `bumpFunnel(prisma, step)` (exportiert aus `funnel.ts`) — Task konsumiert ihn selbst in `slots.ts` für `'booking'`.
  - `env.FUNNEL_TOKEN: z.string().default('')`.

- [ ] **Step 1: Failing Tests schreiben**

`/home/pmi/24pray-api/src/routes/funnel.test.ts` (Kopf nach dem Muster von `community.test.ts`: `makeTestDb`, `buildApp` mit `parseEnv({ APP_URL: 'http://localhost:3000', FUNNEL_TOKEN: 'un8-secret' })`, Fake-Mailer nur `sendMagicLink`-Capture für `loginAs`):

```ts
describe('Backlog 8 — Funnel-Zähler', () => {
  it('POST /funnel/hit zählt pro Tag+Step hoch, 204, speichert NUR date/step/count', async () => {
    for (const step of ['landing', 'landing', 'list', 'watch'] as const) {
      const res = await app.inject({ method: 'POST', url: '/funnel/hit', payload: { step } });
      expect(res.statusCode).toBe(204);
    }
    const rows = await db.prisma.funnelCount.findMany();
    const byStep = new Map(rows.map((r) => [r.step, r.count]));
    expect(byStep.get('landing')).toBe(2);
    expect(byStep.get('list')).toBe(1);
    expect(byStep.get('watch')).toBe(1);
    // Datenschutz-Kern: das Modell HAT keine weiteren Spalten (id/date/step/count)
    expect(Object.keys(rows[0]).sort()).toEqual(['count', 'date', 'id', 'step']);
  });

  it('ungültiger step → 400; booking ist NICHT über den öffentlichen Hit-Endpoint zählbar', async () => {
    expect((await app.inject({ method: 'POST', url: '/funnel/hit', payload: { step: 'booking' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/funnel/hit', payload: { step: 'x' } })).statusCode).toBe(400);
  });

  it('Buchung zählt booking serverseitig', async () => {
    const owner = await loginAs('un8-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un8 Funnel', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`, payload: { startTime: at(1), guestName: 'un8-Gast' } });
    await vi.waitFor(async () => {
      const row = await db.prisma.funnelCount.findFirst({ where: { step: 'booking' } });
      expect(row?.count ?? 0).toBeGreaterThanOrEqual(1);
    });
  });

  it('GET /stats/funnel: 404 ohne/mit falschem Token, Daten mit richtigem Token', async () => {
    expect((await app.inject({ method: 'GET', url: '/stats/funnel' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/stats/funnel?token=falsch' })).statusCode).toBe(404);
    const ok = await app.inject({ method: 'GET', url: '/stats/funnel?token=un8-secret' });
    expect(ok.statusCode).toBe(200);
    const today = ok.json().days.find((d: { date: string }) => d.date === new Date().toISOString().slice(0, 10));
    expect(today.landing).toBeGreaterThanOrEqual(2);
    expect(today.booking).toBeGreaterThanOrEqual(1);
  });

  it('GET /stats/funnel: 404 wenn FUNNEL_TOKEN leer (Endpoint faktisch aus)', async () => {
    const { buildApp: build } = await import('../app.js');
    const bare = await build({
      prisma: db.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000' }),
      mailer: { async sendMagicLink() {} },
    });
    await bare.ready();
    try {
      expect((await bare.inject({ method: 'GET', url: '/stats/funnel?token=' })).statusCode).toBe(404);
      expect((await bare.inject({ method: 'GET', url: '/stats/funnel?token=un8-secret' })).statusCode).toBe(404);
    } finally { await bare.close(); }
  });
});
```

(Fixtures `loginAs`/`at` nach dem Muster der Datei-Vorbilder aufbauen; Reihenfolge der Tests beachten — der Token-Test liest die Zähler der vorherigen Tests derselben Datei.)

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/routes/funnel.test.ts`
Expected: FAIL — `funnelCount` existiert nicht / Routen 404.

- [ ] **Step 3: Schema + Migration**

`prisma/schema.prisma` (nach `model UpdateOptOut`):

```prisma
// Cookiefreies Funnel-Zählen (Backlog 8): AUSSCHLIESSLICH aggregierte Tageszähler —
// keine IP, kein UA, keine IDs. date = YYYY-MM-DD (UTC), step = landing|list|watch|booking.
model FunnelCount {
  id    String @id @default(cuid())
  date  String
  step  String
  count Int    @default(0)

  @@unique([date, step])
}
```

`prisma/migrations/20260709180000_add_funnel_counts/migration.sql`:

```sql
CREATE TABLE "FunnelCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "FunnelCount_date_step_key" ON "FunnelCount"("date", "step");
```

Anwenden per manueller Prozedur, dann `npx prisma generate && touch src/server.ts`.

- [ ] **Step 4: env + Routen-Modul**

`src/env.ts` — nach `UNSUBSCRIBE_SECRET`:

```ts
  // Lese-Token für GET /stats/funnel (Backlog 8). Leer = Lese-Endpoint antwortet 404.
  FUNNEL_TOKEN: z.string().default(''),
```

`src/routes/funnel.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../env.js';

// Öffentlich meldbare Schritte — 'booking' fehlt bewusst: Conversion zählt NUR der Server
// im Buchungs-Handler, sonst wäre der Trichter von außen aufblasbar.
const HitBody = z.object({ step: z.enum(['landing', 'list', 'watch']) });
const FunnelQuery = z.object({ token: z.string().optional() });

const DAYS = 30;
export type FunnelStep = 'landing' | 'list' | 'watch' | 'booking';

/** Tageszähler hochzählen — bewusst OHNE jeden Personen-/Request-Bezug (Backlog 8). */
export async function bumpFunnel(prisma: PrismaClient, step: FunnelStep): Promise<void> {
  const date = new Date().toISOString().slice(0, 10); // UTC-Tag
  await prisma.funnelCount.upsert({
    where: { date_step: { date, step } },
    update: { count: { increment: 1 } },
    create: { date, step, count: 1 },
  });
}

export function funnelRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; env?: Env }) {
  const { prisma, env } = deps;

  app.post('/funnel/hit', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { step } = HitBody.parse(req.body);
    // fire-and-forget: Zählen darf nie eine Nutzer-Interaktion verlangsamen oder kippen
    bumpFunnel(prisma, step).catch((err) => console.error('[funnel] hit failed:', err));
    return reply.code(204).send();
  });

  app.get('/stats/funnel', async (req, reply) => {
    const { token } = FunnelQuery.parse(req.query);
    // Ohne konfiguriertes Token existiert der Endpoint nach außen nicht (404, nie 401/403 —
    // kein Orakel, ob es hier etwas zu holen gibt).
    if (!env?.FUNNEL_TOKEN || !token || token !== env.FUNNEL_TOKEN) {
      return reply.code(404).send({ message: 'Nicht gefunden' });
    }
    const cutoff = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
    const rows = await prisma.funnelCount.findMany({
      where: { date: { gte: cutoff } },
      orderBy: { date: 'desc' },
    });
    const byDate = new Map<string, { date: string; landing: number; list: number; watch: number; booking: number }>();
    for (const r of rows) {
      const d = byDate.get(r.date) ?? { date: r.date, landing: 0, list: 0, watch: 0, booking: 0 };
      (d as Record<string, number | string>)[r.step] = r.count;
      byDate.set(r.date, d);
    }
    return { days: [...byDate.values()] };
  });
}
```

`src/app.ts` — Import + Registrierung neben den anderen Routen:

```ts
import { funnelRoutes } from './routes/funnel.js';
```

```ts
  funnelRoutes(app, { prisma, env });
```

- [ ] **Step 5: Booking-Zähler in slots.ts**

In `/home/pmi/24pray-api/src/routes/slots.ts` — Import:

```ts
import { bumpFunnel } from './funnel.js';
```

Im Buchungs-Handler nach der erfolgreichen Slot-Erstellung (nach dem `ensureMembership`-Aufruf, vor den Mail-Blöcken):

```ts
    // Funnel-Conversion (Backlog 8): serverseitig, aggregiert, ohne Personenbezug.
    bumpFunnel(prisma, 'booking').catch((err) => console.error('[funnel] booking bump failed:', err));
```

- [ ] **Step 6: Tests laufen lassen — grün (komplette Suite)**

Run: `cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/pmi/24pray-api
git add prisma/schema.prisma prisma/migrations/20260709180000_add_funnel_counts/ src/routes/funnel.ts src/routes/funnel.test.ts src/app.ts src/env.ts src/routes/slots.ts
git commit -m "feat(funnel): cookiefreie Tageszaehler (hit-Endpoint, booking serverseitig, Token-Read) (Backlog 8)"
```

---

### Task 2: Web — Seiten-Pings (landing, list, watch)

**Files:**
- Create: `/home/pmi/24pray-web/src/lib/funnel.ts`
- Test: `/home/pmi/24pray-web/src/lib/funnel.test.ts`
- Modify: `/home/pmi/24pray-web/src/app/(public)/page.tsx` (landing-Ping)
- Modify: `/home/pmi/24pray-web/src/app/dashboard/page.tsx` (list-Ping)
- Modify: `/home/pmi/24pray-web/src/app/projects/[id]/page.tsx` (watch-Ping)

**Interfaces:**
- Consumes: `api` aus `@/lib/api` (POST-Helper).
- Produces: `pingFunnel(step: 'landing' | 'list' | 'watch'): void` — fire-and-forget, dedupliziert pro Seiten-Mount via `useFunnelPing(step)`-Hook (einmal pro Mount, nicht pro Re-Render).

- [ ] **Step 1: Failing Test schreiben**

`/home/pmi/24pray-web/src/lib/funnel.test.ts`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const post = vi.fn(async () => undefined);
vi.mock('@/lib/api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

import { useFunnelPing } from './funnel';

describe('funnel ping (Backlog 8)', () => {
  beforeEach(() => post.mockClear());

  it('pingt einmal pro Mount, nicht pro Re-Render', () => {
    const { rerender } = renderHook(() => useFunnelPing('landing'));
    rerender();
    rerender();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/funnel/hit', { step: 'landing' });
  });

  it('schluckt Fehler still (Zählen kippt nie die Seite)', () => {
    post.mockRejectedValueOnce(new Error('down'));
    expect(() => renderHook(() => useFunnelPing('watch'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-web && npx vitest run src/lib/funnel.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Implementierung**

`/home/pmi/24pray-web/src/lib/funnel.ts`:

```tsx
'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';

// Cookiefreies Funnel-Zählen (Backlog 8): nur der Step-Name geht an den eigenen Server,
// aggregiert zu Tageszählern — keine Cookies, keine IDs, kein Banner nötig.
export type FunnelPageStep = 'landing' | 'list' | 'watch';

export function pingFunnel(step: FunnelPageStep): void {
  api.post('/funnel/hit', { step }).catch(() => {
    /* Zählen darf nie stören */
  });
}

/** Einmal pro Seiten-Mount pingen (StrictMode-Doppel-Mount in dev ist als Unschärfe akzeptiert). */
export function useFunnelPing(step: FunnelPageStep): void {
  useEffect(() => {
    pingFunnel(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

- [ ] **Step 4: Einbau in die drei Seiten**

Jeweils Import `import { useFunnelPing } from '@/lib/funnel';` und als erste Hook-Zeile in der Page-Komponente:

- `src/app/(public)/page.tsx`: `useFunnelPing('landing');`
- `src/app/dashboard/page.tsx`: `useFunnelPing('list');`
- `src/app/projects/[id]/page.tsx`: `useFunnelPing('watch');`

- [ ] **Step 5: Suiten laufen lassen — grün**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS (bestehende Seiten-Tests mocken `@/lib/api` bereits — der zusätzliche POST läuft dort ins Mock; falls ein Test auf exakte api-Aufrufe asserted und bricht, Assertion minimal ergänzen und im Report begründen).

- [ ] **Step 6: Commit**

```bash
cd /home/pmi/24pray-web
git add src/lib/funnel.ts src/lib/funnel.test.ts "src/app/(public)/page.tsx" src/app/dashboard/page.tsx "src/app/projects/[id]/page.tsx"
git commit -m "feat(funnel): Seiten-Pings landing/list/watch (cookiefrei) (Backlog 8)"
```

---

### Task 3: Abschluss — Suiten + Backlog (KEIN Push)

**Files:**
- Modify: `/home/pmi/24pray-web/docs/BACKLOG.md`

- [ ] **Step 1: Beide Suiten komplett**

```bash
cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit
cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint
```

- [ ] **Step 2: Backlog — Punkt 8 ersetzen**

```markdown
8. ~~**Cookiefreies, aggregiertes Server-Zählen**~~ — GEBAUT 2026-07-09 (Tageszähler
   landing/list/watch per Seiten-Ping, booking serverseitig im Buchungs-Handler; gespeichert
   wird AUSSCHLIESSLICH date+step+count. Lesen: GET /stats/funnel?token=… — FUNNEL_TOKEN
   beim Deploy in /etc/24pray-api.env setzen, ohne Token antwortet der Endpoint 404.)
```

- [ ] **Step 3: Commit (nur web, kein Push)**

```bash
cd /home/pmi/24pray-web
git add docs/BACKLOG.md
git commit -m "docs(backlog): Punkt 8 Funnel-Zaehler gebaut"
```
