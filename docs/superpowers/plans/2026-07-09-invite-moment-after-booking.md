# Einladungs-Moment nach Buchung (Backlog 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Direkt nach einer Buchung — im Erfolgs-Screen und in der Bestätigungsmail — wird der Beter eingeladen, jemanden für „die Stunde neben dir" zu gewinnen (Share-Link auf die Wache, Messenger-Trio WhatsApp/Telegram/Signal-System-Share).

**Architecture:** Die in `RequestsFeed.tsx` duplizierte Share-Logik (wa.me/t.me/System-Share) wird in eine gemeinsame Lib `src/lib/share.ts` extrahiert und von beiden Stellen konsumiert. Der Gast-Erfolgs-Zustand in `GuestBookingForm` bekommt den Einladungs-Absatz + Share-Zeile (Props `projectId`/`invite` via `SlotSheet` aus `project`). API-seitig wird `BookingMail` um `projectUrl` erweitert und `sendBookingConfirmation` um einen Einladungs-Absatz (deutsch, wie alle Alt-Mails — Mail-i18n ist separater Merkposten).

**Tech Stack:** Bestand — keine neuen Dependencies.

## Global Constraints

- Repos: API = `/home/pmi/24pray-api`, Web = `/home/pmi/24pray-web` (Branch `main`). Committen ja, **NICHT pushen**.
- **NIEMALS `next build` lokal**; keinen Dev-Server killen; kein `prisma migrate dev` (keine Migration nötig).
- Messenger-Trio-Regel (User-Vorgabe): WhatsApp (`wa.me`), Telegram (`t.me/share/url`), Signal NUR über System-Share-Sheet (`navigator.share`, Clipboard-Fallback + Toast) — kein erfundenes Signal-URL-Schema.
- i18n Web: 5 Kataloge typvollständig — neue Keys in ALLE 5. Die Trio-Labels `shareUpdateWhatsapp`/`shareUpdateTelegram`/`shareUpdateOther` werden WIEDERVERWENDET (Markennamen, in allen Katalogen identisch), NICHT dupliziert.
- Suiten: api `npx vitest run` + `npx tsc --noEmit`; web zusätzlich `npx next lint`. TDD, Testdaten-Prefix `un4-`.
- Commit-Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_011CPPASHZYersFD37Auq5kB`

---

### Task 1: Web — Share-Lib `src/lib/share.ts` extrahieren + `RequestsFeed` refactoren

**Files:**
- Create: `/home/pmi/24pray-web/src/lib/share.ts`
- Test: `/home/pmi/24pray-web/src/lib/share.test.ts`
- Modify: `/home/pmi/24pray-web/src/components/slots/RequestsFeed.tsx:57-82` (Inline-Helfer durch Lib-Aufrufe ersetzen)

**Interfaces:**
- Consumes: `toast` aus `@/components/ui/toast-store`, `t` aus `@/lib/i18n` (Keys `linkCopiedToast`, `shareCopyFailed` existieren).
- Produces (Task 2 verlässt sich exakt darauf):
  - `buildWatchUrl(projectId: string, invite?: string): string` — `${origin}/projects/${projectId}` + `?invite=<encoded>` wenn `invite`; `origin` = `window.location.origin` mit SSR-Fallback `'https://24pray.org'`.
  - `waShareHref(text: string, url: string): string` — `https://wa.me/?text=<encodeURIComponent(text + '\n\n' + url)>`
  - `tgShareHref(text: string, url: string): string` — `https://t.me/share/url?url=<enc(url)>&text=<enc(text)>`
  - `shareViaSystem(text: string, url: string): Promise<void>` — `navigator.share({ text, url })`, AbortError still schlucken; Fallback `navigator.clipboard.writeText(text + '\n\n' + url)` + Toast `linkCopiedToast`, bei Clipboard-Fehler Toast `shareCopyFailed` + URL.

- [ ] **Step 1: Failing Test schreiben**

