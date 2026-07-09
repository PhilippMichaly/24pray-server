# Konto-Nutzen sichtbar machen (Backlog 6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nach der Gast-Buchung und auf der Login-Seite sehen Nutzer in drei kurzen Punkten, was ein Konto bringt (alle meine Stunden, Erinnerungs-Einstellungen, Name gemerkt) — sanfte Konversion, kein Zwang.

**Architecture:** Eine kleine wiederverwendbare Komponente `AccountBenefits` (drei Punkte mit Häkchen-Icon, kompakt) wird an zwei Stellen eingebaut: im Gast-Erfolgs-Screen (`GuestBookingForm`, ersetzt/erweitert den bestehenden Ein-Satz-Hinweis `guestAccountOffer`) und auf der Login-Seite (zwischen Subtitle und Formular). i18n als Einzel-Keys (`accountBenefit1..3`), da das Katalog-Muster keine Arrays kennt.

**Tech Stack:** Bestand — keine neuen Dependencies. Nur Web-Repo.

## Global Constraints

- Repo: `/home/pmi/24pray-web` (Branch `main`). Committen ja, **NICHT pushen**.
- **NIEMALS `next build` lokal**; keinen Dev-Server killen.
- i18n: neue Keys in ALLE 5 Kataloge (he/ar verbatim aus diesem Plan). RTL-tauglich: keine physischen Richtungs-Klassen, `ms-`/`me-`/logische Utilities wie im Bestand.
- Suiten: `npx vitest run` + `npx tsc --noEmit` + `npx next lint`. TDD.
- Commit-Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_011CPPASHZYersFD37Auq5kB`

---

### Task 1: `AccountBenefits`-Komponente + Einbau an beiden Stellen

**Files:**
- Create: `/home/pmi/24pray-web/src/components/patterns/AccountBenefits.tsx`
- Test: `/home/pmi/24pray-web/src/components/patterns/AccountBenefits.test.tsx`
- Modify: `/home/pmi/24pray-web/src/components/slots/GuestBookingForm.tsx` (done-Zustand, `guestAccountOffer`-Absatz)
- Modify: `/home/pmi/24pray-web/src/app/auth/login/page.tsx` (sent===false-Zustand, zwischen Subtitle und Form)
- Modify: `/home/pmi/24pray-web/src/lib/i18n.ts` (4 neue Keys in alle 5 Kataloge)

**Interfaces:**
- Consumes: `t` aus `@/lib/i18n`; `CheckCircle2` aus `lucide-react` (im Projekt etabliert).
- Produces: `AccountBenefits({ compact }: { compact?: boolean })` — `compact` (Gast-Screen) rendert text-xs, sonst text-sm (Login).

- [ ] **Step 1: Failing Test schreiben**

`/home/pmi/24pray-web/src/components/patterns/AccountBenefits.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AccountBenefits } from './AccountBenefits';

