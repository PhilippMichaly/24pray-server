# Feedback-Button + Open-Source-Hinweis (User-Zusatzpunkt) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nutzer (auch Gäste) können über einen Footer-Link Feedback/Fehler melden (Mini-Dialog → Mail an den Betreiber, kein Drittanbieter); der Footer zeigt zusätzlich ein GitHub-Logo mit Link auf das öffentliche Repo (24pray ist Open Source).

**Architecture:** API bekommt `POST /feedback` (zod-validiert, Rate-Limit, fail-closed ohne `FEEDBACK_TO`-Env) + neuen Mailer-Typ `sendFeedback` (Reply-To = optionale Nutzer-Adresse). Web bekommt eine `FeedbackDialog`-Komponente (bestehendes `Sheet`-Muster) mit Erfolgs-Zustand inkl. „Auf GitHub melden"-Link, eingebaut in beide Footer (AppShell + Landing) neben einem GitHub-Icon-Link.

**Tech Stack:** Bestand — keine neuen Dependencies (`Github`-Icon aus lucide-react).

## Global Constraints

- Repos: API = `/home/pmi/24pray-api`, Web = `/home/pmi/24pray-web` (Branch `main`). Committen ja, **NICHT pushen**.
- Datensparsamkeit: Feedback wird NICHT in der DB gespeichert — es geht direkt als Mail an `FEEDBACK_TO` (User-Entscheidung: philipp@michaly.de, NUR als Env-Variable auf dem VPS, NIE im Code/Repo).
- Repo-URL (öffentlich, verifiziert): `https://github.com/PhilippMichaly/24pray-web` (Issues: `…/issues`).
- **NIEMALS `next build` lokal**; keinen Dev-Server killen; keine Migration nötig.
- i18n: neue Keys in ALLE 5 Kataloge (he/ar verbatim aus diesem Plan). RTL: nur logische Utilities.
- Suiten: api vitest+tsc; web vitest+tsc+lint. TDD, Testdaten-Prefix `un9-`.
- Commit-Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_011CPPASHZYersFD37Auq5kB`

---

### Task 1: API — `POST /feedback` + `sendFeedback`-Mail

**Files:**
- Modify: `/home/pmi/24pray-api/src/env.ts` (`FEEDBACK_TO`)
- Modify: `/home/pmi/24pray-api/src/lib/mailer.ts` (Interface + Dev-/SMTP-Impl)
- Create: `/home/pmi/24pray-api/src/routes/feedback.ts`
- Modify: `/home/pmi/24pray-api/src/app.ts` (Registrierung)
- Test: `/home/pmi/24pray-api/src/routes/feedback.test.ts` (neu), `/home/pmi/24pray-api/src/lib/mailer.test.ts` (Smoke)
- Modify: `/home/pmi/24pray-api/deploy/README.md` (Env-Block §5: `FEEDBACK_TO=`-Zeile mit Kommentar)

**Interfaces:**
- Produces:
  - `POST /feedback` Body `{ message: string (5..2000), email?: string (email), page?: string (max 200) }` → 204; 404 wenn `FEEDBACK_TO` leer (fail-closed, wie /stats/funnel); Rate-Limit 5/min.
  - `Mailer.sendFeedback?(to: string, f: FeedbackMail): Promise<void>` mit `FeedbackMail { message: string; replyTo?: string; page?: string }`.
  - `env.FEEDBACK_TO: z.string().default('')`.

- [ ] **Step 1: Failing Tests schreiben**

`/home/pmi/24pray-api/src/routes/feedback.test.ts` (Kopf nach dem Muster von `funnel.test.ts`/`community.test.ts`: `makeTestDb`, `buildApp` mit `parseEnv({ APP_URL: 'http://localhost:3000', FEEDBACK_TO: 'un9-owner@example.com' })`, Fake-Mailer mit Capture):

```ts
const feedbacks: { to: string; f: { message: string; replyTo?: string; page?: string } }[] = [];
// im Fake-Mailer: async sendFeedback(to, f) { feedbacks.push({ to, f }); },