`/home/pmi/24pray-web/src/lib/share.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/components/ui/toast-store', () => ({ toast: vi.fn() }));

import { buildWatchUrl, waShareHref, tgShareHref, shareViaSystem } from './share';
import { toast } from '@/components/ui/toast-store';

describe('share lib (Backlog 4)', () => {
  it('buildWatchUrl baut Projekt-URL, mit encodetem invite', () => {
    expect(buildWatchUrl('p1')).toBe(`${window.location.origin}/projects/p1`);
    expect(buildWatchUrl('p1', 'a+b')).toBe(`${window.location.origin}/projects/p1?invite=a%2Bb`);
  });

  it('waShareHref/tgShareHref encodieren Text und URL vollständig', () => {
    const wa = waShareHref('Hallo & Amen #1', 'https://x/p/1');
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(wa.split('text=')[1])).toBe('Hallo & Amen #1\n\nhttps://x/p/1');
    const tg = tgShareHref('Hallo & Amen #1', 'https://x/p/1');
    expect(tg).toContain('https://t.me/share/url?');
    expect(tg).toContain(`url=${encodeURIComponent('https://x/p/1')}`);
    expect(tg).toContain(`text=${encodeURIComponent('Hallo & Amen #1')}`);
  });

  it('shareViaSystem nutzt navigator.share wenn vorhanden', async () => {
    const share = vi.fn(async (_d: { text?: string; url?: string }) => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    await shareViaSystem('Text', 'https://x/p/1');
    expect(share).toHaveBeenCalledWith({ text: 'Text', url: 'https://x/p/1' });
  });

  it('shareViaSystem faellt ohne navigator.share auf Clipboard + Toast zurueck', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const write = vi.fn(async (_s: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    await shareViaSystem('Text', 'https://x/p/1');
    expect(write).toHaveBeenCalledWith('Text\n\nhttps://x/p/1');
    expect(toast).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-web && npx vitest run src/lib/share.test.ts`
Expected: FAIL — Modul `./share` existiert nicht.

- [ ] **Step 3: Lib implementieren**

`/home/pmi/24pray-web/src/lib/share.ts`:

```ts
import { toast } from '@/components/ui/toast-store';
import { t } from '@/lib/i18n';

// Gemeinsame Share-Intents (Backlog 1+4, User-Regel Messenger-Trio):
// WhatsApp/Telegram als reine Deep-Links, Signal NUR über den System-Share-Sheet —
// Signal hat keinen Text-Share-Deep-Link. Keine Messenger-APIs, keine Daten an Dritte.

export function buildWatchUrl(projectId: string, invite?: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://24pray.org';
  return `${origin}/projects/${projectId}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`;
}

export function waShareHref(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n\n${url}`)}`;
}

export function tgShareHref(text: string, url: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

export async function shareViaSystem(text: string, url: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ text, url });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // Nutzer bricht Share-Sheet ab — still schlucken
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n\n${url}`);
    toast({ message: t('linkCopiedToast'), variant: 'positive' });
  } catch {
    toast({ message: `${t('shareCopyFailed')} ${url}` });
  }
}
```

- [ ] **Step 4: RequestsFeed auf die Lib umstellen**

In `/home/pmi/24pray-web/src/components/slots/RequestsFeed.tsx`:

Import ergänzen / anpassen:

```tsx
import { buildWatchUrl, waShareHref, tgShareHref, shareViaSystem } from '@/lib/share';
```

Den Block Zeilen ~57-82 (Kommentar „Update-Weitergabe…" + `origin`/`watchUrl`/`waHref`/`tgHref`/`shareViaSystem`) ersetzen durch:

```tsx
  // Update-Weitergabe dorthin, wo Gebetsgruppen real kommunizieren (Backlog 1) — Share-Lib.
  const watchUrl = buildWatchUrl(projectId, invite);
