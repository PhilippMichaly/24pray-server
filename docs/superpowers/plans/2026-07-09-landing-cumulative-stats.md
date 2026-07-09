# Kumulative Stunden + Schwellwert auf der Landing (Backlog 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Landing zeigt „Bereits N Stunden gemeinsam gebetet" (kumulativ über alle COMPLETED-Slots, gewichtet nach Slot-Dauer) statt der kleinen Live-Zahlen; unter der Schwelle 5 verschwinden Zahlen ganz (Kaltstart-Wahrnehmung).

**Architecture:** `/stats/public` bekommt ein zusätzliches Aggregat `completedHours` (ein Raw-SQL-Join, läuft im bestehenden `Promise.all` + TTL-Cache mit — keine Migration). Im Web wird die Zahlen-Zeile der Landing in eine neue, testbare Komponente `LandingStats` extrahiert, die die Schwellwert-Logik trägt: unter 5 kumulierten Stunden nichts, ab 5 die kumulative Zahl, die Live-Zahl „N laufen gerade" zusätzlich erst ab 5 aktiven Wachen. Der bisher falsch beschriftete Wert (`heldSlots` = Slot-Anzahl, angezeigt als „Stunden gehalten") verschwindet aus der UI.

**Tech Stack:** Fastify + Prisma `$queryRaw` (SQLite) im API; Next.js 14 + vitest/@testing-library (jsdom) im Web. Keine neuen Dependencies, keine Migration.

## Global Constraints

