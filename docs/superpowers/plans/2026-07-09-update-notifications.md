# Update-Benachrichtigung an Beter (Backlog 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postet der Owner einer Gebetswache ein Update im „Neues"-Tab, bekommen alle Teilnehmer mit E-Mail eine lokalisierte Benachrichtigungs-Mail (5 Sprachen) mit signiertem Abmelde-Link; jedes Update bekommt im Web einen WhatsApp-Share-Button.

**Architecture:** Die API (Fastify/Prisma/SQLite) erhält drei Schema-Erweiterungen (`User.locale`, `PrayerSlot.locale`, neues Modell `UpdateOptOut`), einen neuen Mailer-Typ `sendUpdateNotice` mit eigenem 5-Sprachen-Katalog, einen Fan-out-Hook im bestehenden `POST /projects/:id/requests`-Handler (fire-and-forget, Dedup pro E-Mail, Owner + Opt-outs ausgeschlossen) und einen `GET …/updates/unsubscribe`-Endpoint (HMAC-signiert, ohne Login klickbar). Das Web (Next.js 14) sendet ab jetzt die UI-Sprache bei Login und Buchung mit und rendert pro Update einen `wa.me`-Share-Link.

**Tech Stack:** Fastify + Prisma (SQLite) + zod + nodemailer (API); Next.js 14 + vitest/@testing-library (Web). Keine neuen Dependencies.

## Global Constraints