```

und in der Share-Zeile des `<li>` die Aufrufe anpassen:
- `href={waHref(r.text)}` → `href={waShareHref(r.text, watchUrl)}`
- `href={tgHref(r.text)}` → `href={tgShareHref(r.text, watchUrl)}`
- `onClick={() => shareViaSystem(r.text)}` → `onClick={() => shareViaSystem(r.text, watchUrl)}`

Der `toast`-Import in RequestsFeed kann entfallen, wenn er sonst ungenutzt ist (lint prüft das).

- [ ] **Step 5: Suiten laufen lassen — grün**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS — insbesondere die bestehenden `RequestsFeed.test.tsx`-Share-Tests unverändert grün (Verhalten identisch).

- [ ] **Step 6: Commit**

```bash
cd /home/pmi/24pray-web
git add src/lib/share.ts src/lib/share.test.ts src/components/slots/RequestsFeed.tsx
git commit -m "refactor(share): gemeinsame Share-Lib (wa/tg/System-Share) aus RequestsFeed extrahiert"
```

---

### Task 2: Web — Einladungs-Moment im Gast-Erfolgs-Screen

**Files:**
- Modify: `/home/pmi/24pray-web/src/components/slots/GuestBookingForm.tsx` (Props + Erfolgs-Zustand Zeilen 96-124)
- Modify: `/home/pmi/24pray-web/src/components/slots/SlotSheet.tsx:264-267` (Props durchreichen)
- Modify: `/home/pmi/24pray-web/src/lib/i18n.ts` (2 neue Keys in alle 5 Kataloge)
- Test: `/home/pmi/24pray-web/src/components/slots/GuestBookingForm.test.tsx` (neu oder erweitern, falls vorhanden — vorher prüfen)

**Interfaces:**
- Consumes: `buildWatchUrl`/`waShareHref`/`tgShareHref`/`shareViaSystem` aus Task 1; i18n-Keys `shareUpdateWhatsapp`/`shareUpdateTelegram`/`shareUpdateOther` (existieren).
- Produces: `GuestBookingFormProps` zusätzlich `projectId: string; invite?: string;`.

- [ ] **Step 1: Failing Test schreiben**

Prüfe zuerst, ob `/home/pmi/24pray-web/src/components/slots/GuestBookingForm.test.tsx` existiert; wenn ja dort ergänzen (Muster der Datei), sonst neu anlegen:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { GuestBookingForm } from './GuestBookingForm';

const SLOT = {
  key: 's1', startTime: '2026-07-10T10:00:00.000Z', endTime: '2026-07-10T11:00:00.000Z',
  status: 'FREE',
} as never;

describe('GuestBookingForm — Einladungs-Moment nach Buchung (Backlog 4)', () => {
  beforeEach(() => cleanup());

  it('Erfolgs-Screen zeigt Einladung + Share-Zeile (WhatsApp/Telegram/Signal) mit Wachen-URL', async () => {
    render(
      <GuestBookingForm
        slot={SLOT} projectTitle="Wache Lena" projectTz="UTC"
        projectId="p1" invite="tok1"
        onSubmit={async () => ({ guestToken: 'g1' })}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Maria' } });
    fireEvent.click(screen.getByRole('button', { name: /Stunde|übernehmen/i }));
    await waitFor(() => expect(screen.getByText(/gehört dir/i)).toBeTruthy());
    // Einladungs-Absatz + Trio
    expect(screen.getByText(/Lade jemanden ein/i)).toBeTruthy();
    const wa = screen.getByRole('link', { name: /whatsapp/i }) as HTMLAnchorElement;
    expect(wa.href).toContain('https://wa.me/?text=');
    expect(decodeURIComponent(wa.href)).toContain('/projects/p1?invite=tok1');
    expect(screen.getByRole('link', { name: /telegram/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /signal/i })).toBeTruthy();
  });
});
```

(`SLOT`-Shape ggf. an `SlotViewModel` anpassen — Datei `src/components/slots/types.ts` prüfen; Assertions unverändert lassen. Falls `CityInput`/`mylocation` im jsdom-Test stören, mocken wie andere Slot-Tests es vormachen — Muster in bestehenden Tests des Ordners suchen.)

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-web && npx vitest run src/components/slots/GuestBookingForm.test.tsx`
Expected: FAIL — Props `projectId` unbekannt / „Lade jemanden ein" nicht gefunden.

- [ ] **Step 3: i18n-Keys (alle 5 Kataloge, neben `guestAccountOffer` einfügen)**

```ts
  // de (~Zeile 168):
  inviteAfterBooking: 'Lade jemanden ein, die Stunde neben dir zu übernehmen:',
  inviteShareText: 'Ich habe eine Gebetsstunde in „{title}" übernommen. Übernimmst du die Stunde neben mir?',
  // en:
  inviteAfterBooking: 'Invite someone to take the hour next to yours:',
  inviteShareText: 'I took a prayer hour in “{title}”. Will you take the hour next to mine?',
  // es:
  inviteAfterBooking: 'Invita a alguien a tomar la hora junto a la tuya:',
  inviteShareText: 'He tomado una hora de oración en «{title}». ¿Tomas la hora junto a la mía?',
  // he:
  inviteAfterBooking: 'הזמינו מישהו לקחת את השעה שלצידכם:',
  inviteShareText: 'לקחתי שעת תפילה ב"{title}". תיקחו את השעה שלצידי?',
  // ar:
  inviteAfterBooking: 'ادعُ شخصًا ليأخذ الساعة المجاورة لساعتك:',
  inviteShareText: 'أخذتُ ساعة صلاة في «{title}». هل تأخذ الساعة المجاورة لساعتي؟',