describe('Feedback-Endpoint (User-Zusatzpunkt)', () => {
  it('valides Feedback → 204, Mail an FEEDBACK_TO mit replyTo und page', async () => {
    const res = await app.inject({
      method: 'POST', url: '/feedback',
      payload: { message: 'un9: Der Kalender-Knopf tut nichts.', email: 'un9-user@example.com', page: '/projects/abc' },
    });
    expect(res.statusCode).toBe(204);
    expect(feedbacks.length).toBe(1);
    expect(feedbacks[0].to).toBe('un9-owner@example.com');
    expect(feedbacks[0].f.message).toContain('Kalender-Knopf');
    expect(feedbacks[0].f.replyTo).toBe('un9-user@example.com');
    expect(feedbacks[0].f.page).toBe('/projects/abc');
  });

  it('email/page optional; zu kurze message → 400', async () => {
    expect((await app.inject({ method: 'POST', url: '/feedback', payload: { message: 'un9 ohne alles, aber lang genug' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/feedback', payload: { message: 'kurz' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/feedback', payload: { message: 'lang genug aber', email: 'keinemail' } })).statusCode).toBe(400);
  });

  it('ohne FEEDBACK_TO: 404 (Endpoint faktisch aus)', async () => {
    const { buildApp: build } = await import('../app.js');
    const bare = await build({
      prisma: db.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000' }),
      mailer: { async sendMagicLink() {} },
    });
    await bare.ready();
    try {
      expect((await bare.inject({ method: 'POST', url: '/feedback', payload: { message: 'lang genug fuer valide' } })).statusCode).toBe(404);
    } finally { await bare.close(); }
  });
});
```

In `mailer.test.ts` Smoke-Test (Dev-Logger-Muster der Datei):

```ts
describe('sendFeedback (User-Zusatzpunkt)', () => {
  it('Dev-Mailer loggt Empfänger', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendFeedback!('un9-owner@example.com', { message: 'Testfeedback', replyTo: 'x@y.zz' });
    expect(spy.mock.calls.flat().join(' ')).toContain('un9-owner@example.com');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd /home/pmi/24pray-api && npx vitest run src/routes/feedback.test.ts src/lib/mailer.test.ts`
Expected: FAIL — Route 404 überall / `sendFeedback` undefined.

- [ ] **Step 3: Implementierung**

`src/env.ts` — nach `FUNNEL_TOKEN`:

```ts
  // Empfänger der Nutzer-Feedback-Mails (User-Zusatzpunkt). Leer = /feedback antwortet 404.
  FEEDBACK_TO: z.string().default(''),
```

`src/lib/mailer.ts` — Interface-Typ (nach `UpdateNoticeMail`):

```ts
/** Nutzer-Feedback (Footer-Dialog) → Mail an den Betreiber; bewusst KEINE DB-Speicherung. */
export interface FeedbackMail {
  message: string; // User-Content — im HTML escapen!
  replyTo?: string; // optionale Antwort-Adresse des Nutzers
  page?: string; // Seite, von der das Feedback kam
}
```

Im `Mailer`-Interface: `sendFeedback?(to: string, f: FeedbackMail): Promise<void>;`

Dev-Zweig:

```ts
      async sendFeedback(to, f) {
        console.log(`[mailer:dev] feedback for ${to} (replyTo: ${f.replyTo ?? '-'}, page: ${f.page ?? '-'})`);
      },
```

SMTP-Zweig:

```ts
    async sendFeedback(to, f) {
      await transport.sendMail({
        from: config.from,
        to,
        ...(f.replyTo ? { replyTo: f.replyTo } : {}),
        subject: `24pray — Nutzer-Feedback${f.page ? ` (${f.page})` : ''}`,
        text: `${f.message}\n\n—\nSeite: ${f.page ?? '-'}\nAntwort-Adresse: ${f.replyTo ?? 'keine angegeben'}`,
        html: `<blockquote style="margin:0;padding-inline-start:12px;border-inline-start:3px solid #ccc;white-space:pre-wrap">${escapeHtml(f.message)}</blockquote><p style="font-size:12px;color:#888">Seite: ${escapeHtml(f.page ?? '-')} · Antwort-Adresse: ${escapeHtml(f.replyTo ?? 'keine angegeben')}</p>`,
      });
    },
```

`src/routes/feedback.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Mailer } from '../lib/mailer.js';
import type { Env } from '../env.js';

const FeedbackBody = z.object({
  message: z.string().min(5).max(2000),
  email: z.string().email().optional(),
  page: z.string().max(200).optional(),
});

export function feedbackRoutes(app: FastifyInstance, deps: { mailer?: Mailer; env?: Env }) {
  const { mailer, env } = deps;

  // Feedback ohne Login (gerade Fehler-Melder sind Gäste). Kein Drittanbieter, keine DB —
  // direkt als Mail an den Betreiber. Ohne FEEDBACK_TO existiert der Endpoint nicht (404).
  app.post('/feedback', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!env?.FEEDBACK_TO || !mailer?.sendFeedback) {
      return reply.code(404).send({ message: 'Nicht gefunden' });
    }
    const body = FeedbackBody.parse(req.body);
    await mailer.sendFeedback(env.FEEDBACK_TO, {
      message: body.message,
      replyTo: body.email,
      page: body.page,
    });
    return reply.code(204).send();
  });
}
```

`src/app.ts` — Import + Registrierung:

```ts
import { feedbackRoutes } from './routes/feedback.js';
```

```ts
  feedbackRoutes(app, { mailer, env });
```

`deploy/README.md` — im Env-Block nach der `FUNNEL_TOKEN=`-Zeile:

```
# Empfaenger der Nutzer-Feedback-Mails (Footer-Dialog) — leer = Feature aus (404)
FEEDBACK_TO=
```

- [ ] **Step 4: Tests laufen lassen — grün (komplette Suite)**

Run: `cd /home/pmi/24pray-api && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/pmi/24pray-api
git add src/env.ts src/lib/mailer.ts src/lib/mailer.test.ts src/routes/feedback.ts src/routes/feedback.test.ts src/app.ts deploy/README.md
git commit -m "feat(feedback): POST /feedback als Mail an den Betreiber (fail-closed ohne FEEDBACK_TO)"
```

---

### Task 2: Web — FeedbackDialog + GitHub-Link in beiden Footern

**Files:**
- Create: `/home/pmi/24pray-web/src/components/patterns/FeedbackDialog.tsx`
- Test: `/home/pmi/24pray-web/src/components/patterns/FeedbackDialog.test.tsx`
- Modify: `/home/pmi/24pray-web/src/components/patterns/AppShell.tsx:72-80` (Footer)
- Modify: `/home/pmi/24pray-web/src/app/(public)/page.tsx` (Landing-Footer, ~Zeilen 139-146)
- Modify: `/home/pmi/24pray-web/src/lib/i18n.ts` (8 neue Keys in alle 5 Kataloge)

**Interfaces:**
- Consumes: `Sheet` aus `@/components/ui/Sheet`, `Button`, `Textarea`/`Input`/`Label` aus `@/components/ui`, `api` aus `@/lib/api`, `Github` aus lucide-react.
- Produces: `FeedbackDialog` (selbstverwalteter Trigger: rendert den Footer-Link-Button + Sheet); `GITHUB_REPO_URL`-Konstante in der Komponente.

- [ ] **Step 1: Failing Test schreiben**

`/home/pmi/24pray-web/src/components/patterns/FeedbackDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const post = vi.fn(async () => undefined);
vi.mock('@/lib/api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

import { FeedbackDialog } from './FeedbackDialog';

describe('FeedbackDialog (User-Zusatzpunkt)', () => {
  beforeEach(() => { cleanup(); post.mockClear(); });

  it('öffnet, sendet Feedback mit optionaler Mail, zeigt Danke + GitHub-Link', async () => {
    render(<FeedbackDialog />);
    fireEvent.click(screen.getByRole('button', { name: /feedback/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /feedback|nachricht/i }), {
      target: { value: 'un9: Der Kalender-Knopf tut nichts.' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /antwort|e-mail/i }), {
      target: { value: 'un9-user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /absenden|senden/i }));
    await waitFor(() => expect(screen.getByText(/danke/i)).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/feedback', expect.objectContaining({
      message: 'un9: Der Kalender-Knopf tut nichts.',
      email: 'un9-user@example.com',
    }));
    const gh = screen.getByRole('link', { name: /github/i }) as HTMLAnchorElement;
    expect(gh.href).toContain('github.com/PhilippMichaly/24pray-web');
  });

  it('leere optionale Mail wird nicht mitgesendet', async () => {
    render(<FeedbackDialog />);
    fireEvent.click(screen.getByRole('button', { name: /feedback/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /feedback|nachricht/i }), {
      target: { value: 'un9 nur Text, lang genug.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /absenden|senden/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.email).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-web && npx vitest run src/components/patterns/FeedbackDialog.test.tsx`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: i18n-Keys (alle 5 Kataloge)**

```ts
  // de:
  feedbackLink: 'Feedback',
  feedbackTitle: 'Dein Feedback',
  feedbackHint: 'Fehler gefunden oder eine Idee? Schreib uns — ohne Anmeldung.',
  feedbackMessageLabel: 'Nachricht',
  feedbackEmailLabel: 'Antwort-Adresse (optional)',
  feedbackSend: 'Absenden',
  feedbackThanks: 'Danke! Dein Feedback ist angekommen.',
  feedbackGithub: 'Oder auf GitHub melden',
  githubRepoLabel: 'Quellcode auf GitHub — 24pray ist Open Source',
  // en:
  feedbackLink: 'Feedback',
  feedbackTitle: 'Your feedback',
  feedbackHint: 'Found a bug or have an idea? Write to us — no sign-in needed.',
  feedbackMessageLabel: 'Message',
  feedbackEmailLabel: 'Reply address (optional)',
  feedbackSend: 'Send',
  feedbackThanks: 'Thank you! Your feedback has arrived.',
  feedbackGithub: 'Or report on GitHub',
  githubRepoLabel: 'Source code on GitHub — 24pray is open source',
  // es:
  feedbackLink: 'Comentarios',
  feedbackTitle: 'Tu opinión',
  feedbackHint: '¿Encontraste un error o tienes una idea? Escríbenos — sin registro.',
  feedbackMessageLabel: 'Mensaje',
  feedbackEmailLabel: 'Dirección de respuesta (opcional)',
  feedbackSend: 'Enviar',
  feedbackThanks: '¡Gracias! Tu mensaje ha llegado.',
  feedbackGithub: 'O repórtalo en GitHub',
  githubRepoLabel: 'Código fuente en GitHub — 24pray es open source',
  // he:
  feedbackLink: 'משוב',
  feedbackTitle: 'המשוב שלך',
  feedbackHint: 'מצאתם באג או יש לכם רעיון? כתבו לנו — בלי הרשמה.',
  feedbackMessageLabel: 'הודעה',
  feedbackEmailLabel: 'כתובת לתשובה (לא חובה)',
  feedbackSend: 'שליחה',
  feedbackThanks: 'תודה! המשוב שלכם התקבל.',
  feedbackGithub: 'או דווחו ב-GitHub',
  githubRepoLabel: 'קוד המקור ב-GitHub — ‏24pray הוא קוד פתוח',
  // ar:
  feedbackLink: 'ملاحظات',
  feedbackTitle: 'ملاحظاتك',
  feedbackHint: 'وجدت خطأ أو لديك فكرة؟ اكتب لنا — دون تسجيل.',
  feedbackMessageLabel: 'الرسالة',
  feedbackEmailLabel: 'عنوان للرد (اختياري)',
  feedbackSend: 'إرسال',
  feedbackThanks: 'شكرًا! وصلت ملاحظاتك.',
  feedbackGithub: 'أو أبلغ عبر GitHub',
  githubRepoLabel: 'الشيفرة المصدرية على GitHub — ‏24pray مفتوح المصدر',
```

- [ ] **Step 4: Komponente**

`/home/pmi/24pray-web/src/components/patterns/FeedbackDialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Github } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Label, FieldError } from '@/components/ui/Label';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export const GITHUB_REPO_URL = 'https://github.com/PhilippMichaly/24pray-web';

/** Feedback ohne Anmeldung (User-Zusatzpunkt): Mini-Dialog → Mail an den Betreiber,
 *  kein Drittanbieter-Widget. Erfolgs-Zustand verweist zusätzlich auf GitHub-Issues. */
export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length < 5) return setError(t('feedbackHint'));
    setError(null);
    setSending(true);
    try {
      await api.post('/feedback', {
        message: message.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        page: typeof window !== 'undefined' ? window.location.pathname : undefined,
      });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function onOpenChange(o: boolean) {
    setOpen(o);
    if (!o) { setDone(false); setMessage(''); setEmail(''); setError(null); }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="underline underline-offset-2 hover:text-ink"
      >
        {t('feedbackLink')}
      </button>
      <Sheet open={open} onOpenChange={onOpenChange} title={t('feedbackTitle')}>
        {done ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-ink">{t('feedbackThanks')}</p>
            <a
              href={`${GITHUB_REPO_URL}/issues`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              <Github size={14} aria-hidden /> {t('feedbackGithub')}
            </a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-ink-muted">{t('feedbackHint')}</p>
            <div>
              <Label htmlFor="fbMessage">{t('feedbackMessageLabel')}</Label>
              <Textarea id="fbMessage" value={message} onChange={(e) => setMessage(e.target.value)}
                        rows={4} maxLength={2000} />
            </div>
            <div>
              <Label htmlFor="fbEmail">{t('feedbackEmailLabel')}</Label>
              <Input id="fbEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <FieldError>{error}</FieldError>
            <div className="flex items-center justify-between gap-3">
              <a
                href={`${GITHUB_REPO_URL}/issues`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                <Github size={13} aria-hidden /> {t('feedbackGithub')}
              </a>
              <Button type="submit" loading={sending}>{t('feedbackSend')}</Button>
            </div>
          </form>
        )}
      </Sheet>
    </>
  );
}
```

(Props-/Export-Namen von `Textarea`/`Sheet` vorher gegen die realen UI-Dateien prüfen — `Textarea` kommt wie in `RequestsFeed.tsx` aus `@/components/ui/Input`, `Sheet` nimmt `open/onOpenChange/title` wie in `SlotSheet`.)

- [ ] **Step 5: Footer-Einbau (beide)**

`AppShell.tsx` — Import `FeedbackDialog` + `Github`; im Footer-`<div>` vor dem Impressum-Teil ergänzen:

```tsx
          <FeedbackDialog />
          <span className="mx-2">·</span>
          <a href="https://github.com/PhilippMichaly/24pray-web" target="_blank" rel="noopener noreferrer"
             aria-label={t('githubRepoLabel')} title={t('githubRepoLabel')}
             className="inline-flex align-middle text-ink-muted hover:text-ink">
            <Github size={14} aria-hidden />
          </a>
          <span className="mx-2">·</span>
```

`(public)/page.tsx` — Landing-Footer analog: `FeedbackDialog` + GitHub-Icon-Link zwischen `earthCredit` und Impressum einfügen (gleiche Struktur wie oben, `·`-Separatoren beibehalten).

- [ ] **Step 6: Suiten laufen lassen — grün**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/pmi/24pray-web
git add src/components/patterns/FeedbackDialog.tsx src/components/patterns/FeedbackDialog.test.tsx src/components/patterns/AppShell.tsx "src/app/(public)/page.tsx" src/lib/i18n.ts
git commit -m "feat(feedback): Footer-Feedback-Dialog + GitHub-Open-Source-Link"
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

- [ ] **Step 2: Backlog — nach Punkt 8 der Web2-Loops neuen Eintrag anhängen**

```markdown
9. ~~**Feedback-Button + Open-Source-Hinweis**~~ (User-Zusatz 2026-07-09) — GEBAUT: Footer-
   „Feedback"-Dialog (Mail an FEEDBACK_TO, keine DB-Speicherung, ohne Login, fail-closed ohne
   Env) + GitHub-Icon-Link auf das öffentliche Repo in beiden Footern; „Auf GitHub melden"-Link
   im Dialog. FEEDBACK_TO beim Deploy in /etc/24pray-api.env setzen (philipp@michaly.de).
```

- [ ] **Step 3: Commit (nur web, kein Push)**

```bash
cd /home/pmi/24pray-web
git add docs/BACKLOG.md
git commit -m "docs(backlog): Feedback-Button + GitHub-Link gebaut (User-Zusatz)"
```