- Repos: API = `/home/pmi/24pray-api`, Web = `/home/pmi/24pray-web`. Beide sind eigenständige Git-Repos — Commits jeweils im richtigen Repo.
- **Dev-Server nicht killen, NIEMALS `next build` lokal** (zerschießt `.next/`). Build nur auf VPS/CI.
- **Prisma-Migrationen manuell** (Dev-API läuft evtl. → „database is locked"): Migrationsordner von Hand anlegen, SQL per `python3`-sqlite (`timeout=30`) in die Dev-DB spielen, dann `migrate resolve --applied`. Nach `prisma generate`: `touch src/server.ts`.
- Prisma-SQLite-URLs: immer `file:../data/24pray.db` (relativ zu `prisma/`), NIE `file:./data/…`.
- i18n Web: 5 Kataloge (de/en/es/he/ar) sind typvollständig — neuer Key ⇒ in ALLE 5, sonst tsc-Fehler. he/ar = RTL.
- Suiten pro Repo: `npx vitest run` + `npx tsc --noEmit`; Web zusätzlich `npx next lint`.
- Testdaten mit Session-Prefix `un1-` (nur Dev-DB / In-Memory-Test-DB); Live ausschließlich GET.
- TDD: RED zuerst, dann Implementierung. `git pull --rebase` vor Push. **Kein Deploy** — Deploy nur nach separatem Auftrag (UI-Änderung ⇒ Screenshot-Freigabe VOR Deploy).
- Commit-Trailer an jede Commit-Message anhängen:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_011CPPASHZYersFD37Auq5kB`

---

### Task 1: Prisma-Schema — `locale` an User/Slot + Modell `UpdateOptOut`

**Files:**
- Modify: `/home/pmi/24pray-api/prisma/schema.prisma`
- Create: `/home/pmi/24pray-api/prisma/migrations/20260709090000_add_update_notifications/migration.sql`

**Interfaces:**
- Consumes: —
- Produces: Prisma-Felder `User.locale: string`, `PrayerSlot.locale: string` (beide default `'de'`), Modell `UpdateOptOut { id, projectId, email, createdAt }` mit `@@unique([projectId, email])` und Client-Accessor `prisma.updateOptOut` (Unique-Input `projectId_email`). Spätere Tasks verlassen sich exakt auf diese Namen.

- [ ] **Step 1: Schema erweitern**

In `/home/pmi/24pray-api/prisma/schema.prisma`:

`model User` — nach der Zeile `telegramChatId String?` einfügen:

```prisma
  locale         String         @default("de") // UI-Sprache (de|en|es|he|ar) für lokalisierte Mails; bei jedem Login aktualisiert (Backlog 1)
```

`model PrayerProject` — nach der Zeile `requests    PrayerRequest[]` (letzte Zeile des Modells) einfügen:

```prisma
  updateOptOuts UpdateOptOut[]
```

`model PrayerSlot` — nach der Zeile `notifyChannel String        @default("EMAIL") // EMAIL | TELEGRAM` einfügen:

```prisma
  locale        String        @default("de") // UI-Sprache des Buchenden (Gast-Fallback für Update-Mails, Backlog 1)
```

Nach `model PrayerRequest` (vor `model ReminderPreference`) neues Modell:

```prisma
// Update-Mail-Opt-out (Backlog 1): Empfänger (User ODER Gast — nur E-Mail bekannt) hat sich
// per signiertem Abmelde-Link von den Update-Mails EINER Wache abgemeldet. E-Mail lowercased.
model UpdateOptOut {
  id        String        @id @default(cuid())
  projectId String
  project   PrayerProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  email     String
  createdAt DateTime      @default(now())

  @@unique([projectId, email])
}
```

- [ ] **Step 2: Migrationsordner + SQL manuell anlegen** (NICHT `prisma migrate dev` — Dev-API läuft evtl.)

Datei `/home/pmi/24pray-api/prisma/migrations/20260709090000_add_update_notifications/migration.sql`:

```sql
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'de';
ALTER TABLE "PrayerSlot" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'de';
CREATE TABLE "UpdateOptOut" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpdateOptOut_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PrayerProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UpdateOptOut_projectId_email_key" ON "UpdateOptOut"("projectId", "email");
```

- [ ] **Step 3: SQL in die Dev-DB spielen + als applied markieren**

```bash
cd /home/pmi/24pray-api
python3 - <<'EOF'
import sqlite3
sql = open('prisma/migrations/20260709090000_add_update_notifications/migration.sql').read()
con = sqlite3.connect('data/24pray.db', timeout=30)
con.executescript(sql)
con.close()
print('applied')
EOF
DATABASE_URL="file:../data/24pray.db" npx prisma migrate resolve --applied 20260709090000_add_update_notifications
```

Expected: `applied` + „Migration … marked as applied".

- [ ] **Step 4: Client generieren + tsx-watch-Falle entschärfen**

```bash
cd /home/pmi/24pray-api && npx prisma generate && touch src/server.ts
```

- [ ] **Step 5: Verifizieren**

```bash
cd /home/pmi/24pray-api && npx tsc --noEmit && npx vitest run
```

Expected: beide grün (Testhelfer `makeTestDb` spielt alle Migrationsordner ein — der neue läuft dort automatisch mit).

- [ ] **Step 6: Commit**

```bash
cd /home/pmi/24pray-api
git add prisma/schema.prisma prisma/migrations/20260709090000_add_update_notifications/
git commit -m "feat(schema): locale an User/PrayerSlot + UpdateOptOut fuer Update-Mails (Backlog 1)"
```

---

### Task 2: API — Locale bei Login und Buchung erfassen

**Files:**
- Modify: `/home/pmi/24pray-api/src/schemas/auth.ts` (MagicLinkBody)
- Modify: `/home/pmi/24pray-api/src/routes/auth.ts:19-25` (Upsert)
- Modify: `/home/pmi/24pray-api/src/schemas/slots.ts` (BookSlotBody)
- Modify: `/home/pmi/24pray-api/src/routes/slots.ts:99-104` (Slot-Create-Data)
- Test: `/home/pmi/24pray-api/src/routes/auth.test.ts`, `/home/pmi/24pray-api/src/routes/slots.test.ts`

**Interfaces:**
- Consumes: Task-1-Felder `User.locale`, `PrayerSlot.locale`.
- Produces: `POST /auth/magic-link` akzeptiert optional `locale` (`'de'|'en'|'es'|'he'|'ar'`); WENN mitgesendet, wird es am User persistiert (letzte gesendete Sprache gewinnt; ohne Feld bleibt der Bestand unangetastet — wichtig, weil Test-Helfer wie `loginAs` ohne locale posten). `POST /projects/:id/slots` akzeptiert optional `locale` (gleiche Enum, default `'de'`) und persistiert es am Slot.

- [ ] **Step 1: Failing Tests schreiben**

In `/home/pmi/24pray-api/src/routes/auth.test.ts` ans Ende des äußersten `describe` (bzw. als neues `describe` auf Top-Level, gleiche Helfer nutzen wie die bestehenden Tests der Datei):

```ts
describe('Backlog 1 — Locale-Erfassung beim Login', () => {
  it('magic-link persistiert locale am User; erneuter Login aktualisiert sie', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-locale@example.com', locale: 'he' }, remoteAddress: '10.9.0.1' });
    let u = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un1-locale@example.com' } });
    expect(u.locale).toBe('he');
    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-locale@example.com', locale: 'en' }, remoteAddress: '10.9.0.2' });
    u = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un1-locale@example.com' } });
    expect(u.locale).toBe('en');
  });

  it('ohne locale bleibt der Default de', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-default@example.com' }, remoteAddress: '10.9.0.3' });
    const u = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un1-default@example.com' } });
    expect(u.locale).toBe('de');
  });
});
```

(Die Bezeichner `app`/`db` heißen in `auth.test.ts` ggf. anders — an die vorhandenen Datei-Fixtures anpassen, Payloads unverändert lassen.)

In `/home/pmi/24pray-api/src/routes/slots.test.ts` analog ein neues `describe`:

```ts
describe('Backlog 1 — Locale-Erfassung bei Buchung', () => {
  it('Gastbuchung persistiert locale am Slot (default de)', async () => {
    const owner = await loginAs('un1-slotloc-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un1 LocTest', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    const b1 = await app.inject({
      method: 'POST', url: `/projects/${id}/slots`,
      payload: { startTime: at(1), guestName: 'Gast Es', guestEmail: 'un1-es@example.com', locale: 'es' },
    });
    expect(b1.statusCode).toBe(200);
    const s1 = await db.prisma.prayerSlot.findUniqueOrThrow({ where: { id: b1.json().id } });
    expect(s1.locale).toBe('es');
    const b2 = await app.inject({
      method: 'POST', url: `/projects/${id}/slots`,
      payload: { startTime: at(2), guestName: 'Gast De' },
    });
    const s2 = await db.prisma.prayerSlot.findUniqueOrThrow({ where: { id: b2.json().id } });
    expect(s2.locale).toBe('de');
  });
});
```

(Auch hier: `loginAs`/`at`/`app`/`db` an die vorhandenen Fixtures von `slots.test.ts` anpassen.)

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/routes/auth.test.ts src/routes/slots.test.ts`
Expected: FAIL — `locale` ist `de` statt `he`/`es` (Feld wird noch nicht durchgereicht) bzw. zod strippt das Feld.

- [ ] **Step 3: Implementierung**

`/home/pmi/24pray-api/src/schemas/auth.ts` — MagicLinkBody ersetzen:

```ts
export const MailLocale = z.enum(['de', 'en', 'es', 'he', 'ar']);
export const MagicLinkBody = z.object({ email: z.string().email(), locale: MailLocale.optional() });
```

`/home/pmi/24pray-api/src/routes/auth.ts` — im magic-link-Handler:

```ts
    const { email, locale } = MagicLinkBody.parse(req.body);
    const name = email.split('@')[0];
    const user = await prisma.user.upsert({
      where: { email },
      // Nur updaten, wenn der Client eine Sprache mitsendet (letzte gewinnt) —
      // locale-lose Logins (alte Clients, Test-Helfer) dürfen den Bestand nicht auf de zurücksetzen.
      update: locale ? { locale } : {},
      create: { email, name, locale: locale ?? 'de' },
    });
```

`/home/pmi/24pray-api/src/schemas/slots.ts` — BookSlotBody um ein Feld erweitern (Import ergänzen):

```ts
import { MailLocale } from './auth.js';
```

und im Objekt nach `notifyChannel`:

```ts
  locale: MailLocale.default('de'),
```

`/home/pmi/24pray-api/src/routes/slots.ts` — im `prisma.prayerSlot.create`-`data`-Block nach `notifyChannel: body.notifyChannel,`:

```ts
          locale: body.locale,
```

- [ ] **Step 4: Tests laufen lassen — grün**

Run: `cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit`
Expected: PASS (komplette Suite, nicht nur die zwei Dateien).

- [ ] **Step 5: Commit**

```bash
cd /home/pmi/24pray-api
git add src/schemas/auth.ts src/routes/auth.ts src/schemas/slots.ts src/routes/slots.ts src/routes/auth.test.ts src/routes/slots.test.ts
git commit -m "feat(locale): UI-Sprache bei Login und Buchung erfassen (Backlog 1)"
```

---

### Task 3: API — Unsubscribe-Token-Helfer (`src/lib/unsubscribe.ts`)

**Files:**
- Create: `/home/pmi/24pray-api/src/lib/unsubscribe.ts`
- Modify: `/home/pmi/24pray-api/src/env.ts` (UNSUBSCRIBE_SECRET)
- Test: `/home/pmi/24pray-api/src/lib/unsubscribe.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `unsubscribeSig(secret: string, projectId: string, email: string): string` — HMAC-SHA256 base64url über `` `${projectId}:${email.toLowerCase()}` ``
  - `verifyUnsubscribeSig(secret: string, projectId: string, email: string, sig: string): boolean` — timing-safe
  - `unsubscribeUrl(appUrl: string, secret: string, projectId: string, email: string, locale: string): string` — `${appUrl}/api/projects/${projectId}/updates/unsubscribe?email=…&sig=…&locale=…` (gleiche `${APP_URL}/api/…`-Konvention wie die ics-Links in `slots.ts`)
  - `env.UNSUBSCRIBE_SECRET: string` (default `'dev-unsubscribe-secret'`)

- [ ] **Step 1: Failing Test schreiben**

`/home/pmi/24pray-api/src/lib/unsubscribe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { unsubscribeSig, verifyUnsubscribeSig, unsubscribeUrl } from './unsubscribe.js';

describe('unsubscribe token (Backlog 1)', () => {
  const S = 'test-secret';

  it('Signatur ist stabil und case-insensitiv zur E-Mail', () => {
    const a = unsubscribeSig(S, 'p1', 'Maria@Example.com');
    const b = unsubscribeSig(S, 'p1', 'maria@example.com');
    expect(a).toBe(b);
    expect(verifyUnsubscribeSig(S, 'p1', 'maria@example.com', a)).toBe(true);
  });

  it('manipulierte Signatur / falsches Projekt / falscher Secret werden abgelehnt', () => {
    const sig = unsubscribeSig(S, 'p1', 'x@y.z');
    expect(verifyUnsubscribeSig(S, 'p2', 'x@y.z', sig)).toBe(false);
    expect(verifyUnsubscribeSig(S, 'p1', 'x@y.z', sig.slice(0, -2) + 'aa')).toBe(false);
    expect(verifyUnsubscribeSig('anders', 'p1', 'x@y.z', sig)).toBe(false);
    expect(verifyUnsubscribeSig(S, 'p1', 'x@y.z', 'kaputt')).toBe(false);
  });

  it('unsubscribeUrl baut den API-Pfad mit encodeter E-Mail', () => {
    const url = unsubscribeUrl('https://24pray.org', S, 'p1', 'a+b@example.com', 'en');
    expect(url).toContain('https://24pray.org/api/projects/p1/updates/unsubscribe?');
    expect(url).toContain('a%2Bb%40example.com');
    expect(url).toContain('locale=en');
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/lib/unsubscribe.test.ts`
Expected: FAIL — Modul `./unsubscribe.js` existiert nicht.

- [ ] **Step 3: Implementierung**

`/home/pmi/24pray-api/src/lib/unsubscribe.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-Signatur für den login-freien Abmelde-Link (Backlog 1).
 *  Bindet Projekt + E-Mail (lowercased) — der Link kann nur die eigene Adresse abmelden. */
export function unsubscribeSig(secret: string, projectId: string, email: string): string {
  return createHmac('sha256', secret).update(`${projectId}:${email.toLowerCase()}`).digest('base64url');
}

export function verifyUnsubscribeSig(secret: string, projectId: string, email: string, sig: string): boolean {
  const expected = Buffer.from(unsubscribeSig(secret, projectId, email));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Absolute Abmelde-URL für Mail-Footer — gleiche `${APP_URL}/api/…`-Konvention wie die ics-Links. */
export function unsubscribeUrl(appUrl: string, secret: string, projectId: string, email: string, locale: string): string {
  const q = new URLSearchParams({ email, sig: unsubscribeSig(secret, projectId, email), locale });
  return `${appUrl}/api/projects/${projectId}/updates/unsubscribe?${q.toString()}`;
}
```

`/home/pmi/24pray-api/src/env.ts` — im EnvSchema nach `SMTP_FROM`:

```ts
  // Signiert die Abmelde-Links der Update-Mails (Backlog 1). In Produktion setzen!
  UNSUBSCRIBE_SECRET: z.string().default('dev-unsubscribe-secret'),
```

- [ ] **Step 4: Tests laufen lassen — grün**

Run: `cd /home/pmi/24pray-api && npx vitest run src/lib/unsubscribe.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/pmi/24pray-api
git add src/lib/unsubscribe.ts src/lib/unsubscribe.test.ts src/env.ts
git commit -m "feat(unsubscribe): HMAC-signierte Abmelde-Links fuer Update-Mails (Backlog 1)"
```

---

### Task 4: API — `sendUpdateNotice` im Mailer (lokalisiert, 5 Sprachen)

**Files:**
- Modify: `/home/pmi/24pray-api/src/lib/mailer.ts`
- Test: `/home/pmi/24pray-api/src/lib/mailer.test.ts`

**Interfaces:**
- Consumes: —
- Produces:

```ts
export interface UpdateNoticeMail {
  projectTitle: string;
  authorName: string;
  text: string;          // Update-Text des Owners (bis 1000 Zeichen, User-Content!)
  projectUrl: string;    // Deep-Link zur Wache (PRIVATE: mit ?invite=)
  unsubscribeUrl: string;
  locale: string;        // de|en|es|he|ar; Unbekanntes fällt auf de zurück
}
// Mailer-Interface: sendUpdateNotice?(email: string, notice: UpdateNoticeMail): Promise<void>
```

- [ ] **Step 1: Failing Test schreiben**

In `/home/pmi/24pray-api/src/lib/mailer.test.ts` neues `describe` (Muster der Datei: Dev-Mailer + console.log-Spy):

```ts
describe('sendUpdateNotice (Backlog 1)', () => {
  it('Dev-Mailer loggt Empfänger, Titel und Locale', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendUpdateNotice!('un1-x@y.z', {
      projectTitle: 'Wache Lena', authorName: 'Ruth', text: 'Es geht ihr besser!',
      projectUrl: 'http://app/projects/p1', unsubscribeUrl: 'http://app/api/unsub', locale: 'en',
    });
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('un1-x@y.z');
    expect(logged).toContain('Wache Lena');
    expect(logged).toContain('en');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/lib/mailer.test.ts`
Expected: FAIL — `sendUpdateNotice` ist undefined.

- [ ] **Step 3: Implementierung**

In `/home/pmi/24pray-api/src/lib/mailer.ts`:

Nach `ProjectFarewellMail` das neue Interface + der Sprachkatalog:

```ts
/** Owner-Update im „Neues"-Tab → Mail an alle Teilnehmer (Backlog 1). */
export interface UpdateNoticeMail {
  projectTitle: string;
  authorName: string;
  text: string; // Update-Text (User-Content — im HTML escapen!)
  projectUrl: string;
  unsubscribeUrl: string;
  locale: string; // de|en|es|he|ar; Unbekanntes → de
}

// Einzige lokalisierte Mail (Entscheidung 2026-07-09): Empfänger-Locale wird seit Backlog 1
// erfasst; die Alt-Mails bleiben vorerst deutsch (separater Backlog-Punkt).
// he/ar: Muttersprachler-Review steht noch aus (Backlog-Merkposten).
const UPDATE_NOTICE_TEXTS: Record<string, {
  subject: (title: string) => string;
  posted: (author: string) => string;
  toWatch: string;
  unsubscribe: string;
  dir: 'ltr' | 'rtl';
}> = {
  de: { subject: (t) => `24pray — Neues aus der Gebetswache (${t})`, posted: (a) => `${a} hat ein Update zum Anliegen gepostet:`, toWatch: 'Zur Gebetswache', unsubscribe: 'Keine Update-Mails mehr für diese Wache', dir: 'ltr' },
  en: { subject: (t) => `24pray — news from the prayer watch (${t})`, posted: (a) => `${a} posted an update on the concern:`, toWatch: 'Open the prayer watch', unsubscribe: 'Stop update emails for this watch', dir: 'ltr' },
  es: { subject: (t) => `24pray — novedades de la vigilia de oración (${t})`, posted: (a) => `${a} publicó una novedad sobre la intención:`, toWatch: 'Ir a la vigilia de oración', unsubscribe: 'No recibir más correos de novedades de esta vigilia', dir: 'ltr' },
  he: { subject: (t) => `24pray — חדש ממשמרת התפילה (${t})`, posted: (a) => `${a} פרסם/ה עדכון על הבקשה:`, toWatch: 'למשמרת התפילה', unsubscribe: 'להפסקת מיילי עדכונים עבור משמרת זו', dir: 'rtl' },
  ar: { subject: (t) => `24pray — جديد من سهرة الصلاة (${t})`, posted: (a) => `نشر ${a} تحديثًا حول الطلب:`, toWatch: 'إلى سهرة الصلاة', unsubscribe: 'إيقاف رسائل التحديثات لهذه السهرة', dir: 'rtl' },
};

/** Minimal-Escaping für User-Content in Mail-HTML (Update-Text, Autor-Name). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

Im `Mailer`-Interface nach `sendProjectFarewell`:

```ts
  sendUpdateNotice?(email: string, notice: UpdateNoticeMail): Promise<void>;
```

Im Dev-Mailer-Objekt (`if (!config.smtpUrl)`-Zweig) nach `sendProjectFarewell`:

```ts
      async sendUpdateNotice(email, n) {
        console.log(`[mailer:dev] update notice for ${email}: ${n.projectTitle} (${n.locale})`);
      },
```

Im Transport-Mailer-Objekt nach `sendProjectFarewell`:

```ts
    async sendUpdateNotice(email, n) {
      const tr = UPDATE_NOTICE_TEXTS[n.locale] ?? UPDATE_NOTICE_TEXTS.de;
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: tr.subject(n.projectTitle),
        text: `${tr.posted(n.authorName)}\n\n${n.text}\n\n${tr.toWatch}: ${n.projectUrl}\n\n${tr.unsubscribe}: ${n.unsubscribeUrl}`,
        html: `<div dir="${tr.dir}"><p>${tr.posted(escapeHtml(n.authorName))}</p>` +
          `<blockquote style="margin:0;padding-inline-start:12px;border-inline-start:3px solid #ccc;white-space:pre-wrap">${escapeHtml(n.text)}</blockquote>` +
          `<p><a href="${n.projectUrl}">${tr.toWatch}</a></p>` +
          `<p style="font-size:12px;color:#888"><a href="${n.unsubscribeUrl}">${tr.unsubscribe}</a></p></div>`,
      });
    },
