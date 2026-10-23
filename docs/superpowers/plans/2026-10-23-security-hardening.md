# Security-Hardening 24pray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle Funde aus dem Security-Audit vom 2026-10-23 schließen (API, Web, Deploy, Dependencies).

**Architecture:** Fixes bleiben in den bestehenden Dateien und Mustern: Zod-Schemas validieren, Routen prüfen Rechte über `src/lib/access.ts`, Limits über `@fastify/rate-limit` plus DB-Zähler, wo sie pro Nutzer oder Adresse gelten müssen. Zwei Repos: `24pray-api` (Tasks 1–13, 17, 18, 20) und `24pray-web` (Tasks 6b, 7b, 9b, 14–16, 18, 19). Deploy- und Server-Änderungen (Task 0, 17) sind Ops-Schritte und brauchen vor der Ausführung auf dem Server eine ausdrückliche Freigabe durch den Nutzer.

**Tech Stack:** Fastify 4, Prisma 5 (SQLite), Zod 3, Vitest, nodemailer; Next.js 14 App Router, Vitest + Testing Library; nginx, systemd.

**Spec:** `/home/pmi/24pray-api/docs/specs/2026-10-23-security-audit.md` (Fund-IDs A*, N*, W* beziehen sich darauf).

## Global Constraints