```

- [ ] **Step 4: Komponente + Threading**

`GuestBookingForm.tsx`:

Imports ergänzen:

```tsx
import { buildWatchUrl, waShareHref, tgShareHref, shareViaSystem } from '@/lib/share';
```

Props erweitern (in `GuestBookingFormProps` nach `projectTz: string;`):

```tsx
  projectId: string;
  invite?: string; // PRIVATE-Wache: inviteToken, damit der geteilte Link funktioniert
```

und in der Funktions-Signatur destrukturieren: `{ slot, projectTitle, projectTz, projectId, invite, dayMode, onSubmit }`.

Im `if (done)`-Block NACH dem `addToCalendar`-Button (Zeile ~115) und VOR dem `guestAccountOffer`-Absatz einfügen:

```tsx
        {(() => {
          const url = buildWatchUrl(projectId, invite);
          const text = t('inviteShareText', { title: projectTitle });
          return (
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-sm text-ink">{t('inviteAfterBooking')}</p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-ink-muted">
                <a href={waShareHref(text, url)} target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-2 hover:text-ink">
                  {t('shareUpdateWhatsapp')}
                </a>
                <a href={tgShareHref(text, url)} target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-2 hover:text-ink">
                  {t('shareUpdateTelegram')}
                </a>
                <button type="button" onClick={() => shareViaSystem(text, url)}
                        className="underline underline-offset-2 hover:text-ink">
                  {t('shareUpdateOther')}
                </button>
              </div>
            </div>
          );
        })()}
```

(Falls die Utility-Klasse `border-border` im Projekt anders heißt — per grep in bestehenden Komponenten prüfen und die dort übliche Border-Klasse nehmen.)

`SlotSheet.tsx` (Render-Stelle Zeile ~264): Props ergänzen:

```tsx
          <GuestBookingForm
            slot={slot}
            projectTitle={project.title}
            projectTz={project.timezone}
            projectId={project.id}
            invite={project.visibility === 'PRIVATE' ? project.inviteToken || undefined : undefined}
            dayMode={dayMode}
```

- [ ] **Step 5: Suiten laufen lassen — grün**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/pmi/24pray-web
git add src/components/slots/GuestBookingForm.tsx src/components/slots/SlotSheet.tsx src/lib/i18n.ts src/components/slots/GuestBookingForm.test.tsx
git commit -m "feat(booking): Einladungs-Moment im Erfolgs-Screen (Share-Trio auf die Wache) (Backlog 4)"
```

---

### Task 3: API — Einladungs-Absatz in der Bestätigungsmail

**Files:**
- Modify: `/home/pmi/24pray-api/src/lib/mailer.ts:13-21` (BookingMail) und `sendBookingConfirmation` (Dev-Zweig ~140-142, SMTP-Zweig ~185-195)
- Modify: `/home/pmi/24pray-api/src/routes/slots.ts:117-129` (Aufrufstelle befüllen)
- Test: `/home/pmi/24pray-api/src/lib/mailer.test.ts`

**Interfaces:**
- Consumes: an der Aufrufstelle liegt `project` vollständig vor (`visibility`, `inviteToken`, `id`); `env.APP_URL` ist dort bereits im Einsatz (ics-Link).
- Produces: `BookingMail` zusätzlich `projectUrl?: string` (optional — bestehende Aufrufer/Tests ohne das Feld bleiben gültig).

- [ ] **Step 1: Failing Test schreiben**

In `/home/pmi/24pray-api/src/lib/mailer.test.ts` (Muster der Datei: Dev-Mailer + console.log-Spy — ABER der Einladungs-Absatz ist nur im SMTP-Text sichtbar; deshalb hier den Interface-Weg testen):

```ts
describe('Backlog 4 — Einladungs-Absatz in der Bestätigungsmail', () => {
  it('Dev-Mailer akzeptiert projectUrl im BookingMail (Typ-/Smoke-Test)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendBookingConfirmation!('un4-x@example.com', {
      name: 'Maria', projectTitle: 'Wache', startTime: new Date().toISOString(),
      timezone: 'Europe/Berlin', icsUrl: 'http://x/ics', googleUrl: 'http://x/g',
      projectUrl: 'https://24pray.org/projects/p1',
    });
    expect(spy.mock.calls.flat().join(' ')).toContain('un4-x@example.com');
    spy.mockRestore();
  });
});
```