```

- [ ] **Step 4: Tests laufen lassen — grün**

Run: `cd /home/pmi/24pray-api && npx vitest run src/lib/mailer.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/pmi/24pray-api
git add src/lib/mailer.ts src/lib/mailer.test.ts
git commit -m "feat(mailer): sendUpdateNotice lokalisiert in 5 Sprachen (Backlog 1)"
```

---

### Task 5: API — Fan-out beim Owner-Update + Unsubscribe-Endpoint

**Files:**
- Modify: `/home/pmi/24pray-api/src/routes/community.ts`
- Modify: `/home/pmi/24pray-api/src/app.ts:63` (mailer in die Deps)
- Test: `/home/pmi/24pray-api/src/routes/community.test.ts`

**Interfaces:**
- Consumes: `sendUpdateNotice`/`UpdateNoticeMail` (Task 4), `unsubscribeSig`/`verifyUnsubscribeSig`/`unsubscribeUrl` (Task 3), `prisma.updateOptOut` + `PrayerSlot.locale`/`User.locale` (Task 1), `Env.UNSUBSCRIBE_SECRET` (Task 3).
- Produces: `POST /projects/:id/requests` verschickt fire-and-forget Update-Mails (Dedup pro E-Mail lowercased, Owner + Opt-outs raus). Neuer Endpoint `GET /projects/:id/updates/unsubscribe?email&sig&locale` → HTML-Bestätigung, legt `UpdateOptOut` idempotent an. `communityRoutes`-Deps heißen jetzt `{ prisma, mailer?, env }` mit `env: Env` (voller Env-Typ, nicht mehr nur `STATS_CACHE_TTL_MS`).

- [ ] **Step 1: Failing Tests schreiben**

In `/home/pmi/24pray-api/src/routes/community.test.ts`:

Oben bei den Capture-Arrays ergänzen:

```ts
import type { ReminderMail, UpdateNoticeMail } from '../lib/mailer.js';
const updates: { email: string; n: UpdateNoticeMail }[] = [];
```

Im Fake-Mailer des `buildApp` in `beforeAll`:

```ts
      async sendUpdateNotice(email, n) { updates.push({ email, n }); },