- Jeder Task: zuerst ein fehlschlagender Test, dann der Fix, dann `npm test` grün im betroffenen Repo. Ein Commit pro Task, Message auf Deutsch im bestehenden Stil (`fix(security): …`), mit Attribution-Zeilen laut Session.
- `trustProxy` nie `true`, nur Loopback-Liste `['127.0.0.1', '::1']`.
- Neue Limits nur im **Schreibpfad** erzwingen; Lesepfad muss Bestandsdaten, die ein neues Limit verletzen, weiter ausliefern.
- Keine Antwortform bestehender Endpunkte ändern (Arrays bleiben Arrays), außer der Task nennt Web-Anpassung im selben Deploy.
- Fehlertexte der API auf Deutsch, wie bestehend (`httpError(400, '…')`).
- Neue UI-Texte in allen 5 Locales von `src/lib/i18n.ts` (de, en, es, he, ar).
- Prisma-Migrationen nur über `npm run migrate:dev -- --name <name>`; vorher Skill `24pray-ops` laden (bekannte Stolperfalle „database is locked").
- Produktion (`24pray.org`, `/etc/24pray-api.env`, nginx, cron) wird **nur** in den ausgewiesenen Ops-Schritten und nur nach Freigabe des Nutzers angefasst. SQL auf Prod nur lesend.

## Review Focus

1. **Legitimer Gast auf einer PRIVATE-Wache mit Einladungslink kann nach Task 6 nicht mehr buchen**, wenn API und Web nicht zusammen deployt werden → Test in Task 6 (`books private project with invite in body`) plus Deploy-Reihenfolge unten.
2. **Bestands-Projekte über 366 Tagen oder mit Buchungen außerhalb des Rasters** dürfen beim Lesen nicht 400/500 liefern → Test in Task 5 (`grid of legacy overlong project is clamped, not rejected`) und Bestands-SQL in Task 0.
3. **Hinter nginx hat jeder Client sein eigenes Limit, aber ein gefälschter `X-Forwarded-For` von außen hilft nicht** → beide Tests in Task 1.
4. **Nutzer mit zwei angeforderten Login-Mails** klickt den älteren Link → muss weiter funktionieren (nur Code-Versuche zählen pro Nutzer) → Test in Task 3 (`older magic link still verifies`).
5. **Ein laufender Slot (Start vor wenigen Minuten) ist noch buchbar**, ein vergangener nicht → Test in Task 6 (`allows booking the currently running slot`).

## Deploy-Reihenfolge

1. Task 0 (Backup + Bestands-SQL) auf Prod, **vor** jedem Code-Deploy.
2. `/etc/24pray-api.env` ergänzen (Task 2 Step 7) **vor** dem API-Deploy von Task 2, sonst startet die API nicht.
3. API-Release 1: Tasks 1–5, 8, 10–13. Web-Release 1 gleichzeitig: Tasks 15 (Header-Variante des guestTokens funktioniert, weil API beides akzeptiert), 14, 16.
4. API + Web gemeinsam: Tasks 6/6b, 7/7b, 9/9b.
5. Task 17 (nginx/systemd/cron) nach Freigabe.
6. Task 18 sofort, Tasks 19 und 20 je als eigener Branch und eigenes Release.

## Modellzuordnung

Gilt für subagent-driven-development: `model` beim Agent-Aufruf für Implementierer und Reviewer. Regeln:
- **fable** schreibt den Code, wenn die Logik nebenläufig oder sicherheitskritisch ist und ein Fehler sofort alle Nutzer trifft (Auth, Buchungs-Guard).
- **opus** schreibt Code, der subtil ist, Daten löscht, Produktion am Start hindern kann oder ein Major-Upgrade ist.
- **sonnet** schreibt klar umrissene Fixes, bei denen Signatur und Tests alles festlegen.
- **haiku** übernimmt mechanische Änderungen (Texte, Escape-Zeile, SHA-Pins, `npm audit fix`).
- Reviewer: **fable** für alles mit Auth, Rechten, Datenlöschung oder Prod-Konfiguration, sonst eine Stufe über dem Implementierer.
- Abschluss-Review des ganzen Branches: **fable**.

| Task | Inhalt | Implementierer | Reviewer | Grund |
|---|---|---|---|---|
| 0 | Backup, Bestands-SQL (Ops) | sonnet | opus | Prod-Zugriff, aber nur lesend und ein Skript |
| 1 | trustProxy | opus | fable | Eine Zeile, aber `true` vs. Loopback entscheidet über Spoofing; Test muss Proxy-Pfad wirklich treffen |
| 2 | Env-Härtung | opus | fable | Falsche Refine-Regel = API startet in Prod nicht oder Bypass bleibt offen |
| 3 | Login-Code / Magic-Link-Limits | **fable** | fable | Atomarität, Race-Tests, Migration, Enumeration-Freiheit — höchstes Risiko |
| 4 | Mail-Escaping | sonnet | opus | Mechanisch, aber jede Interpolation muss gefunden werden |
| 5 | Schema-Grenzen, Grid-Deckel | sonnet | opus | Klare Werte; Fallstrick PATCH-Merge vorgegeben |
| 6 | Buchungs-Guard | **fable** | fable | Fünf Prüfungen in fester Reihenfolge, Raster-/Zeitlogik, Zusammenspiel mit Invite und Web |
| 6b | Web: Invite mitsenden | sonnet | opus | Durchreichen über zwei Aufrufer |
| 7 | Invite rotieren, Mitglied entfernen | sonnet | fable | Einfacher Code, aber Rechteprüfung |
| 7b | Web: Button „Link erneuern" | sonnet | opus | UI + i18n |
| 8 | Projekt-Limits, Liste | sonnet | opus | Zwei Queries, Dedupe |
| 9 | maskNames für Nicht-Teilnehmer | opus | fable | Vier Aufrufstellen, Datenschutz, leicht eine zu übersehen |
| 9b | Web: Datenschutztext | haiku | sonnet | Nur Text in 5 Sprachen |
| 10 | Push-Allowlist | sonnet | opus | Host-Suffix-Logik, Testfälle vorgegeben |
| 11 | safeEqual, Header-Tokens | sonnet | opus | Klar umrissen |
| 12 | ICS `\r` (beide Repos) | haiku | sonnet | Eine Zeile je Repo |
| 13 | Aufräumjobs, Opt-out-Löschung | opus | fable | Löscht Produktivdaten — Filter müssen exakt stimmen |
| 14 | Web: Verify per Klick | sonnet | opus | UI-Umbau mit klaren Tests |
| 15 | Web: Header, encodeURIComponent, poweredBy | sonnet | opus | `api.delete` evtl. erweitern |
| 16 | CI-Pins (beide Repos) | haiku | sonnet | Mechanisch |
| 17 | nginx, systemd, Selfcheck | opus | fable | nginx-Vererbung, systemd-Sandbox kann die API brechen |
| 18 | npm audit fix | haiku | sonnet | Mechanisch, Tests entscheiden |
| 19 | Next.js 15.5 | opus | fable | Großes Major-Upgrade, async params überall |
| 20 | Fastify 5, nodemailer | opus | fable | Major-Upgrade, trustProxy-Verhalten muss halten |

---

### Task 0: Konsistentes Backup und Bestandsabfragen (Ops, Prod)

**Files:**
- Modify: `deploy/README.md:235-241` (Backup-Cron)

**Interfaces:**
- Produces: Zahlen für Task 5 (Überlänge) und Task 6 (Raster-Abweichung); konsistentes Backup vor Schema-Änderungen.

- [ ] **Step 1: Backup-Cron in `deploy/README.md` ersetzen**

`cp` durch `umask 077; sqlite3 /opt/24pray/data/24pray.db ".backup '/opt/24pray/backup/24pray-$d.db'"` ersetzen, Backup-Verzeichnis `chmod 700`. `find … -mtime +14 -delete` bleibt.

- [ ] **Step 2: Nach Freigabe auf Prod einspielen und einmal ausführen**

Run (auf dem Server): `/etc/cron.daily/24pray-backup && ls -l /opt/24pray/backup | tail -2`
Expected: neue Datei mit Rechten `-rw-------`.

- [ ] **Step 3: Bestands-SQL lesend ausführen**

```sql
SELECT id, (endDate - startDate)/86400000 AS days FROM PrayerProject ORDER BY days DESC LIMIT 5;
SELECT COUNT(*) FROM PrayerSlot s JOIN PrayerProject p ON p.id = s.projectId
 WHERE (s.startTime - p.startDate) % (p.slotDurationMinutes * 60000) <> 0;
SELECT COUNT(*) FROM PrayerProject WHERE length(title) > 120 OR length(description) > 5000;
```
Ergebnis im Commit-Text von Task 5 und 6 festhalten. Liegt etwas über dem Limit: weitermachen, das Lesen bleibt tolerant (Review Focus 2).

- [ ] **Step 4: Commit** `docs(deploy): Backup per sqlite3 .backup mit umask 077`

---

### Task 1: trustProxy und Rate-Limits pro Client (A1, N6, A12 proxy-addr)

**Files:**
- Modify: `src/app.ts:40`
- Modify: `package.json` (`overrides`)
- Test: `src/routes/auth.test.ts`

**Interfaces:**
- Produces: `req.ip` ist hinter nginx die echte Client-IP. Alle späteren Rate-Limits verlassen sich darauf.

- [ ] **Step 1: Failing tests in `auth.test.ts`**

```ts
it('rate limit gilt pro X-Forwarded-For-Client hinter dem Proxy', async () => {
  const hit = (ip: string) => app.inject({ method: 'POST', url: '/auth/magic-link',
    payload: { email: `rl-${ip}@example.com` }, remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } });
  for (let i = 0; i < 5; i++) expect((await hit('203.0.113.1')).statusCode).not.toBe(429);
  expect((await hit('203.0.113.1')).statusCode).toBe(429);
  expect((await hit('203.0.113.2')).statusCode).not.toBe(429);
});

it('X-Forwarded-For von einem Nicht-Proxy wird ignoriert', async () => {
  const hit = (xff: string) => app.inject({ method: 'POST', url: '/auth/magic-link',
    payload: { email: 'spoof@example.com' }, remoteAddress: '198.51.100.7', headers: { 'x-forwarded-for': xff } });
  for (let i = 0; i < 5; i++) await hit(`10.0.0.${i}`);
  expect((await hit('10.0.0.99')).statusCode).toBe(429);
});
```

- [ ] **Step 2: Run** `npx vitest run src/routes/auth.test.ts` — Expected: der erste Test FAILT (zweite IP bekommt 429).

- [ ] **Step 3: `Fastify({ logger: false, trustProxy: ['127.0.0.1', '::1'] })`** in `src/app.ts:40`; in `package.json` `"overrides": { "proxy-addr": "^2.0.8" }`, dann `npm install`.

- [ ] **Step 4: Run** `npm test` — Expected: PASS. `npm ls proxy-addr` zeigt 2.0.8+.

- [ ] **Step 5: Commit** `fix(security): trustProxy auf Loopback, Rate-Limits pro Client-IP`

---

### Task 2: Env-Härtung — devLoginUrl, Unsubscribe-Secret, Bind-Adresse (A7, A8, N9)

**Files:**
- Modify: `src/env.ts`, `src/routes/auth.ts:44-46`, `src/server.ts:18`, `.env.example`, `Dockerfile`, `deploy/README.md` (Env-Template §~112-117)
- Test: `src/env.test.ts` (neu), `src/routes/auth.test.ts`

**Interfaces:**
- Produces: `env.DEV_LOGIN_RESPONSE: boolean` (Default `false`), `env.HOST: string` (Default `'127.0.0.1'`).

- [ ] **Step 1: Failing tests `src/env.test.ts`**

```ts
const base = { APP_URL: 'http://localhost:3000' };
it('verlangt UNSUBSCRIBE_SECRET >= 32 Zeichen, sobald SMTP_URL gesetzt ist', () => {
  expect(() => parseEnv({ ...base, SMTP_URL: 'smtp://x' })).toThrow();
  expect(() => parseEnv({ ...base, SMTP_URL: 'smtp://x', UNSUBSCRIBE_SECRET: '' })).toThrow();
  expect(() => parseEnv({ ...base, SMTP_URL: 'smtp://x', UNSUBSCRIBE_SECRET: 'a'.repeat(32) })).not.toThrow();
});
it('ohne SMTP bleibt der Dev-Default erlaubt', () => {
  expect(parseEnv(base).UNSUBSCRIBE_SECRET).toBe('dev-unsubscribe-secret');
});
it('DEV_LOGIN_RESPONSE mit COOKIE_SECURE oder https-APP_URL ist ein Startfehler', () => {
  expect(() => parseEnv({ ...base, DEV_LOGIN_RESPONSE: 'true', COOKIE_SECURE: 'true' })).toThrow();
  expect(() => parseEnv({ APP_URL: 'https://24pray.org', DEV_LOGIN_RESPONSE: 'true' })).toThrow();
});
it('HOST ist per Default Loopback', () => { expect(parseEnv(base).HOST).toBe('127.0.0.1'); });
```

In `auth.test.ts`: neuer Test `liefert ohne DEV_LOGIN_RESPONSE keinen devLoginUrl, auch ohne SMTP` (204, Body leer). Der bestehende devLoginUrl-Test (`:34`) bekommt `DEV_LOGIN_RESPONSE: 'true'` in seinem `parseEnv`.

- [ ] **Step 2: Run** `npx vitest run src/env.test.ts src/routes/auth.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementieren**
  - `env.ts`: `DEV_LOGIN_RESPONSE: boolish.default(false)`, `HOST: z.string().default('127.0.0.1')`; `EnvSchema.superRefine` mit den beiden Regeln aus den Tests. Der Default-String `'dev-unsubscribe-secret'` gilt nur, wenn `SMTP_URL` leer ist.
  - `auth.ts:44`: Bedingung `if (env.DEV_LOGIN_RESPONSE)`; Kommentar anpassen.
  - `server.ts:18`: `host: env.HOST`.
  - `Dockerfile`: `ENV HOST=0.0.0.0`, `USER node` vor `CMD` (A11e).
  - `.env.example` und README-Env-Template: `DEV_LOGIN_RESPONSE=true` nur für lokal/E2E dokumentieren; Prod-Template mit Hinweis `UNSUBSCRIBE_SECRET=<openssl rand -hex 32>`.
  - Alle Test-Setups, die `devLoginUrl` brauchen (`grep -rn devLoginUrl src`), setzen `DEV_LOGIN_RESPONSE: 'true'`.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Web prüfen** — `24pray-web/src/app/auth/login/page.tsx` nutzt `devLoginUrl` nur, wenn vorhanden; keine Änderung nötig. In Skill `24pray-ops` / lokaler `.env` des Devs `DEV_LOGIN_RESPONSE=true` ergänzen (Symptom „leere devLoginUrl").

- [ ] **Step 6: Commit** `fix(security): devLoginUrl nur per explizitem Opt-in, Unsubscribe-Secret erzwungen, Bind auf Loopback`

- [ ] **Step 7 (Ops, vor dem Deploy, nach Freigabe):** in `/etc/24pray-api.env` prüfen: `SMTP_URL` gesetzt, `UNSUBSCRIBE_SECRET` vorhanden und ≥ 32 Zeichen. Ist es leer oder der Default, neues Secret setzen. Das macht bereits verschickte Abmeldelinks ungültig; das ist akzeptiert, weil die alten ohnehin fälschbar waren. `DEV_LOGIN_RESPONSE` darf dort nicht stehen.

---

### Task 3: Login-Code-Brute-Force und Magic-Link-Limits pro Adresse (A6, N4, A11a)

**Files:**
- Modify: `src/routes/auth.ts`, `prisma/schema.prisma` (MagicToken), neue Migration `add_magic_token_locale`
- Test: `src/routes/auth.test.ts`

**Interfaces:**
- Consumes: Task 1 (`req.ip` korrekt).
- Produces: `MagicToken.locale String?`; Konstanten `MAX_CODE_ATTEMPTS = 5`, `MAX_LINKS_PER_EMAIL = 3`, Fenster `MAGIC_TTL_MS` (15 min).

- [ ] **Step 1: Failing tests**
  - `Code-Versuche zählen pro Nutzer über alle Tokens`: 3× Magic-Link für dieselbe Adresse (verschiedene XFF-IPs), dann 5 falsche Codes → 6. Versuch mit **richtigem** Code ist 400.
  - `parallele Fehlversuche überschreiten das Limit nicht`: 10 falsche Codes per `Promise.all`, danach `magicToken.codeAttempts`-Summe ≤ 5 und richtiger Code → 400.
  - `mehr als 3 Links pro Adresse in 15 min: still 204, keine Mail`: 4. Request → 204, `captured.length` unverändert.
  - `older magic link still verifies`: zwei Links anfordern, den ersten per `/auth/verify` einlösen → 200.
  - `Magic-Link ändert die Locale erst nach erfolgreichem Login`: User mit `locale: 'de'`, Magic-Link mit `locale: 'en'` → DB weiterhin `de`; nach `/auth/verify` → `en`.

- [ ] **Step 2: Run** `npx vitest run src/routes/auth.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementieren**
  - Schema: `locale String?` an `MagicToken`, Migration erzeugen.
  - `/auth/magic-link`: Upsert setzt `locale` nur noch im `create`. Vor dem Token-Erzeugen: `count` der MagicTokens des Users mit `createdAt > now - MAGIC_TTL_MS`; ≥ `MAX_LINKS_PER_EMAIL` → `reply.code(204).send()` ohne Mail und ohne devLoginUrl (keine Enumeration). Token speichert `locale`.
  - `/auth/verify-code`: Summe `codeAttempts` aller nicht abgelaufenen Tokens des Users (`aggregate _sum`) ≥ `MAX_CODE_ATTEMPTS` → `fail()`. Zusätzlich vor dem Vergleich atomar reservieren: `updateMany({ where: { id: record.id, codeAttempts: { lt: MAX_CODE_ATTEMPTS } }, data: { codeAttempts: { increment: 1 } } })`; bei `count === 0` → `fail()`. Bei richtigem Code den Zähler **nicht** zurücksetzen (Token wird ohnehin konsumiert).
  - `createSession(reply, userId, locale?)`: wenn `locale` gesetzt und vom User abweichend → `user.update`. Beide Verify-Routen reichen `record.locale` durch.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Commit** `fix(security): Login-Code-Versuche pro Nutzer und atomar, Magic-Link-Limit pro Adresse, Locale erst nach Login`

---

### Task 4: HTML-Escaping in allen Mails (A2 Escaping-Teil)

**Files:**
- Modify: `src/lib/mailer.ts` (alle `html:`-Templates)
- Test: `src/lib/mailer.test.ts`

**Interfaces:**
- Consumes: bestehendes `escapeHtml(s: string): string` (`mailer.ts:128`). Wird exportiert, Task 7 braucht es nicht, aber Tests dürfen es importieren.

- [ ] **Step 1: Failing test** `escaped Nutzerwerte in Reminder, Bestätigung, Owner-Notice und Storno-Mails`. Mit dem Fake-Transport aus der bestehenden Testdatei jede `send*`-Methode mit `name`/`guestName`/`bookerName`/`projectTitle` = `'<a href="https://evil">x</a>'` aufrufen; erwarten: `html` enthält `&lt;a href=&quot;https://evil&quot;&gt;` und kein `<a href="https://evil"`. Der `text`-Teil bleibt unverändert roh.

- [ ] **Step 2: Run** `npx vitest run src/lib/mailer.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementieren:** jede Interpolation in einem `html:`-String durch `escapeHtml()` laufen lassen, auch URLs in `href` und Linktext (`projectUrl`, `icsUrl`, `googleUrl` in `calendarBlock`). Nach dem Fix darf `grep -n 'html:' src/lib/mailer.ts` nur noch Interpolationen ohne Nutzerdaten oder mit `escapeHtml(` zeigen.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Commit** `fix(security): Nutzerwerte in allen Mail-Templates HTML-escapen`

---

### Task 5: Schema-Grenzen und Grid-Schutz (A3, N2, N3)

**Files:**
- Modify: `src/schemas/projects.ts`, `src/schemas/slots.ts:8`, `src/routes/projects.ts:65-70,135-150`, `src/lib/slotGrid.ts:35-60`
- Test: `src/routes/projects.test.ts`, `src/lib/slotGrid.test.ts`

**Interfaces:**
- Produces (exportiert aus `src/schemas/projects.ts`): `MAX_PROJECT_DAYS = 366`, `isValidTimezone(tz: string): boolean`, `assertProjectSpan(start: Date, end: Date): void` (wirft `httpError(400, …)`-kompatiblen Fehler mit `statusCode`). Aus `src/lib/slotGrid.ts`: `MAX_GRID_SLOTS = 366 * 24`.

- [ ] **Step 1: Failing tests**
  - projects: `lehnt Projekte über 366 Tage ab (POST)` → 400; `lehnt PATCH ab, das end <= start oder > 366 Tage ergibt` (nur `endDate` patchen, gegen gespeichertes `startDate`) → 400; `lehnt ungültige Zeitzone ab` (`'Mars/Olympus'`) → 400 bei POST und PATCH; `title > 120` und `description > 5000` → 400.
  - slots schema: `guestName` leer nach `trim` oder > 80 Zeichen → 400.
  - slotGrid: `grid of legacy overlong project is clamped, not rejected` — `buildSlotGrid(start, start + 1000 Tage, [], null, 60)` liefert genau `MAX_GRID_SLOTS` Einträge und wirft nicht.

- [ ] **Step 2: Run** `npx vitest run src/routes/projects.test.ts src/lib/slotGrid.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementieren**
  - Schemas: `title: z.string().trim().min(1).max(120)`, `description: z.string().max(5000)`, `timezone: z.string().min(1).refine(isValidTimezone, 'Ungültige Zeitzone')` in Create und Update. `isValidTimezone` per `new Intl.DateTimeFormat('en', { timeZone: tz })` in try/catch.
  - `assertProjectSpan` prüft `end > start` und `end - start <= MAX_PROJECT_DAYS * 86400_000`. Aufruf in POST (ersetzt den Check `:68`) und in PATCH mit den gemergten Werten (`body.startDate ?? existing.startDate`, `body.endDate ?? existing.endDate`), nur wenn eines davon im Body steht.
  - `guestName: z.string().trim().min(1).max(80).optional()`.
  - `buildSlotGrid`: Schleifenende auf `min(end, start + MAX_GRID_SLOTS * slotMs)` begrenzen.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Commit** `fix(security): Projektdauer, Zeitzone und Textlängen begrenzen, Grid gedeckelt` (Ergebnis der Bestands-SQL aus Task 0 in den Commit-Text).

---

### Task 6: Buchungs-Guard (A4, N1, N5, A2 Rate-Limit-Teil)

**Files:**
- Modify: `src/schemas/slots.ts`, `src/routes/slots.ts:73-120,195-236`
- Test: `src/routes/slots.test.ts`

**Interfaces:**
- Consumes: `canReadProject(prisma, project, user, inviteToken?)` aus `src/lib/access.ts`; Task 1.
- Produces: `BookSlotBody.invite?: string`. API akzeptiert den Invite aus Body **oder** Query `?invite=`.

- [ ] **Step 1: Failing tests**
  - `lehnt Buchung in PRIVATE ohne Invite ab` → 404 (wie beim Lesen, kein Existenz-Orakel); `books private project with invite in body` → 200; `… with invite in query` → 200.
  - `lehnt Buchung in PAUSED/ARCHIVED/DRAFT ab` → 409.
  - `lehnt Startzeit neben dem Raster ab` (`startDate + 1 ms`) → 400.
  - `lehnt vergangene Slots ab` (Slot, der vor 2 h endete) → 400; `allows booking the currently running slot` (Start vor 10 min, Stunden-Slot) → 200.
  - `limitiert Buchungen auf 10 pro Minute und IP` → 11. Request 429.
  - recur: `recur nur für BOOKED-Basis in ACTIVE-Projekt` → 409 sonst; `recur legt höchstens 53 Folgetermine an`.

- [ ] **Step 2: Run** `npx vitest run src/routes/slots.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementieren** in `POST /projects/:id/slots`, in dieser Reihenfolge nach dem `findUnique`:
  1. `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`.
  2. `canReadProject(prisma, project, req.user, body.invite ?? InviteQuery.parse(req.query).invite)` false → 404 `Projekt nicht gefunden`.
  3. `project.status !== 'ACTIVE'` → 409 `Diese Gebetswache nimmt gerade keine Buchungen an`.
  4. `(startTime - project.startDate) % slotMs !== 0` → 400 `Ungültiges Zeitfenster`.
  5. `endTime <= now` → 400 `Dieses Zeitfenster liegt in der Vergangenheit`.
  - recur: `base.status === 'BOOKED'` und `base.project.status === 'ACTIVE'`, sonst 409; Schleife zusätzlich mit Zähler `i < 53`.
  - Den Kommentar bei `:138-140` („POST /slots prüft kein canReadProject") entfernen.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Commit** `fix(security): Buchen nur mit Leserecht, aktivem Projekt, auf dem Raster und nicht rückwirkend`

### Task 6b (Web): Invite beim Buchen mitsenden

**Files:**
- Modify: `24pray-web/src/lib/api.ts:69-84`, `src/components/slots/store.ts:107`, `src/components/slots/SlotSheet.tsx:274`
- Test: `24pray-web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: Task 6 (`invite` im Body).
- Produces: `bookSlot(projectId, input: { …; invite?: string })`.

- [ ] **Step 1: Failing test** `bookSlot sendet invite im Body, wenn übergeben` (fetch-Mock, Body enthält `invite: 'tok'`).
- [ ] **Step 2: Run** `npx vitest run src/lib/api.test.ts` — Expected: FAIL.
- [ ] **Step 3:** `invite?: string` in den Input-Typ; beide Aufrufer reichen den Invite aus `useSearchParams().get('invite')` durch. `watch-client.tsx:50` hat ihn schon und gibt ihn an `useSlotGrid` weiter; denselben Weg in den Store und das SlotSheet nehmen.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(security): Einladungstoken beim Buchen privater Wachen mitsenden`

---

### Task 7: Einladungslink erneuern, Mitglied entfernen (A4 Ergänzung)

**Files:**
- Modify: `src/routes/projects.ts`
- Test: `src/routes/projects.test.ts`

**Interfaces:**
- Produces: `POST /projects/:id/invite/rotate` → `{ inviteToken: string }` (nur Organizer, sonst 403); `DELETE /projects/:id/members/:userId` → 204 (nur Organizer; den Organizer selbst entfernen → 400). Entfernt die Membership, Slots bleiben.

- [ ] **Step 1: Failing tests:** Rotate liefert neuen Token, alter `GET /join/<alt>` → 404, neuer → 200; Fremder → 403. Member-Remove: danach `GET /projects/:id` des Ex-Mitglieds auf PRIVATE → 404; Organizer entfernen → 400; Nicht-Organizer → 403.
- [ ] **Step 2: Run** `npx vitest run src/routes/projects.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Beide Routen nach dem Muster der bestehenden Organizer-Routen (PATCH) implementieren; Token über `generateToken()`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(security): Einladungslink erneuern und Mitglieder entfernen`

### Task 7b (Web): Button „Einladungslink erneuern"

**Files:**
- Modify: `24pray-web/src/components/patterns/InviteCard.tsx`, `src/lib/api.ts`, `src/lib/i18n.ts`
- Test: `24pray-web/src/components/patterns/InviteCard.test.tsx` (neu)

**Interfaces:**
- Consumes: Task 7. Produces: `rotateInvite(projectId: string): Promise<{ inviteToken: string }>` in `api.ts`.

- [ ] **Step 1: Failing test:** Klick auf „Link erneuern" → Bestätigungsdialog → nach Bestätigen ruft `rotateInvite` auf und zeigt die neue URL.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** Button nur für den Organizer (die Karte wird schon nur ihm gezeigt). i18n-Keys `inviteRotate` („Link erneuern" / „Renew link"), `inviteRotateConfirm` („Der alte Link funktioniert danach nicht mehr. Bisherige Mitglieder behalten ihren Zugang." / „The old link will stop working. Existing members keep access."), es/he/ar übersetzen.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(security): Einladungslink im Dashboard erneuern`

---

### Task 8: Projekt-Anlage drosseln, Liste begrenzen (A5)

**Files:**
- Modify: `src/routes/projects.ts:52-66`
- Test: `src/routes/projects.test.ts`

**Interfaces:**
- Produces: `MAX_PROJECTS_PER_DAY = 10` pro `organizerId`; `GET /projects` liefert höchstens `PROJECT_LIST_LIMIT = 100` öffentliche plus alle eigenen (Antwort bleibt ein Array).

- [ ] **Step 1: Failing tests:** 11. Projekt eines Users innerhalb 24 h → 429 `Zu viele neue Gebetswachen heute`; `POST /projects` mehr als 5/min pro IP → 429; bei 105 öffentlichen Projekten liefert `GET /projects` anonym 100, eingeloggt zusätzlich die eigenen privaten.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** Rate-Limit `max: 5, timeWindow: '1 minute'`; `count({ where: { organizerId, createdAt: { gt: now - 24h } } })`; Liste als zwei Queries (öffentlich mit `take: 100`, eigene ohne `take`), per `id` dedupliziert, nach `createdAt desc` sortiert.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(security): Projekt-Anlage drosseln, öffentliche Liste auf 100 begrenzen`

---

### Task 9: maskNames auch für Nicht-Teilnehmer (A9)

**Files:**
- Modify: `src/lib/access.ts`, `src/lib/slotGrid.ts:35-57`, `src/routes/slots.ts:62`, `src/routes/community.ts` (Berechnung von `anonymous` vor `:101` und `:207`), `src/lib/projectView.ts:96`
- Test: `src/routes/community.test.ts`, `src/routes/slots.test.ts`

**Interfaces:**
- Produces: `isParticipant(prisma, project, userId: string | null): Promise<boolean>` in `access.ts` (Organizer oder Membership). `buildSlotGrid(start, end, booked, requesterId, slotDurationMinutes, maskNames, viewerIsParticipant: boolean)`: maskiert, wenn `maskNames && !viewerIsParticipant`.

- [ ] **Step 1: Failing tests:** Projekt mit `maskNames: true`, eingeloggter Nicht-Mitglied-User sieht in Grid, Feed (`authorName`), Bestenliste und `organizerName` maskierte Namen; Mitglied und Organizer sehen Klartext.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** In allen vier Stellen `requesterId === null` bzw. `!requesterId` bzw. `anonymous` durch `!viewerIsParticipant` ersetzen; `isParticipant` einmal pro Request aufrufen und durchreichen.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(privacy): maskNames gilt für alle Nicht-Teilnehmer`

### Task 9b (Web): Texte zu maskNames anpassen

**Files:**
- Modify: `24pray-web/src/lib/i18n.ts` (Keys um Zeile 69-70 „für Außenstehende abkürzen" in allen Locales), `src/app/datenschutz/page.tsx:82`
- Test: `24pray-web/src/app/legal.test.tsx`

- [ ] **Step 1: Failing test:** Datenschutzseite enthält „nicht an der Wache teilnehmen" statt „nicht angemeldete Besucher".
- [ ] **Step 2–4:** Text ändern zu „Namen werden für Personen abgekürzt, die nicht an der Wache teilnehmen" (en: „Names are shortened for people who are not part of the watch"); Tests grün.
- [ ] **Step 5: Commit** `docs(privacy): maskNames-Beschreibung an neues Verhalten angepasst`

---

### Task 10: Push-Endpoints auf bekannte Dienste beschränken (A10)

**Files:**
- Modify: `src/routes/push.ts:7-11`
- Test: `src/routes/push.test.ts`

**Interfaces:**
- Produces: `isAllowedPushEndpoint(url: string): boolean` in `src/routes/push.ts` (exportiert für Tests). Erlaubt: `https:` und Host gleich oder endend auf `.` + einem von `fcm.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com`, `push.apple.com`.

- [ ] **Step 1: Failing tests:** `https://fcm.googleapis.com/fcm/send/x`, `https://updates.push.services.mozilla.com/wpush/v2/x`, `https://wns2-par02p.notify.windows.com/w/?token=x`, `https://web.push.apple.com/x` erlaubt; `http://fcm.googleapis.com/x`, `https://127.0.0.1/x`, `https://evil.com/fcm.googleapis.com`, `https://fcm.googleapis.com.evil.com/x` abgelehnt (POST → 400).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** `endpoint: z.string().url().max(1000).refine(isAllowedPushEndpoint, 'Unbekannter Push-Dienst')` in Subscribe; Unsubscribe bleibt unverändert, damit Altbestand abmeldbar ist.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(security): Push-Endpoints nur bei bekannten Push-Diensten`

---

### Task 11: Timing-sichere Secret-Vergleiche, Tokens raus aus Query-Strings (A11c, N8, W4 API-Teil)

**Files:**
- Modify: `src/lib/tokens.ts`, `src/lib/access.ts:17`, `src/routes/slots.ts:241-249`, `src/routes/funnel.ts:38-44`
- Test: `src/lib/tokens.test.ts`, `src/routes/slots.test.ts`, `src/routes/funnel.test.ts`

**Interfaces:**
- Produces: `safeEqual(a: string, b: string): boolean` in `tokens.ts` (SHA-256 beider Seiten, `timingSafeEqual`). Gast-Storno akzeptiert Header `X-Guest-Token` **und** übergangsweise Query `guestToken`. Funnel akzeptiert `Authorization: Bearer <token>` **und** übergangsweise Query.

- [ ] **Step 1: Failing tests:** `safeEqual('a','a')` true, `('a','b')` false, `('a','aa')` false ohne Throw; Gast-Storno per Header → 204; Funnel per Bearer → 200, falscher Bearer → 404.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** `safeEqual` an allen drei Vergleichsstellen einsetzen; Header lesen über `req.headers['x-guest-token']` und `req.headers.authorization?.replace(/^Bearer /, '')`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(security): Secrets timing-sicher vergleichen, Gast- und Funnel-Token per Header`
- [ ] **Step 6:** Query-Varianten in einem späteren Release entfernen (Eintrag in `24pray-web/docs/BACKLOG.md`, Datum frühestens 2 Wochen nach Web-Deploy von Task 15).

---

### Task 12: ICS-Zeilenumbrüche (A11b, W6)

**Files:**
- Modify: `24pray-api/src/lib/calendar.ts:31-33`, `24pray-web/src/lib/time.ts:120`
- Test: `24pray-api/src/lib/calendar.test.ts`, `24pray-web/src/lib/time.test.ts`

- [ ] **Step 1: Failing tests (beide Repos):** Titel `'A\r\nURL:https://evil\rB'` → ICS enthält keine Zeile, die mit `URL:` beginnt, und kein einzelnes `\r` außerhalb der CRLF-Zeilenenden.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** In beiden Escape-Funktionen vor dem `\n`-Ersatz `\r\n` und `\r` zu `\n` normalisieren.
- [ ] **Step 4: Run** `npm test` in beiden Repos — Expected: PASS.
- [ ] **Step 5: Commit** je Repo `fix(security): Wagenrücklauf im ICS-Export escapen`

---

### Task 13: Datenschutz-Aufräumjobs (N4, N10)

**Files:**
- Modify: `src/lib/jobs.ts:90-101` (`cleanupExpired`), `src/routes/me.ts:30-66`
- Test: `src/lib/jobs.test.ts`, `src/routes/me.test.ts`

**Interfaces:**
- Produces: `cleanupExpired` liefert zusätzlich `{ inactiveUsers: number; guestEmails: number }`. Konstanten `INACTIVE_USER_DAYS = 7`, `GUEST_EMAIL_RETENTION_DAYS = 90`.

- [ ] **Step 1: Failing tests:**
  - User ohne `activatedAt`, älter als 7 Tage, ohne Slots, Projekte und Memberships → gelöscht (samt MagicTokens); aktivierter oder jüngerer User bleibt.
  - `guestEmail` von Slots, deren Projekt seit > 90 Tagen beendet ist, wird `null`; laufende Projekte unverändert.
  - `DELETE /me` löscht `UpdateOptOut`-Zeilen mit der E-Mail des Users.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** In `cleanupExpired` zwei `deleteMany`/`updateMany` mit Relation-Filtern (`slots: { none: {} }`, `projects: { none: {} }`, `memberships: { none: {} }`); MagicTokens des Users zuerst löschen oder Cascade im Schema prüfen. In der `DELETE /me`-Transaktion `tx.updateOptOut.deleteMany({ where: { email: user.email.toLowerCase() } })`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(privacy): unbestätigte Konten und alte Gast-Adressen aufräumen, Opt-outs bei Kontolöschung entfernen`

---

### Task 14 (Web): Login-Link nur per Klick einlösen (W3)

**Files:**
- Modify: `24pray-web/src/app/auth/verify/page.tsx:20-60`, `src/lib/i18n.ts`
- Test: `24pray-web/src/app/auth/verify/verify.test.tsx` (neu)

**Interfaces:**
- Consumes: `useAuth()` aus `src/hooks/use-auth.ts` (aktueller User oder null).

- [ ] **Step 1: Failing tests:** Beim Rendern mit `?token=x` wird **kein** `POST /auth/verify` abgesetzt; Klick auf „Jetzt anmelden" sendet ihn; nach dem Klick ist `window.location.search` leer (`history.replaceState`). Ist schon ein User eingeloggt, steht der Hinweis „Du bist bereits als {email} angemeldet." über dem Button.
- [ ] **Step 2: Run** `npx vitest run src/app/auth/verify` — Expected: FAIL.
- [ ] **Step 3:** Token beim Mount in einen State lesen und sofort per `window.history.replaceState(null, '', window.location.pathname)` aus der URL entfernen. Der `useEffect`-Auto-POST wird zum Button-Handler, der `ran`-Guard entfällt. Neue i18n-Keys: `verifyConfirm` („Jetzt anmelden" / „Sign in now"), `verifyAlreadySignedIn` („Du bist bereits als {email} angemeldet. Mit diesem Link meldest du dich mit einem anderen Konto an." / „You are already signed in as {email}. This link signs you in to a different account."), es/he/ar übersetzen.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(security): Login-Link erst nach Klick einlösen, Token aus der URL entfernen`

---

### Task 15 (Web): Gast-Token per Header, Pfadparameter kodieren, X-Powered-By aus (W4, W5, W2 Next-Teil)

**Files:**
- Modify: `24pray-web/src/lib/api.ts:86-90`, `src/app/join/[token]/page.tsx:27`, `src/app/[locale]/projects/[id]/watch-client.tsx:76`, `next.config.mjs`
- Test: `24pray-web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: Task 11 (API akzeptiert `X-Guest-Token`). Muss `api.delete` um optionale Header erweitern, falls das Signatur-Muster in `api.ts` es noch nicht kann.

- [ ] **Step 1: Failing test:** `cancelSlot('s1', 'g')` ruft `DELETE /slots/s1` ohne Query und mit Header `X-Guest-Token: g`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** Header statt Query; `encodeURIComponent(token)` bzw. `encodeURIComponent(id)` an den zwei Pfadstellen; `poweredByHeader: false` in `next.config.mjs`.
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: PASS, Build ohne Fehler.
- [ ] **Step 5: Commit** `fix(security): Gast-Token im Header, Pfadparameter kodiert, X-Powered-By aus`

---

### Task 16: CI härten (W7, beide Repos)

**Files:**
- Modify: `24pray-web/.github/workflows/ci.yml`, `24pray-api/.github/workflows/ci.yml`

- [ ] **Step 1:** Top-level `permissions: { contents: read }` ergänzen.
- [ ] **Step 2:** Jede `uses: owner/action@vN` auf den Commit-SHA des aktuellen Tags pinnen, mit Kommentar `# vN.x.y`. SHA per `gh api repos/<owner>/<action>/git/ref/tags/<tag>` ermitteln (bei annotierten Tags dem `object.url` bis zum Commit folgen).
- [ ] **Step 3: Verify:** Push auf einen Branch, CI läuft grün (`gh run watch`). Bei 403 beim Push: Memory „gh-Konto ohne Push-Rechte" beachten.
- [ ] **Step 4: Commit** je Repo `ci: Token-Rechte minimal, Actions per SHA gepinnt`

---

### Task 17: Deploy-Härtung — nginx, systemd, Docker, Selfcheck (A11d, A11f, A11h, N11, W2)

**Files:**
- Modify: `deploy/nginx.conf`, `deploy/README.md` (nginx-Block ~193-216, systemd-Unit ~137-159), `deploy/24pray-api.service`, `deploy/24pray-selfcheck.sh:45-56`

- [ ] **Step 1: nginx** (`deploy/nginx.conf` und README-Block): im `server`-Block und in **jedem** `location` mit eigenem `add_header` (nginx vererbt sonst nicht):
  ```
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Content-Security-Policy "frame-ancestors 'none'" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  ```
  Dazu `server_tokens off;` und ein `log_format` ohne Query-String (`$request_method $uri $status …` statt `$request`). Für `/join/` den Pfad maskieren: `map $uri $log_uri { ~^/join/ /join/***; default $uri; }`.
- [ ] **Step 2: systemd:** `deploy/24pray-api.service` durch die README-Unit ersetzen (eine Quelle), ergänzt um `ProtectKernelTunables=yes`, `ProtectKernelModules=yes`, `ProtectControlGroups=yes`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `RestrictNamespaces=yes`, `LockPersonality=yes`, `CapabilityBoundingSet=`, `SystemCallFilter=@system-service`, `UMask=0077`. **Kein** `MemoryDenyWriteExecute` (Node-JIT). Für `ExecStartPre` mit Prisma `Environment=npm_config_cache=/opt/24pray/data/.npm` setzen.
- [ ] **Step 3: Selfcheck:** URL per `sys.argv` an `python3 -c` übergeben statt interpolieren; curl-Credentials per `-K -` mit Heredoc (`user = "…:…"`) statt `--user`. Die persönliche Mailadresse aus dem Skript in eine Env-Variable aus `/etc/24pray-api.env` verschieben.
- [ ] **Step 4: Lokal verifizieren:** `bash -n deploy/24pray-selfcheck.sh`; `systemd-analyze verify deploy/24pray-api.service`.
- [ ] **Step 5: Commit** `fix(deploy): Security-Header, Logs ohne Tokens, systemd-Härtung, Selfcheck ohne Passwort-Interpolation`
- [ ] **Step 6 (Ops, nach Freigabe):** auf dem Server einspielen; `nginx -t && systemctl reload nginx`; `systemctl daemon-reload && systemctl restart 24pray-api`; `systemd-analyze security 24pray-api` (Ziel: Exposure < 3.0); `curl -sI https://24pray.org/de` zeigt alle fünf Header und kein Versions-Banner; Login per Magic-Link einmal durchspielen.

---

### Task 18: Abhängigkeiten ohne Major-Sprung (A12, W1 Teil)

**Files:**
- Modify: `package-lock.json` beider Repos

- [ ] **Step 1:** `npm audit fix --omit=dev` in beiden Repos (kein `--force`).
- [ ] **Step 2: Run** `npm test && npm run build` in beiden Repos — Expected: PASS.
- [ ] **Step 3:** `npm audit --omit=dev` — verbleibende Meldungen (next, fastify, nodemailer) im Commit-Text auflisten; die übernehmen Task 19/20.
- [ ] **Step 4: Commit** je Repo `chore(deps): npm audit fix ohne Major-Updates`

---

### Task 19 (Web, eigener Branch): Next.js 15.5 (W1)

**Files:**
- Modify: `24pray-web/package.json`, alle Seiten mit `params`/`searchParams` in Server Components (`src/app/[locale]/**/page.tsx`, `metadata.ts`, `src/app/join/[token]/page.tsx`), `src/middleware.ts` falls APIs sich ändern

- [ ] **Step 1:** `npx @next/codemod@latest upgrade` auf `next@15.5.x` (≥ 15.5.28 laut Advisory), `eslint-config-next` passend. React 18 bleibt, falls 15.5 es noch unterstützt; sonst React 19 und `@testing-library/react` passend.
- [ ] **Step 2:** Async `params`/`searchParams` überall anwenden (Codemod plus Handarbeit), `npx tsc --noEmit` ohne Fehler.
- [ ] **Step 3: Run** `npm test && npm run build` — Expected: PASS.
- [ ] **Step 4:** Dev-Server, alle Hauptwege im Browser (Skill `run` / `24pray-ops`): Landing, Wache ansehen, Gast buchen, Login, Dashboard, Join-Link, Ratgeber.
- [ ] **Step 5:** `npm audit --omit=dev` — keine kritischen oder hohen Meldungen mehr für `next`.
- [ ] **Step 6: Commit** `chore(deps): Next.js 15.5 (Security-Advisories 14.x)`

---

### Task 20 (API, eigener Branch, nach Task 1): Fastify 5 und nodemailer (A12)

**Files:**
- Modify: `24pray-api/package.json`, `src/app.ts`, ggf. Routen mit Typänderungen

- [ ] **Step 1:** `fastify@^5.12`, `@fastify/rate-limit@^10`, `@fastify/cookie@^11`, `@fastify/cors@^10`, `nodemailer` auf aktuelle Major, `@types/nodemailer` passend.
- [ ] **Step 2:** Breaking Changes laut Fastify-v5-Migrationsguide beheben; `npx tsc --noEmit` ohne Fehler.
- [ ] **Step 3: Run** `npm test` — Expected: PASS, insbesondere beide trustProxy-Tests aus Task 1.
- [ ] **Step 4:** `npm audit --omit=dev` — keine kritischen oder hohen Meldungen.
- [ ] **Step 5: Commit** `chore(deps): Fastify 5 und nodemailer-Update (Security-Advisories)`
