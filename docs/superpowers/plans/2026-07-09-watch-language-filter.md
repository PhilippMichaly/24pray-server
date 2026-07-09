# Wachen-Sprache + Listen-Filter (Backlog 5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Wache bekommt beim Anlegen ein `language`-Feld (still aus der UI-Sprache, wie die Zeitzone) und die Wachen-Liste (`/dashboard`) einen Sprach-Filter.

**Architecture:** `PrayerProject.language` (Enum-Werte der 5 UI-Locales, Default `de`) — Migration additiv, Erfassung im Create-Flow (`getLocale()` im Web, `MailLocale`-Validierung in der API), Rückgabe über `projectView`. Der Filter ist rein client-seitig im Dashboard (die Liste ist bereits vollständig geladen; kein API-Query-Param nötig). Sortierung bleibt UNVERÄNDERT neueste-zuerst (User-Entscheidung 2026-07-09).

**Tech Stack:** Bestand — keine neuen Dependencies.

## Global Constraints

- Repos: API = `/home/pmi/24pray-api`, Web = `/home/pmi/24pray-web` (Branch `main`). Committen ja, **NICHT pushen**.
- **NIEMALS `next build` lokal**; keinen Dev-Server killen; **NIEMALS `prisma migrate dev`** — manuelle Migrations-Prozedur (Ordner von Hand, python3-sqlite `timeout=30` in `data/24pray.db`, `DATABASE_URL="file:../data/24pray.db" npx prisma migrate resolve --applied <name>`; falls `migrate resolve` mit „database is locked" deterministisch fehlschlägt: Row manuell in `_prisma_migrations` einfügen — Format der 6 vorhandenen Rows, checksum = sha256-hex der migration.sql —, das ist in diesem Repo etabliertes Muster; danach `npx prisma generate && touch src/server.ts`).
- Sprach-Werte = exakt die 5 UI-Locales `de|en|es|he|ar` (`MailLocale` aus `src/schemas/auth.ts`).
- i18n Web: neuer Key in ALLE 5 Kataloge. Suiten: api vitest+tsc; web vitest+tsc+lint. TDD, Testdaten-Prefix `un5-`.
- Commit-Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_011CPPASHZYersFD37Auq5kB`

---

### Task 1: API — `PrayerProject.language` (Schema, Create, Rückgabe)

**Files:**
- Modify: `/home/pmi/24pray-api/prisma/schema.prisma` (PrayerProject)
- Create: `/home/pmi/24pray-api/prisma/migrations/20260709160000_add_project_language/migration.sql`
- Modify: `/home/pmi/24pray-api/src/schemas/projects.ts:10-28` (CreateProjectBody)
- Modify: `/home/pmi/24pray-api/src/routes/projects.ts:70-92` (Create-Route, `data`-Block)
- Modify: `/home/pmi/24pray-api/src/lib/projectView.ts:68-91` (Rückgabe-Objekt)
- Test: `/home/pmi/24pray-api/src/routes/projects.test.ts`

**Interfaces:**
- Consumes: `MailLocale` aus `src/schemas/auth.ts` (existiert: `z.enum(['de','en','es','he','ar'])`).
- Produces: `POST /projects` akzeptiert `language` (default `'de'`); `ProjectWithStats`-Antworten enthalten `language: string`. Task 2 konsumiert exakt dieses Feld.

- [ ] **Step 1: Failing Test schreiben**

In `/home/pmi/24pray-api/src/routes/projects.test.ts` neues `describe` (Fixtures `app`/`loginAs`/Zeit-Helper der Datei nutzen):

```ts
describe('Backlog 5 — Wachen-Sprache', () => {
  it('Create persistiert language und Liste liefert es zurück; Default de', async () => {
    const owner = await loginAs('un5-lang-owner@example.com');
    const es = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un5 Vigilia', startDate: at(0), endDate: at(6), visibility: 'PUBLIC', language: 'es' },
    });
    expect(es.statusCode).toBe(200);
    expect(es.json().language).toBe('es');
    const de = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un5 Wache', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    expect(de.json().language).toBe('de');
    const list = await app.inject({ method: 'GET', url: '/projects', cookies: { session: owner } });
    const mine = (list.json() as { title: string; language: string }[]).filter((p) => p.title.startsWith('un5 '));
    expect(new Set(mine.map((p) => p.language))).toEqual(new Set(['es', 'de']));
  });

  it('ungültige language wird abgelehnt (400)', async () => {
    const owner = await loginAs('un5-lang-owner2@example.com');
    const bad = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un5 Bad', startDate: at(0), endDate: at(6), language: 'ru' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
```

(Zeit-Helper der Datei heißt evtl. anders als `at` — an die vorhandenen Fixtures anpassen, Assertions unverändert.)

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/routes/projects.test.ts`
Expected: FAIL — `language` ist `undefined` in der Antwort.

- [ ] **Step 3: Schema + Migration**

`prisma/schema.prisma`, `model PrayerProject`, nach der `timezone`-Zeile:

```prisma
  language    String       @default("de") // Sprache der Wache (de|en|es|he|ar) — Listen-Filter (Backlog 5)
```

`prisma/migrations/20260709160000_add_project_language/migration.sql`:

```sql
ALTER TABLE "PrayerProject" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'de';
```

Anwenden per manueller Prozedur (siehe Global Constraints), dann `npx prisma generate && touch src/server.ts`.

- [ ] **Step 4: Schema-Validierung + Routen**

`src/schemas/projects.ts` — Import ergänzen und Feld in `CreateProjectBody` nach `timezone`:

```ts
import { MailLocale } from './auth.js';
```

```ts
  language: MailLocale.default('de'),
```

`src/routes/projects.ts` — im Create-`data`-Block nach `timezone: body.timezone,`:

```ts
        language: body.language,
```

`src/lib/projectView.ts` — im Rückgabe-Objekt nach `timezone: project.timezone,`:

```ts
    language: project.language,
```

- [ ] **Step 5: Tests laufen lassen — grün (komplette Suite)**

Run: `cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/pmi/24pray-api
git add prisma/schema.prisma prisma/migrations/20260709160000_add_project_language/ src/schemas/projects.ts src/routes/projects.ts src/lib/projectView.ts src/routes/projects.test.ts
git commit -m "feat(projects): language-Feld an der Wache (Default de) (Backlog 5)"
```

---

### Task 2: Web — Sprache beim Anlegen mitsenden + Sprach-Filter im Dashboard

**Files:**
- Modify: `/home/pmi/24pray-web/src/types/index.ts:20-39` (PrayerProject-Interface)
- Modify: `/home/pmi/24pray-web/src/app/projects/new/page.tsx:81-97` (Create-Body)
- Modify: `/home/pmi/24pray-web/src/app/dashboard/page.tsx` (Filter-UI + Filterung)
- Modify: `/home/pmi/24pray-web/src/lib/i18n.ts` (Key `filterAllLanguages` in alle 5; Export `LOCALE_NAMES`)
- Test: `/home/pmi/24pray-web/src/app/dashboard/dashboard.test.tsx` (existiert — Muster der Datei nutzen)

**Interfaces:**
- Consumes: `language: string` aus der API (Task 1); `getLocale()` + `Locale` + `SUPPORTED_LOCALES` aus `@/lib/i18n`.
- Produces: `LOCALE_NAMES: Record<Locale, string>` (native Sprachnamen, in i18n.ts exportiert — KEINE 5-fach-Übersetzung, native Namen sind sprachunabhängig).

- [ ] **Step 1: Failing Test schreiben**

In `/home/pmi/24pray-web/src/app/dashboard/dashboard.test.tsx` (bestehende Mock-/Render-Muster der Datei übernehmen — sie mockt `@/lib/api` und `next/navigation`): neues `it`, das zwei Projekte mit `language: 'de'` und `language: 'es'` in den api-Mock legt und prüft:

```tsx
  it('Sprach-Filter zeigt nur Wachen der gewählten Sprache (Backlog 5)', async () => {
    // api-Mock: zwei PUBLIC-Projekte, language de + es (Fixture-Muster der Datei kopieren,
    // Felder title: 'un5 Deutsche Wache' / 'un5 Vigilia Española', language: 'de' / 'es')
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('un5 Deutsche Wache')).toBeTruthy());
    expect(screen.getByText('un5 Vigilia Española')).toBeTruthy();
    // Filter auf Español
    fireEvent.change(screen.getByLabelText(/Sprache|language/i), { target: { value: 'es' } });
    expect(screen.queryByText('un5 Deutsche Wache')).toBeNull();
    expect(screen.getByText('un5 Vigilia Española')).toBeTruthy();
    // zurück auf Alle
    fireEvent.change(screen.getByLabelText(/Sprache|language/i), { target: { value: 'all' } });
    expect(screen.getByText('un5 Deutsche Wache')).toBeTruthy();
  });
```

(Fixture-Objekte exakt nach dem Muster der bestehenden Tests der Datei bauen — nur `language` ergänzen. Assertions unverändert.)

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-web && npx vitest run src/app/dashboard/dashboard.test.tsx`
Expected: FAIL — kein Filter-Element mit Label „Sprache".

- [ ] **Step 3: i18n — Key + native Sprachnamen**

`src/lib/i18n.ts`:

Neuer Key in alle 5 Kataloge (neben passenden Dashboard-Keys wie `openChains` einfügen):

```ts
  // de:
  filterAllLanguages: 'Alle Sprachen',
  // en:
  filterAllLanguages: 'All languages',
  // es:
  filterAllLanguages: 'Todos los idiomas',
  // he:
  filterAllLanguages: 'כל השפות',
  // ar:
  filterAllLanguages: 'كل اللغات',
```

Export am Ende der Datei (bei `SUPPORTED_LOCALES`):

```ts
/** Native Sprachnamen — bewusst NICHT übersetzt (jeder erkennt seine Sprache im Original). */
export const LOCALE_NAMES: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  he: 'עברית',
  ar: 'العربية',
};
```

- [ ] **Step 4: Create-Flow + Typ**

`src/types/index.ts` — im `PrayerProject`-Interface nach `timezone: string;`:

```ts
  language?: string; // Sprache der Wache (de|en|es|he|ar) — Backlog 5; optional für alte API-Antworten
```

`src/app/projects/new/page.tsx` — im `api.post`-Body nach `timezone: tz,`:

```ts
        language: getLocale(), // Wachen-Sprache = UI-Sprache beim Anlegen (Backlog 5), wie tz still erfasst
```

(`getLocale` in den bestehenden `@/lib/i18n`-Import der Datei aufnehmen.)

- [ ] **Step 5: Dashboard-Filter**

`src/app/dashboard/page.tsx`:

Imports ergänzen: `LOCALE_NAMES, SUPPORTED_LOCALES` zu dem bestehenden `t`-Import aus `@/lib/i18n`; `type Locale` falls für den State-Typ gebraucht.

State ergänzen (bei den anderen useState):

```tsx
  const [langFilter, setLangFilter] = useState<string>('all');
```

Gefilterte Liste (nach dem `nextSlot`-useMemo):

```tsx
  const visible = useMemo(() => {
    if (!loaded) return null;
    if (langFilter === 'all') return loaded;
    return loaded.filter(({ project }) => (project.language ?? 'de') === langFilter);
  }, [loaded, langFilter]);
```

Filter-UI — direkt über der `<ul className="space-y-3">` (nur wenn `loaded.length > 1`):

```tsx
          {loaded.length > 1 && (
            <div className="flex items-center justify-end">
              <label htmlFor="langFilter" className="sr-only">{t('filterAllLanguages')}</label>
              <select
                id="langFilter"
                aria-label={t('filterAllLanguages')}
                value={langFilter}
                onChange={(e) => setLangFilter(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
              >
                <option value="all">{t('filterAllLanguages')}</option>
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
                ))}
              </select>
            </div>
          )}
```

und die Listen-Map von `loaded.map(...)` auf `(visible ?? []).map(...)` umstellen; wenn `visible` leer ist (Filter ohne Treffer), statt der Liste einen schlichten Hinweis rendern:

```tsx
          {(visible ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">{t('filterNoMatches')}</p>
          ) : (
            <ul className="space-y-3">
              {(visible ?? []).map(({ project, models }) => (
                <li key={project.id}>
                  <ProjectCard project={project} models={models} />
                </li>
              ))}
            </ul>
          )}
```

Dazu Key `filterNoMatches` in alle 5 Kataloge:

```ts
  // de:
  filterNoMatches: 'Keine Wachen in dieser Sprache.',
  // en:
  filterNoMatches: 'No watches in this language.',
  // es:
  filterNoMatches: 'No hay vigilias en este idioma.',
  // he:
  filterNoMatches: 'אין משמרות בשפה זו.',
  // ar:
  filterNoMatches: 'لا توجد سهرات بهذه اللغة.',
```

(Falls `border-border`/`bg-surface` nicht die Projekt-Konvention sind: per grep an bestehende Selects/Inputs angleichen — z. B. das `Input`-UI-Component.)

- [ ] **Step 6: Suiten laufen lassen — grün**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/pmi/24pray-web
git add src/types/index.ts src/app/projects/new/page.tsx src/app/dashboard/page.tsx src/app/dashboard/dashboard.test.tsx src/lib/i18n.ts
git commit -m "feat(dashboard): Sprach-Filter fuer die Wachen-Liste, Sprache beim Anlegen erfasst (Backlog 5)"
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

Expected: alles grün.

- [ ] **Step 2: Backlog aktualisieren (zwei Änderungen)**

(a) Punkt 5 der Web2-Loops ersetzen durch:

```markdown
5. ~~**Listen-Filter im Dashboard**~~ — GEBAUT 2026-07-09 (Wache bekommt language-Feld beim
   Anlegen, still aus der UI-Sprache wie die Zeitzone; Sprach-Filter über der Liste, native
   Sprachnamen. Sortierung bewusst NICHT geändert — bleibt neueste zuerst, User-Entscheidung.
   Kategorien = spätere Ausbaustufe.)
```

(b) In Punkt 1 (Update-Benachrichtigung) die stale Zeile „DEPLOY AUSSTEHEND — vorher …" korrigieren zu:

```markdown
   Empfänger-Locale wird seitdem bei Login/Buchung erfasst). DEPLOYED 2026-07-09
   (UNSUBSCRIBE_SECRET gesetzt, Migration auf Prod applied). Mail-i18n der ALT-Mails =
   Merkposten unten.
```

- [ ] **Step 3: Commit (nur web, kein Push)**

```bash
cd /home/pmi/24pray-web
git add docs/BACKLOG.md
git commit -m "docs(backlog): Punkt 5 Sprach-Filter gebaut; Punkt-1-Deploy-Status korrigiert"
```