```

Neues `describe` am Dateiende:

```ts
describe('Backlog 1 — Update-Benachrichtigung', () => {
  async function setupProjectWithParticipants() {
    updates.length = 0;
    const owner = await loginAs('un1-up-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un1 UpdateTest', startDate: at(0), endDate: at(12), visibility: 'PUBLIC' },
    });
    const id = res.json().id as string;
    // Teilnehmer 1: eingeloggter User (locale en), bucht ZWEI Slots (Dedup-Probe)
    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-up-member@example.com', locale: 'en' }, remoteAddress: '10.8.0.9' });
    const member = await loginAs('un1-up-member@example.com');
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`, cookies: { session: member }, payload: { startTime: at(1) } });
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`, cookies: { session: member }, payload: { startTime: at(2) } });
    // Teilnehmer 2: Gast mit E-Mail (locale es)
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`,
      payload: { startTime: at(3), guestName: 'Gast Es', guestEmail: 'un1-up-guest@example.com', locale: 'es' } });
    // Teilnehmer 3: Gast OHNE E-Mail (bekommt nichts, crasht nichts)
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`,
      payload: { startTime: at(4), guestName: 'Gast Ohne' } });
    // Owner bucht selbst eine Stunde (darf sich NICHT selbst benachrichtigen)
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`, cookies: { session: owner }, payload: { startTime: at(5) } });
    return { id, owner };
  }

  it('Owner-Update mailt Teilnehmer dedupliziert und lokalisiert, ohne Owner', async () => {
    const { id, owner } = await setupProjectWithParticipants();
    const post = await app.inject({
      method: 'POST', url: `/projects/${id}/requests`, cookies: { session: owner },
      payload: { text: 'Neuigkeiten: es geht voran!' },
    });
    expect(post.statusCode).toBe(200);
    await vi.waitFor(() => expect(updates.length).toBe(2)); // Fan-out ist fire-and-forget
    const byEmail = new Map(updates.map((u) => [u.email, u.n]));
    expect(byEmail.has('un1-up-member@example.com')).toBe(true);
    expect(byEmail.has('un1-up-guest@example.com')).toBe(true);
    expect(byEmail.get('un1-up-member@example.com')!.locale).toBe('en');
    expect(byEmail.get('un1-up-guest@example.com')!.locale).toBe('es');
    expect(byEmail.get('un1-up-guest@example.com')!.text).toBe('Neuigkeiten: es geht voran!');
    expect(byEmail.get('un1-up-guest@example.com')!.unsubscribeUrl).toContain(`/api/projects/${id}/updates/unsubscribe?`);
  });

  it('Unsubscribe-Link legt Opt-out an (idempotent), falsche Signatur 403, Folge-Update spart den Abgemeldeten aus', async () => {
    const { id, owner } = await setupProjectWithParticipants();
    const { unsubscribeSig } = await import('../lib/unsubscribe.js');
    const sig = unsubscribeSig('dev-unsubscribe-secret', id, 'un1-up-guest@example.com');
    const bad = await app.inject({ method: 'GET',
      url: `/projects/${id}/updates/unsubscribe?email=${encodeURIComponent('un1-up-guest@example.com')}&sig=falsch&locale=es` });
    expect(bad.statusCode).toBe(403);
    for (let i = 0; i < 2; i++) { // idempotent
      const ok = await app.inject({ method: 'GET',
        url: `/projects/${id}/updates/unsubscribe?email=${encodeURIComponent('un1-up-guest@example.com')}&sig=${sig}&locale=es` });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['content-type']).toContain('text/html');
    }
    const rows = await db.prisma.updateOptOut.findMany({ where: { projectId: id } });
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe('un1-up-guest@example.com');

    updates.length = 0;
    await app.inject({ method: 'POST', url: `/projects/${id}/requests`, cookies: { session: owner },
      payload: { text: 'Zweites Update.' } });
    await vi.waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0].email).toBe('un1-up-member@example.com');
  });
});
```