- Repos: API = `/home/pmi/24pray-api`, Web = `/home/pmi/24pray-web` (getrennte Git-Repos, Branch `main`). Committen ja, **NICHT pushen** (Push nach Final-Review durch den Advisor).
- **NIEMALS `next build` lokal**; keinen Dev-Server killen; kein `prisma migrate dev` (hier ohnehin keine Migration).
- Schwellwert: EINE Konstante `STATS_MIN_VISIBLE = 5` in `LandingStats.tsx` — gilt für kumulierte Stunden UND aktive Wachen (Entscheidung User 2026-07-09). Dashboard bleibt unangetastet (Entscheidung: nur Landing).
- i18n Web: 5 Kataloge typvollständig (`Record<keyof typeof de, string>`) — neuer Key in ALLE 5; entfernter Key aus ALLEN 5 (sonst tsc-Fehler durch Überschuss-Property).
- Suiten pro Repo: `npx vitest run` + `npx tsc --noEmit`; Web zusätzlich `npx next lint`.
- Testdaten-Prefix `un2-`, nur Test-DB. TDD: RED zuerst.
- Commit-Trailer an jede Commit-Message:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_011CPPASHZYersFD37Auq5kB`

---

### Task 1: API — `completedHours` in `/stats/public`

**Files:**
- Modify: `/home/pmi/24pray-api/src/routes/community.ts:195-255` (Route `/stats/public`)
- Test: `/home/pmi/24pray-api/src/routes/community.test.ts`

**Interfaces:**
- Consumes: bestehende Route-Struktur (`Promise.all`-Block Zeile ~200, `data`-Objekt Zeile ~239ff, `statsCache`).
- Produces: `/stats/public`-Response enthält zusätzlich `completedHours: number` (Summe `slotDurationMinutes/60` aller COMPLETED-Slots über ALLE Projekte, auf 2 Nachkommastellen gerundet, `0` wenn keine). Task 2 konsumiert exakt dieses Feld.

- [ ] **Step 1: Failing Test schreiben**

In `/home/pmi/24pray-api/src/routes/community.test.ts` neues Top-Level-`describe` (Fixtures `app`/`db`/`loginAs` der Datei nutzen; das Haupt-`app` hat `STATS_CACHE_TTL_MS: '0'` → kein Cache, jeder GET ist frisch):

```ts
describe('Backlog 2 — kumulative Stunden in /stats/public', () => {
  it('completedHours summiert COMPLETED-Slots gewichtet nach slotDurationMinutes', async () => {
    const owner = await loginAs('un2-stats-owner@example.com');
    const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    // Stunden-Wache (60 min) + Tages-Wache (1440 min)
    const p1 = (await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un2 Stunden', startDate: future(-48), endDate: future(4), visibility: 'PUBLIC' },
    })).json().id as string;
    const p2 = (await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un2 Tage', startDate: future(-72), endDate: future(48), visibility: 'PUBLIC', slotDurationMinutes: 1440 },
    })).json().id as string;

    const before = (await app.inject({ method: 'GET', url: '/stats/public' })).json().completedHours ?? 0;

    // COMPLETED-Slots direkt anlegen (nur Test-DB): 2×60min = 2h, 1×1440min = 24h → Delta 26h
    const at = (h: number) => new Date(Date.now() - h * 3600_000);
    await db.prisma.prayerSlot.create({ data: { projectId: p1, startTime: at(30), endTime: at(29), status: 'COMPLETED', guestName: 'un2-a' } });
    await db.prisma.prayerSlot.create({ data: { projectId: p1, startTime: at(28), endTime: at(27), status: 'COMPLETED', guestName: 'un2-b' } });
    await db.prisma.prayerSlot.create({ data: { projectId: p2, startTime: at(60), endTime: at(36), status: 'COMPLETED', guestName: 'un2-c' } });

    const after = (await app.inject({ method: 'GET', url: '/stats/public' })).json().completedHours;
    expect(typeof after).toBe('number');
    expect(after - before).toBeCloseTo(26, 5);
  });

  it('completedHours ist 0-sicher (Feld existiert immer, BOOKED zählt nicht)', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats/public' });
    expect(res.statusCode).toBe(200);
    expect(res.json().completedHours).toBeGreaterThanOrEqual(0); // nie null/undefined
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/routes/community.test.ts`
Expected: FAIL — `completedHours` ist `undefined` (Feld existiert noch nicht; `expect(typeof after).toBe('number')` schlägt fehl).

- [ ] **Step 3: Implementierung**

In `/home/pmi/24pray-api/src/routes/community.ts`, Route `/stats/public`:

Den `Promise.all`-Block erweitern (Destructuring + neue Query als drittes Element, VOR `located`):

```ts
    const [activeChains, heldSlots, completedRows, located] = await Promise.all([
      prisma.prayerProject.count({ where: activeWhere }),
      prisma.prayerSlot.count({ where: { status: { in: ['BOOKED', 'COMPLETED'] } } }),
      // Kumulative Gebets-Stunden (Backlog 2): COMPLETED-Slots gewichtet nach Projekt-Slot-Dauer
      // (60 vs. 1440 min) — ein Join-Aggregat statt N+1, läuft im TTL-Cache mit.
      prisma.$queryRaw<{ hours: number | null }[]>`
        SELECT SUM(p."slotDurationMinutes") / 60.0 AS hours
        FROM "PrayerSlot" s JOIN "PrayerProject" p ON p."id" = s."projectId"
        WHERE s."status" = 'COMPLETED'
      `,
      prisma.prayerProject.findMany({
```

(der bestehende `findMany`-Aufruf bleibt unverändert das letzte Element).

Nach dem `Promise.all`, vor `const data = {`:

```ts
    const completedHours = Math.round((completedRows[0]?.hours ?? 0) * 100) / 100;
```

Im `data`-Objekt nach `heldSlots,`:

```ts
      completedHours,
```

- [ ] **Step 4: Tests laufen lassen — grün (komplette Suite)**

Run: `cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit`
Expected: PASS (auch die bestehenden `/stats/public`-Tests W3.4/W3.5/Cache dürfen nicht brechen — die Response ist rein additiv erweitert).

- [ ] **Step 5: Commit**

```bash
cd /home/pmi/24pray-api
git add src/routes/community.ts src/routes/community.test.ts
git commit -m "feat(stats): kumulative completedHours in /stats/public (Backlog 2)"
```

---

### Task 2: Web — `LandingStats`-Komponente mit Schwellwert + Einbau

**Files:**
- Create: `/home/pmi/24pray-web/src/components/patterns/LandingStats.tsx`
- Test: `/home/pmi/24pray-web/src/components/patterns/LandingStats.test.tsx`
- Modify: `/home/pmi/24pray-web/src/app/(public)/page.tsx:16-20` (PublicStats-Interface) und `:129-134` (Zahlen-Zeile)
- Modify: `/home/pmi/24pray-web/src/lib/i18n.ts` (Key `statsHoursPrayed` NEU in alle 5 Kataloge; Key `statsHoursHeld` aus ALLEN 5 ENTFERNEN — einziger Nutzer war page.tsx:132)

**Interfaces:**
- Consumes: `completedHours: number` aus `/stats/public` (Task 1); i18n-`t()`; bestehender Key `statsChainsActive`.
- Produces: `LandingStats({ completedHours, activeChains }: { completedHours: number; activeChains: number })` — rendert `null` unter Schwelle; exportierte Konstante `STATS_MIN_VISIBLE = 5`.

- [ ] **Step 1: Failing Test schreiben**

`/home/pmi/24pray-web/src/components/patterns/LandingStats.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LandingStats } from './LandingStats';

describe('LandingStats — Schwellwert-Logik (Backlog 2)', () => {
  beforeEach(() => cleanup());

  it('unter 5 kumulierten Stunden: gar nichts (Kaltstart)', () => {
    const { container } = render(<LandingStats completedHours={4.9} activeChains={20} />);
    expect(container.textContent).toBe('');
  });

  it('ab 5 Stunden: kumulative Zahl (gerundet), Live-Zahl unter Schwelle bleibt weg', () => {
    const { container } = render(<LandingStats completedHours={127.6} activeChains={4} />);
    expect(container.textContent).toContain('128');
    expect(container.textContent).toContain('gemeinsam gebetet');
    expect(container.textContent).not.toContain('laufen gerade');
  });

  it('ab 5 aktiven Wachen zusätzlich die Live-Zahl', () => {
    const { container } = render(<LandingStats completedHours={128} activeChains={7} />);
    expect(container.textContent).toContain('gemeinsam gebetet');
    expect(container.textContent).toContain('7');
    expect(container.textContent).toContain('laufen gerade');
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-web && npx vitest run src/components/patterns/LandingStats.test.tsx`
Expected: FAIL — Modul `./LandingStats` existiert nicht.

- [ ] **Step 3: i18n-Keys**

In `/home/pmi/24pray-web/src/lib/i18n.ts`:

**Entfernen** (alle 5 Vorkommen — de:38, en:328, es:604, he:881, ar:1158): die Zeile `statsHoursHeld: …`.

**Hinzufügen** jeweils direkt neben `statsChainsActive` (de:37, en:327, es:603, he:880, ar:1157):

```ts
  // de:
  statsHoursPrayed: 'Bereits {n} Stunden gemeinsam gebetet',
  // en:
  statsHoursPrayed: 'Already {n} hours prayed together',
  // es:
  statsHoursPrayed: 'Ya {n} horas orando juntos',
  // he:
  statsHoursPrayed: 'כבר {n} שעות של תפילה משותפת',
  // ar:
  statsHoursPrayed: 'صلّينا معًا {n} ساعة حتى الآن',
```

(he/ar unter dem bestehenden Muttersprachler-Review-Merkposten.)

- [ ] **Step 4: Komponente schreiben**

`/home/pmi/24pray-web/src/components/patterns/LandingStats.tsx`:

```tsx
'use client';

import { t } from '@/lib/i18n';

/** Schwelle (Backlog 2, Kaltstart-Wahrnehmung): gilt für kumulierte Stunden UND aktive Wachen. */
export const STATS_MIN_VISIBLE = 5;

export interface LandingStatsProps {
  /** Kumulativ über alle Wachen: COMPLETED-Slots × Slot-Dauer, in Stunden. */
  completedHours: number;
  activeChains: number;
}

/**
 * Zahlen-Zeile der Landing: führt mit der kumulativen Gesamtleistung („Bereits N Stunden
 * gemeinsam gebetet") statt kleiner Live-Zahlen; unter der Schwelle lieber gar keine Zahl
 * als eine, die Leere signalisiert.
 */
export function LandingStats({ completedHours, activeChains }: LandingStatsProps) {
  if (completedHours < STATS_MIN_VISIBLE) return null;
  return (
    <p className="mt-5 text-sm text-gold tnum" aria-live="polite">
      {t('statsHoursPrayed', { n: Math.round(completedHours) })}
      {activeChains >= STATS_MIN_VISIBLE && <> · {t('statsChainsActive', { n: activeChains })}</>}
    </p>
  );
}
```

Hinweis: Falls `t()`s Params-Typ `string` verlangt (Signatur in `i18n.ts:1458` prüfen — bestehender Code übergibt `{ n: stats.activeChains }` als number), Zahlen exakt wie im Bestand übergeben, NICHT die t()-Signatur ändern.

- [ ] **Step 5: Einbau in die Landing**

In `/home/pmi/24pray-web/src/app/(public)/page.tsx`:

Interface erweitern (Zeile 16-20):

```ts
interface PublicStats {
  activeChains: number;
  heldSlots: number;
  completedHours?: number; // optional: tolerant gegen gecachte/alte API-Antworten
  points?: ChainPoint[];
}
```

Import ergänzen (bei den anderen `@/components`-Imports):

```ts
import { LandingStats } from '@/components/patterns/LandingStats';
```

Die Zeilen 129-134 (`{stats && stats.activeChains > 0 && ( … )}`-Block) ersetzen durch:

```tsx
        {stats && (
          <LandingStats completedHours={stats.completedHours ?? 0} activeChains={stats.activeChains} />
        )}
```

- [ ] **Step 6: Suiten laufen lassen — grün**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS. tsc erzwingt: neuer Key in allen 5 Katalogen, entfernter Key nirgends mehr referenziert.

- [ ] **Step 7: Commit**

```bash
cd /home/pmi/24pray-web
git add src/components/patterns/LandingStats.tsx src/components/patterns/LandingStats.test.tsx "src/app/(public)/page.tsx" src/lib/i18n.ts
git commit -m "feat(landing): kumulative Stunden mit Schwellwert statt kleiner Live-Zahlen (Backlog 2)"
```

---

### Task 3: Abschluss — Volle Suiten + Backlog pflegen (KEIN Push)

**Files:**
- Modify: `/home/pmi/24pray-web/docs/BACKLOG.md`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: grüne Suiten beider Repos, aktualisiertes Backlog. Push macht der Advisor nach der Final-Review.

- [ ] **Step 1: Beide Suiten komplett**

```bash
cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit
cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint
```

Expected: alles grün.

- [ ] **Step 2: Backlog aktualisieren**

In `/home/pmi/24pray-web/docs/BACKLOG.md` den Punkt 2 der Web2-Loops ersetzen durch:

```markdown
2. ~~**Kumulative Zahlen + Schwellwert**~~ — GEBAUT 2026-07-09 (Landing: „Bereits N Stunden
   gemeinsam gebetet" = COMPLETED-Slots × Slot-Dauer über alle Wachen; Live-Zahl „N laufen
   gerade" nur noch ab 5 aktiven Wachen, unter 5 kumulierten Stunden gar keine Zahlen.
   Fixt nebenbei das Mislabeling heldSlots=Slot-Anzahl≠Stunden. Dashboard bewusst
   ausgelassen — dort gibt es kein globales Aggregat.)
```

- [ ] **Step 3: Commit (nur web, kein Push)**

```bash
cd /home/pmi/24pray-web
git add docs/BACKLOG.md
git commit -m "docs(backlog): Punkt 2 kumulative Zahlen + Schwellwert gebaut"
```