Zusätzlich in `/home/pmi/24pray-api/src/routes/slots.test.ts` (Fixtures der Datei nutzen; Fake-Mailer der Suite um Capture erweitern, falls `sendBookingConfirmation` dort noch nicht gecaptured wird):

```ts
describe('Backlog 4 — Bestätigungsmail trägt projectUrl', () => {
  it('Gastbuchung mit E-Mail: BookingMail enthält projectUrl der Wache', async () => {
    const owner = await loginAs('un4-mail-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un4 MailTest', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    await app.inject({
      method: 'POST', url: `/projects/${id}/slots`,
      payload: { startTime: at(2), guestName: 'Gast', guestEmail: 'un4-guest@example.com' },
    });
    await vi.waitFor(() => {
      const hit = bookingConfirmations.find((c) => c.email === 'un4-guest@example.com');
      expect(hit).toBeTruthy();
      expect(hit!.b.projectUrl).toContain(`/projects/${id}`);
    });
  });
});
```

(`bookingConfirmations` = Capture-Array im Fake-Mailer der Datei — analog zum `captured`-Muster ergänzen: `async sendBookingConfirmation(email, b) { bookingConfirmations.push({ email, b }); }`. Versand ist fire-and-forget → `vi.waitFor`.)

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/lib/mailer.test.ts src/routes/slots.test.ts`
Expected: FAIL — `projectUrl` existiert nicht im Typ bzw. ist undefined.

- [ ] **Step 3: Implementierung**

`mailer.ts` — `BookingMail` erweitern:

```ts
  projectUrl?: string; // Einladungs-Moment (Backlog 4): Link auf die Wache (PRIVATE: mit ?invite=)
```

`sendBookingConfirmation` (SMTP-Zweig) — nach `const cal = calendarBlock(...)`:

```ts
      const invite = b.projectUrl
        ? {
            text: `\n\nLade jemanden ein, die Stunde neben dir zu übernehmen: ${b.projectUrl}`,
            html: `<p>Lade jemanden ein, die Stunde neben dir zu übernehmen: <a href="${b.projectUrl}">${b.projectUrl}</a></p>`,
          }
        : { text: '', html: '' };
```

und in `text:`/`html:` jeweils `${invite.text}` bzw. `${invite.html}` NACH dem Kalender-Block anhängen.

`slots.ts` — im `sendBookingConfirmation`-Aufruf (Zeile ~119-128) nach `googleUrl: googleCalendarUrl(ev),` ergänzen:

```ts
        projectUrl: `${env.APP_URL}/projects/${project.id}${project.visibility === 'PRIVATE' ? `?invite=${project.inviteToken}` : ''}`,
```

- [ ] **Step 4: Tests laufen lassen — grün (komplette Suite)**

Run: `cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/pmi/24pray-api
git add src/lib/mailer.ts src/lib/mailer.test.ts src/routes/slots.ts src/routes/slots.test.ts
git commit -m "feat(mail): Einladungs-Absatz mit Wachen-Link in der Buchungs-Bestätigung (Backlog 4)"
```

---

### Task 4: Abschluss — Volle Suiten + Backlog (KEIN Push)

**Files:**
- Modify: `/home/pmi/24pray-web/docs/BACKLOG.md`

- [ ] **Step 1: Beide Suiten komplett**

```bash
cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit
cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint
```

Expected: alles grün.

- [ ] **Step 2: Backlog aktualisieren**

Punkt 4 der Web2-Loops ersetzen durch:

```markdown
4. ~~**Einladungs-Moment nach Buchung**~~ — GEBAUT 2026-07-09 (Gast-Erfolgs-Screen: „Lade
   jemanden ein, die Stunde neben dir zu übernehmen" + Share-Trio WhatsApp/Telegram/Signal-
   System-Share; Bestätigungsmail: Einladungs-Absatz mit Wachen-Link, PRIVATE mit ?invite=.
   Share-Logik in gemeinsame Lib src/lib/share.ts extrahiert, RequestsFeed nutzt sie mit.)
```

- [ ] **Step 3: Commit (nur web, kein Push)**

```bash
cd /home/pmi/24pray-web
git add docs/BACKLOG.md
git commit -m "docs(backlog): Punkt 4 Einladungs-Moment gebaut"
```