`vi` in den vitest-Import der Datei aufnehmen, falls noch nicht importiert. Falls das Test-Env in `beforeAll` (`parseEnv({ APP_URL: …, STATS_CACHE_TTL_MS: '0' })`) keinen `UNSUBSCRIBE_SECRET` setzt, gilt der Default `dev-unsubscribe-secret` — der Test verlässt sich darauf.

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/routes/community.test.ts`
Expected: FAIL — `updates.length` bleibt 0 bzw. Unsubscribe-Route 404.

- [ ] **Step 3: Implementierung**

`/home/pmi/24pray-api/src/app.ts` Zeile 63:

```ts
  communityRoutes(app, { prisma, mailer, env });
```

`/home/pmi/24pray-api/src/routes/community.ts`:

Imports ergänzen:

```ts
import type { Env } from '../env.js';
import type { Mailer, UpdateNoticeMail } from '../lib/mailer.js';
import { unsubscribeUrl, verifyUnsubscribeSig } from '../lib/unsubscribe.js';
```

Signatur + Destructuring ändern (voller Env-Typ; `STATS_CACHE_TTL_MS`-Nutzung bleibt unverändert, da im Env-Typ enthalten):

```ts
export function communityRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; mailer?: Mailer; env?: Env }) {
  const { prisma, mailer, env } = deps;
```

Achtung: Der bestehende Aufruf `env?.STATS_CACHE_TTL_MS ?? 0` in `/stats/public` funktioniert mit dem neuen Typ unverändert.

Empfänger-Sammlung als Modul-Helfer über `communityRoutes` einfügen:

```ts
/** Alle Update-Empfänger einer Wache: jede Person, die je eine Stunde gehalten oder gebucht hat
 *  (BOOKED + COMPLETED — wer mitgebetet hat, will vom Ausgang hören), dedupliziert pro E-Mail,
 *  ohne Opt-outs und ohne den Owner selbst. Locale: User-Präferenz, für Gäste die Buchungs-Sprache. */
interface UpdateRecipient { email: string; name: string; locale: string }

async function collectUpdateRecipients(
  prisma: PrismaClient,
  projectId: string,
  excludeEmail: string | null,
): Promise<UpdateRecipient[]> {
  const [slots, optOuts] = await Promise.all([
    prisma.prayerSlot.findMany({
      where: { projectId, status: { in: ['BOOKED', 'COMPLETED'] } },
      include: { user: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.updateOptOut.findMany({ where: { projectId } }),
  ]);
  const suppressed = new Set(optOuts.map((o) => o.email.toLowerCase()));
  if (excludeEmail) suppressed.add(excludeEmail.toLowerCase());
  const byEmail = new Map<string, UpdateRecipient>();
  for (const s of slots) {
    const email = s.user?.email ?? s.guestEmail;
    if (!email) continue; // Gast ohne E-Mail: kein Kanal
    const key = email.toLowerCase();
    if (suppressed.has(key) || byEmail.has(key)) continue;
    byEmail.set(key, { email, name: s.user?.name ?? s.guestName ?? '', locale: s.user?.locale ?? s.locale });
  }
  return [...byEmail.values()];
}
```

Im `POST /projects/:id/requests`-Handler nach `prisma.prayerRequest.create` (vor dem `return`):

```ts
    // Fan-out (Backlog 1): fire-and-forget — die Antwort auf den Post wartet nie auf SMTP.
    if (mailer?.sendUpdateNotice && env) {
      const mail = mailer.sendUpdateNotice.bind(mailer);
      void (async () => {
        const organizer = await prisma.user.findUniqueOrThrow({
          where: { id: project.organizerId }, select: { email: true },
        });
        const recipients = await collectUpdateRecipients(prisma, project.id, organizer.email);
        const invite = project.visibility === 'PRIVATE' ? `?invite=${project.inviteToken}` : '';
        const projectUrl = `${env.APP_URL}/projects/${project.id}${invite}`;
        for (const r of recipients) {
          const notice: UpdateNoticeMail = {
            projectTitle: project.title,
            authorName,
            text: body.text,
            projectUrl,
            unsubscribeUrl: unsubscribeUrl(env.APP_URL, env.UNSUBSCRIBE_SECRET, project.id, r.email, r.locale),
            locale: r.locale,
          };
          await mail(r.email, notice).catch((err) => console.error(`[mail] update notice failed for ${r.email}:`, err));
        }
      })().catch((err) => console.error('[mail] update fan-out failed:', err));
    }
```

Unsubscribe-Endpoint + Query-Schema + Bestätigungstexte (nach dem `POST /requests`-Block einfügen):

```ts
const UnsubscribeQuery = z.object({
  email: z.string().email(),
  sig: z.string().min(10),
  locale: z.string().optional(),
});

// Bestätigungsseite in der Sprache der Mail, aus der geklickt wurde.
const UNSUB_CONFIRM: Record<string, { lang: string; dir: string; title: string; body: string }> = {
  de: { lang: 'de', dir: 'ltr', title: 'Abgemeldet', body: 'Du bekommst keine Update-Mails mehr zu dieser Gebetswache.' },
  en: { lang: 'en', dir: 'ltr', title: 'Unsubscribed', body: 'You will no longer receive update emails for this prayer watch.' },
  es: { lang: 'es', dir: 'ltr', title: 'Baja confirmada', body: 'Ya no recibirás correos de novedades de esta vigilia de oración.' },
  he: { lang: 'he', dir: 'rtl', title: 'הוסרת מהרשימה', body: 'לא תקבל/י עוד מיילים עם עדכונים עבור משמרת תפילה זו.' },
  ar: { lang: 'ar', dir: 'rtl', title: 'تم إلغاء الاشتراك', body: 'لن تصلك بعد الآن رسائل التحديثات لسهرة الصلاة هذه.' },
};
```

und im Routen-Body von `communityRoutes`:

```ts
  // Abmelde-Link aus der Update-Mail (Backlog 1): login-frei, HMAC-signiert, idempotent.
  app.get('/projects/:id/updates/unsubscribe', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { email, sig, locale } = UnsubscribeQuery.parse(req.query);
    if (!env) throw httpError(500, 'Serverfehler');
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    if (!verifyUnsubscribeSig(env.UNSUBSCRIBE_SECRET, id, email, sig)) {
      throw httpError(403, 'Ungültiger Abmeldelink');
    }
    await prisma.updateOptOut.upsert({
      where: { projectId_email: { projectId: id, email: email.toLowerCase() } },
      update: {},
      create: { projectId: id, email: email.toLowerCase() },
    });
    const c = UNSUB_CONFIRM[locale ?? ''] ?? UNSUB_CONFIRM.de;
    reply.type('text/html; charset=utf-8');
    return `<!doctype html><html lang="${c.lang}" dir="${c.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.title} — 24pray</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center"><h1 style="font-size:1.3rem">${c.title}</h1><p>${c.body}</p></body></html>`;
  });
```

- [ ] **Step 4: Tests laufen lassen — grün**

Run: `cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit`
Expected: PASS (komplette Suite — auch projects/slots/auth dürfen nicht regressieren).

- [ ] **Step 5: Commit**

```bash
cd /home/pmi/24pray-api
git add src/routes/community.ts src/routes/community.test.ts src/app.ts
git commit -m "feat(updates): Update-Mail-Fanout an Teilnehmer + Unsubscribe-Endpoint (Backlog 1)"
```

---

### Task 6: Web — UI-Sprache bei Login und Buchung mitsenden

**Files:**
- Modify: `/home/pmi/24pray-web/src/lib/api.ts:68-82` (bookSlot)
- Modify: `/home/pmi/24pray-web/src/app/auth/login/page.tsx:47` (magic-link)
- Test: bestehende Suiten (`api.test.ts`, `login.test.tsx`) — Erwartungen anpassen, falls sie Payloads exakt asserten

**Interfaces:**
- Consumes: `getLocale(): Locale` aus `@/lib/i18n` (existiert, Zeile 1403); API akzeptiert `locale` seit Task 2.
- Produces: `bookSlot` und der magic-link-POST senden `locale` mit.

- [ ] **Step 1: bookSlot erweitern**

In `/home/pmi/24pray-web/src/lib/api.ts` — beim Import-Block von `@/types` (Zeile 59) zusätzlich:

```ts
import { getLocale } from '@/lib/i18n';
```

und im `bookSlot`-Body:

```ts
  return api.post<PrayerSlot>(`/projects/${projectId}/slots`, {
    ...input,
    notifyChannel: 'EMAIL',
    locale: getLocale(), // Gast-Update-Mails in der UI-Sprache der Buchung (Backlog 1)
  });
```

- [ ] **Step 2: Login erweitern**

In `/home/pmi/24pray-web/src/app/auth/login/page.tsx` Zeile 47:

```ts
      const res = await api.post<{ devLoginUrl?: string }>('/auth/magic-link', { email, locale: getLocale() });
```

`getLocale` in den bestehenden `@/lib/i18n`-Import der Datei aufnehmen (die Datei importiert `t` bereits von dort).

- [ ] **Step 3: Suiten laufen lassen; exakte Payload-Assertions anpassen**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS. Falls `api.test.ts` oder `login.test.tsx` den POST-Payload exakt asserten (`toEqual`), dort `locale: 'de'` (Test-Default) ergänzen — NICHT die Assertions aufweichen (`objectContaining` nur, wenn die Datei das Muster schon nutzt).

- [ ] **Step 4: Commit**

```bash
cd /home/pmi/24pray-web
git add src/lib/api.ts src/app/auth/login/page.tsx
git commit -m "feat(locale): UI-Sprache bei Login und Buchung an die API mitsenden (Backlog 1)"
```

(Bei angepassten Tests: die Testdateien mit in den Commit.)

---

### Task 7: Web — Share-Aktionen pro Update: WhatsApp, Telegram, Signal/System-Share

**Files:**
- Modify: `/home/pmi/24pray-web/src/components/slots/RequestsFeed.tsx`
- Modify: `/home/pmi/24pray-web/src/lib/i18n.ts` (Keys in ALLE 5 Kataloge)
- Test: `/home/pmi/24pray-web/src/components/slots/RequestsFeed.test.tsx`

**Interfaces:**
- Consumes: bestehende Props `projectId`, `invite` von `RequestsFeed`; i18n-`t()`; Toast-Muster aus `ShareButton.tsx` (`toast` aus `@/components/ui/toast-store`).
- Produces: pro Update-`<li>` eine Share-Zeile mit drei Aktionen (User-Vorgabe: WhatsApp + Telegram + Signal IMMER berücksichtigen):
  - `<a>` WhatsApp: `https://wa.me/?text=<Text + Wachen-URL>`
  - `<a>` Telegram: `https://t.me/share/url?url=<Wachen-URL>&text=<Text>` (offizieller Telegram-Share-Intent)
  - `<button>` System-Share: Signal hat KEINEN Text-Share-Deep-Link — Signal läuft über den System-Share-Sheet (`navigator.share`, dort erscheint Signal) mit Clipboard-Fallback + Toast, exakt das Muster von `ShareButton.tsx`.
  - Neue i18n-Keys: `shareUpdateWhatsapp`, `shareUpdateTelegram`, `shareUpdateOther`.

- [ ] **Step 1: Failing Test schreiben**

In `/home/pmi/24pray-web/src/components/slots/RequestsFeed.test.tsx` neue `it`s im bestehenden `describe`:

```tsx
  it('jedes Update hat WhatsApp- und Telegram-Share-Links mit Text + Wachen-URL', async () => {
    render(<RequestsFeed projectId="p1" projectTz="UTC" isLoggedIn={false} isOrganizer={false} />);
    await waitFor(() => expect(screen.getByText(/Lena geht es besser/)).toBeTruthy());
    const wa = screen.getByRole('link', { name: /whatsapp/i }) as HTMLAnchorElement;
    expect(wa.href).toContain('https://wa.me/?text=');
    const waText = decodeURIComponent(wa.href.split('text=')[1]);
    expect(waText).toContain('Update: Lena geht es besser!');
    expect(waText).toContain('/projects/p1');
    expect(wa.target).toBe('_blank');
    const tg = screen.getByRole('link', { name: /telegram/i }) as HTMLAnchorElement;
    expect(tg.href).toContain('https://t.me/share/url?');
    expect(decodeURIComponent(tg.href)).toContain('/projects/p1');
    expect(tg.target).toBe('_blank');
  });

  it('System-Share-Button (Signal & mehr) ruft navigator.share mit Text + URL auf', async () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    render(<RequestsFeed projectId="p1" projectTz="UTC" isLoggedIn={false} isOrganizer={false} />);
    await waitFor(() => expect(screen.getByText(/Lena geht es besser/)).toBeTruthy());
    screen.getByRole('button', { name: /signal/i }).click();
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const arg = share.mock.calls[0][0] as { text?: string; url?: string };
    expect(arg.text).toContain('Update: Lena geht es besser!');
    expect(arg.url).toContain('/projects/p1');
  });
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd /home/pmi/24pray-web && npx vitest run src/components/slots/RequestsFeed.test.tsx`
Expected: FAIL — keine Links/Buttons mit den Namen whatsapp/telegram/signal.

- [ ] **Step 3: i18n-Keys in alle 5 Kataloge**

In `/home/pmi/24pray-web/src/lib/i18n.ts` jeweils neben `shareRequest` (de: Zeile 179, en: 458, es/he/ar analog per Suche nach `shareRequest`). Markennamen bleiben unübersetzt; nur der Sammel-Button variiert:

```ts
  // de (Zeile ~179):
  shareUpdateWhatsapp: 'WhatsApp',
  shareUpdateTelegram: 'Telegram',
  shareUpdateOther: 'Signal & mehr',
  // en:
  shareUpdateWhatsapp: 'WhatsApp',
  shareUpdateTelegram: 'Telegram',
  shareUpdateOther: 'Signal & more',
  // es:
  shareUpdateWhatsapp: 'WhatsApp',
  shareUpdateTelegram: 'Telegram',
  shareUpdateOther: 'Signal y más',
  // he:
  shareUpdateWhatsapp: 'WhatsApp',
  shareUpdateTelegram: 'Telegram',
  shareUpdateOther: 'Signal ועוד',
  // ar:
  shareUpdateWhatsapp: 'WhatsApp',
  shareUpdateTelegram: 'Telegram',
  shareUpdateOther: 'Signal والمزيد',
```

(he/ar tragen den bestehenden Merkposten „Muttersprachler-Review ausstehend".)

- [ ] **Step 4: Komponente erweitern**

In `/home/pmi/24pray-web/src/components/slots/RequestsFeed.tsx` — Imports ergänzen:

```tsx
import { toast } from '@/components/ui/toast-store';
```

In der Funktion vor dem `return`:

```tsx
  // Update-Weitergabe dorthin, wo Gebetsgruppen real kommunizieren (Backlog 1):
  // reine Share-Intents (wa.me / t.me), keine Messenger-APIs, keine Daten an Dritte aus unserer Hand.
  // Signal hat keinen Text-Share-Deep-Link → System-Share-Sheet (navigator.share) mit Clipboard-Fallback.
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://24pray.org';
  const watchUrl = `${origin}/projects/${projectId}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`;
  const waHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(`${text}\n\n${watchUrl}`)}`;
  const tgHref = (text: string) =>
    `https://t.me/share/url?url=${encodeURIComponent(watchUrl)}&text=${encodeURIComponent(text)}`;

  async function shareViaSystem(text: string) {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text, url: watchUrl });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return; // Nutzer bricht Share-Sheet ab — still schlucken
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n\n${watchUrl}`);
      toast({ message: t('linkCopiedToast'), variant: 'positive' });
    } catch {
      toast({ message: `${t('shareCopyFailed')} ${watchUrl}` });
    }
  }
```

und im `<li>`-Item nach dem `<p>…{r.text}</p>` die Share-Zeile:

```tsx
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-medium text-ink-muted">
                <a href={waHref(r.text)} target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-2 hover:text-ink">
                  {t('shareUpdateWhatsapp')}
                </a>
                <a href={tgHref(r.text)} target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-2 hover:text-ink">
                  {t('shareUpdateTelegram')}
                </a>
                <button type="button" onClick={() => shareViaSystem(r.text)}
                        className="underline underline-offset-2 hover:text-ink">
                  {t('shareUpdateOther')}
                </button>
              </div>
```

- [ ] **Step 5: Tests laufen lassen — grün**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS (tsc erzwingt die drei Keys in allen 5 Katalogen).

- [ ] **Step 6: Commit**

```bash
cd /home/pmi/24pray-web
git add src/components/slots/RequestsFeed.tsx src/components/slots/RequestsFeed.test.tsx src/lib/i18n.ts
git commit -m "feat(updates): Share pro Update: WhatsApp, Telegram, Signal/System-Share (Backlog 1)"
```

---

### Task 8: Abschluss — Volle Suiten, Backlog pflegen, Deploy-Checkliste notieren

**Files:**
- Modify: `/home/pmi/24pray-web/docs/BACKLOG.md`

**Interfaces:**
- Consumes: alle vorherigen Tasks.
- Produces: grüne Suiten in beiden Repos, aktualisiertes Backlog, dokumentierte Deploy-Voraussetzung.

- [ ] **Step 1: Beide Suiten komplett**

```bash
cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit
cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint
```

Expected: alles grün.

- [ ] **Step 2: Backlog aktualisieren**

In `/home/pmi/24pray-web/docs/BACKLOG.md` Punkt 1 der Web2-Loops ersetzen durch:

```markdown
1. ~~**Update-Benachrichtigung an Beter**~~ — GEBAUT 2026-07-09 (lokalisierte Mail in 5 Sprachen
   an alle Teilnehmer, HMAC-Abmelde-Link, WhatsApp-Share pro Update; Empfänger-Locale wird seit-
   dem bei Login/Buchung erfasst). DEPLOY AUSSTEHEND — vorher `UNSUBSCRIBE_SECRET` in
   `/etc/24pray-api.env` setzen (`openssl rand -base64 32`); Schema geändert ⇒ auf dem VPS
   `npx prisma generate` nicht vergessen. Mail-i18n der ALT-Mails = neuer Merkposten unten.
```

und unter „Kleinere Merkposten" ergänzen:

```markdown
- Alt-Mails (Buchung, Erinnerung, Verschiebung, Farewell) auf Empfänger-Locale umstellen
  (Locale liegt seit Backlog 1 am User/Slot; Katalog-Muster: `UPDATE_NOTICE_TEXTS` in mailer.ts)
- Update-Mail he/ar Texte: Muttersprachler-Review (zusammen mit bestehendem he/ar-Merkposten)
```

- [ ] **Step 3: Commit + Push beider Repos**

```bash
cd /home/pmi/24pray-web && git add docs/BACKLOG.md && git commit -m "docs(backlog): Punkt 1 Update-Benachrichtigung gebaut, Deploy-Checkliste notiert"
cd /home/pmi/24pray-api && git pull --rebase && git push
cd /home/pmi/24pray-web && git pull --rebase && git push
```

Expected: CI in beiden Repos grün (GitHub Actions auf main). **Kein Deploy in diesem Plan** — Deploy nur nach separatem Auftrag; UI-Änderung (WhatsApp-Link) ⇒ Screenshot-Freigabe vor Deploy.