describe('AccountBenefits (Backlog 6)', () => {
  beforeEach(() => cleanup());

  it('zeigt Titel und drei Nutzen-Punkte', () => {
    render(<AccountBenefits />);
    expect(screen.getByText(/Mit einem Konto/i)).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(3);
    expect(items.map((li) => li.textContent).join(' ')).toMatch(/Stunden/);
    expect(items.map((li) => li.textContent).join(' ')).toMatch(/Erinnerung/);
    expect(items.map((li) => li.textContent).join(' ')).toMatch(/Name/);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd /home/pmi/24pray-web && npx vitest run src/components/patterns/AccountBenefits.test.tsx`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: i18n-Keys (alle 5 Kataloge, neben `guestAccountOffer` einfügen)**

```ts
  // de:
  accountBenefitsTitle: 'Mit einem Konto:',
  accountBenefit1: 'Alle deine Stunden auf einen Blick',
  accountBenefit2: 'Erinnerungen so, wie du sie willst',
  accountBenefit3: 'Dein Name ist gemerkt — nie wieder eintippen',
  // en:
  accountBenefitsTitle: 'With an account:',
  accountBenefit1: 'All your hours at a glance',
  accountBenefit2: 'Reminders the way you want them',
  accountBenefit3: 'Your name is remembered — never type it again',
  // es:
  accountBenefitsTitle: 'Con una cuenta:',
  accountBenefit1: 'Todas tus horas de un vistazo',
  accountBenefit2: 'Recordatorios como tú quieras',
  accountBenefit3: 'Tu nombre queda guardado — no lo escribas más',
  // he:
  accountBenefitsTitle: 'עם חשבון:',
  accountBenefit1: 'כל השעות שלך במבט אחד',
  accountBenefit2: 'תזכורות בדיוק כמו שתרצו',
  accountBenefit3: 'השם שלך נשמר — בלי להקליד שוב',
  // ar:
  accountBenefitsTitle: 'مع حساب:',
  accountBenefit1: 'كل ساعاتك في نظرة واحدة',
  accountBenefit2: 'تذكيرات كما تريدها',
  accountBenefit3: 'اسمك محفوظ — لا حاجة لكتابته مجددًا',
```

- [ ] **Step 4: Komponente**

`/home/pmi/24pray-web/src/components/patterns/AccountBenefits.tsx`:

```tsx
'use client';

import { CheckCircle2 } from 'lucide-react';
import { t } from '@/lib/i18n';

/** Konto-Nutzen (Backlog 6): sanfte Konversion nach Gast-Buchung + auf der Login-Seite — kein Zwang. */
export function AccountBenefits({ compact }: { compact?: boolean }) {
  const size = compact ? 'text-xs' : 'text-sm';
  return (
    <div className={`${size} text-ink-muted`}>
      <p className="font-medium text-ink">{t('accountBenefitsTitle')}</p>
      <ul className="mt-1 space-y-1">
        {(['accountBenefit1', 'accountBenefit2', 'accountBenefit3'] as const).map((key) => (
          <li key={key} className="flex items-start gap-2">
            <CheckCircle2 size={compact ? 13 : 15} className="mt-0.5 shrink-0 text-positive" aria-hidden />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Einbau Gast-Erfolgs-Screen**

In `/home/pmi/24pray-web/src/components/slots/GuestBookingForm.tsx` — Import ergänzen:

```tsx
import { AccountBenefits } from '@/components/patterns/AccountBenefits';
```

Den bestehenden `guestAccountOffer`-Absatz (nach dem Einladungs-Block; `<p className="mt-4 text-xs text-ink-muted">…</p>`) ersetzen durch:

```tsx
        <div className="mt-4 rounded-md bg-surface-sunken p-3 text-start">
          <AccountBenefits compact />
          <p className="mt-2 text-xs text-ink-muted">
            {t('guestAccountOffer')}{' '}
            <Link href="/auth/login" className="text-accent-strong underline underline-offset-2">
              {t('login')}
            </Link>
          </p>
        </div>
```

(`text-start` = logisch, RTL-sicher; `bg-surface-sunken` existiert im File bereits — Zeile ~128.)

- [ ] **Step 6: Einbau Login-Seite**

In `/home/pmi/24pray-web/src/app/auth/login/page.tsx` — Import ergänzen:

```tsx
import { AccountBenefits } from '@/components/patterns/AccountBenefits';
```

Im `sent === false`-Zustand zwischen dem `loginSubtitle`-Element und dem `<form …>` einfügen:

```tsx
          <div className="mb-4 mt-3">
            <AccountBenefits />
          </div>
```

(Exakte Einfügestelle: direkt nach dem Subtitle-`<p>`; die umgebende Card-Struktur unverändert lassen.)

- [ ] **Step 7: Suiten laufen lassen — grün**

Run: `cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint`
Expected: PASS — auch `GuestBookingForm.test.tsx` (der bestehende Erfolgs-Screen-Test) und `login.test.tsx` bleiben grün; falls einer davon auf exakte DOM-Struktur asserted und bricht, Assertion minimal an die neue Struktur anpassen (im Report begründen), NICHT die Komponente verbiegen.

- [ ] **Step 8: Commit**

```bash
cd /home/pmi/24pray-web
git add src/components/patterns/AccountBenefits.tsx src/components/patterns/AccountBenefits.test.tsx src/components/slots/GuestBookingForm.tsx src/app/auth/login/page.tsx src/lib/i18n.ts
git commit -m "feat(account): Konto-Nutzen sichtbar nach Gast-Buchung + auf Login-Seite (Backlog 6)"
```

---

### Task 2: Abschluss — Suiten + Backlog (KEIN Push)

**Files:**
- Modify: `/home/pmi/24pray-web/docs/BACKLOG.md`

- [ ] **Step 1: Suiten**

```bash
cd /home/pmi/24pray-web && npx vitest run && npx tsc --noEmit && npx next lint
```

Expected: grün. (API unberührt — kein api-Lauf nötig.)

- [ ] **Step 2: Backlog — Punkt 6 ersetzen**

```markdown
6. ~~**Konto-Nutzen sichtbar machen**~~ — GEBAUT 2026-07-09 (AccountBenefits-Komponente:
   drei Punkte „alle Stunden / Erinnerungen / Name gemerkt"; im Gast-Erfolgs-Screen kompakt
   unter dem Einladungs-Block, auf der Login-Seite zwischen Subtitle und Formular. Kein Zwang,
   nur Sichtbarkeit.)
```

- [ ] **Step 3: Commit (kein Push)**

```bash
cd /home/pmi/24pray-web
git add docs/BACKLOG.md
git commit -m "docs(backlog): Punkt 6 Konto-Nutzen gebaut"
```
