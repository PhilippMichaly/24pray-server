# Phase 01: Erstellen mit freiem Endzeitpunkt - Research

**Researched:** 2026-10-26
**Domain:** React 18 Client-Komponente (Next.js 15.5) — Formular-Erweiterung, native `datetime-local`-Eingabe, clientseitige Validierung, i18n (5 Kataloge inkl. RTL)
**Confidence:** HIGH

## Summary

Phase 1 ist eine **reine Frontend-Phase** im Repo `24pray-web` (Sibling-Repo zu diesem Planungs-Repo). Das vorhandene zweistufige Erstellungsformular (`src/app/projects/new/page.tsx`) erhält im Dauer-Raster einen fünften Button „Eigener Endzeitpunkt"; im aktiven Custom-Modus erscheint darunter ein natives `datetime-local`-Endfeld. Beim Absenden wird `endDate` — wie der Start bereits heute — per `new Date(localValue).toISOString()` [VERIFIED: 24pray-web/src/app/projects/new/page.tsx:85] in einen ISO-String konvertiert und an die unveränderte `POST /projects`-API geschickt. Die API validiert Spanne (`end > start`, höchstens 366 Tage) bereits serverseitig [VERIFIED: 24pray-api/src/schemas/projects.ts:21-28]; die Slot-Ausrichtung (ganzzahlige 60-/1440-Minuten-Vielfache ab Start) ist **neue clientseitige** Validierung, da die API sie nicht erzwingt [VERIFIED: 24pray-api/src/routes/projects.ts:84 ruft nur `assertProjectSpan`].

Der gesamte benötigte Baustein-Umfang ist im Repo bereits vorhanden und wurde diesen Session direkt aus den Quellen verifiziert: `Input` mit `invalid`/`aria-invalid` [VERIFIED: 24pray-web/src/components/ui/Input.tsx:9-22], `FieldError` mit `role="alert"` [VERIFIED: 24pray-web/src/components/ui/Label.tsx:17-23], der typgesicherte Fünf-Sprachen-Katalog [VERIFIED: 24pray-web/src/lib/i18n.ts:385,743,1102,1461], der zentrale Zeit-Layer [VERIFIED: 24pray-web/src/lib/time.ts] und das Vitest/Testing-Library-Test-Harness mit gemocktem `api.post` [VERIFIED: 24pray-web/src/app/projects/new/new-project.test.tsx:1-21]. **Es werden keine neuen Pakete installiert.**

Die zwei echten Neu-Entwicklungen sind (a) eine kleine, reine Validierungs-/Hilfsfunktion (Custom-End-Validierung + Rundung zum Beispiel-Ende) — extrahierbar und damit direkt unit-testbar ohne Rendering — und (b) ein `Date → "YYYY-MM-DDTHH:mm"`-Formatter für die D-08-Vorbefüllung, der im Zeit-Layer `src/lib/time.ts` ergänzt wird ( dort existiert er noch nicht; `time.ts` hat nur ein privates `pad2` [VERIFIED: 24pray-web/src/lib/time.ts:17-19]).

**Primary recommendation:** Custom-Modus als lokaler `useState`-Zweig in `page.tsx` implementieren (kein neuer Store), Validierungslogik als reine Funktion neben der Seite (ko-lokalisierte Tests), alle sichtbaren Datums-/Zeitformate über `src/lib/time.ts`, alle Texte als neue Keys in allen fünf Katalogen.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Custom-End-Auswahl (Button, Modus-Zustand) | Browser / Client | — | Reine UI-Interaktion im vorhandenen Client-Formular (`'use client'` [VERIFIED: page.tsx:1]) |
| Enddatum-Eingabe (`datetime-local`, minutengenau) | Browser / Client | — | Natives Control, local-time-String im State [CITED: developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local] |
| Validierung (Ende > Start, ≤ 366 Tage, Slot-Ausrichtung) | Browser / Client | API / Backend | Client liefert verständliche, lokalisierte Fehler früh; Server erzwingt Spanne bereits [VERIFIED: schemas/projects.ts:21-28] |
| Persistenz `POST /projects` | API / Backend | — | Endpunkt und Schema unverändert; Payload sendet `startDate`, `endDate`, `timezone`, `slotDurationMinutes` [VERIFIED: page.tsx:81-98] |
| Fehlermeldungen / i18n / RTL | Browser / Client | — | Typgesicherter Katalog, `de` als Source of Truth [VERIFIED: i18n.ts:4, 384-385] |
| Beispiel-Ende bei falscher Ausrichtung (D-13) | Browser / Client | — | Aus verstrichenen ms ab Start berechnet, Formatierung über Zeit-Layer |

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 bis D-14, verbindlich)

**Auswahl des eigenen Endes**
- **D-01:** Das Dauer-Raster erhält einen zusätzlichen Button „Eigener Endzeitpunkt". Bei Auswahl erscheint das Endfeld direkt unter dem Raster; die bisherigen Presets bleiben sichtbar und als Ein-Klick-Auswahl erhalten.
- **D-02:** Der bisherige Ausgangszustand bleibt erhalten: Stunden-Aufteilung und 48-Stunden-Preset. Im normalen Preset-Modus behalten Stunden-/Tageswechsel und Preset-Berechnung ihr bestehendes Verhalten.
- **D-03:** Beim Wechsel zwischen Stunden und Tagen im Custom-Modus bleibt der eingegebene absolute Endzeitpunkt erhalten und wird für das neue Slot-Modell erneut validiert.
- **D-04:** Bei einer nachträglichen Startänderung bleibt das eigene Ende unverändert und wird neu validiert. Es wird weder verschoben noch automatisch angepasst.
- **D-05:** Ein Klick auf ein Dauer-Preset verlässt den Custom-Modus sofort; das Preset bestimmt das Ende wie bisher. Die zuletzt eingegebene Custom-Endzeit bleibt für ein erneutes Öffnen erhalten, wird im Preset-Modus aber nicht gesendet.

**Datums- und Zeitfeld**
- **D-06:** Das eigene Ende verwendet ein kombiniertes natives `datetime-local`-Feld wie das vorhandene Startfeld. Es ist nur im Custom-Modus sichtbar und dort ein Pflichtfeld.
- **D-07:** Ohne Startangabe ist das Endfeld leer und deaktiviert; ein kurzer Hinweis nennt den Start als ersten Schritt. Nach der Startauswahl wird es bedienbar.
- **D-08:** Beim ersten Öffnen des Custom-Modus wird bei vorhandenem Start das Ende des zuletzt aktiven Presets als bearbeitbarer Ausgangswert übernommen. Spätere Start- oder Aufteilungswechsel führen keine automatische Vorbefüllung mehr aus.
- **D-09:** Die Eingabe bleibt minutengenau. Die Slot-Ausrichtung wird validiert, nicht durch automatisches Runden oder eine unpassende native Stunden-Beschränkung erzwungen. Beim Absenden wird der lokale `datetime-local`-Wert wie der Start in ISO konvertiert.

**Validierung und Fehler**
- **D-10:** Clientseitig wird beim Verlassen des Endfelds und beim Absenden validiert. Nach Start- oder Aufteilungswechseln wird ein vorhandenes Ende erneut geprüft. Während einer unvollständigen Ersteingabe erscheint noch kein Fehler.
- **D-11:** Die Validierung unterscheidet vier verständliche Fälle: fehlendes Ende, Ende nicht nach Start, mehr als 366 Tage und keine vollständige Slot-Ausrichtung. Alle neuen Texte werden für `de`, `en`, `es`, `he` und `ar` gepflegt und funktionieren mit RTL.
- **D-12:** Die Slot-Ausrichtung wird anhand der verstrichenen Millisekunden ab dem Start geprüft, konsistent zur bisherigen Preset-Arithmetik: positive Spanne, höchstens 366 Tage und ganzzahlige Vielfache von 60 oder 1440 Minuten. Es findet keine automatische Korrektur statt.
- **D-13:** Bei falscher Slot-Ausrichtung zeigt die Fehlermeldung zusätzlich einen konkreten nächstmöglichen gültigen Endzeitpunkt als Beispiel. Der eingegebene Wert bleibt unverändert.
- **D-14:** Custom-Endfehler erscheinen direkt unter dem Endfeld über das vorhandene `FieldError`; das Feld erhält den vorhandenen `invalid`/`aria-invalid`-Zustand. Ein ungültiges Formular wird nicht abgesendet. API-Fehler und andere Formularfehler bleiben in der allgemeinen Fehleranzeige erhalten.

### Claude's Discretion
- State-Struktur, Aufteilung in Hilfsfunktionen und konkrete Testfälle bleiben dem Planner/Executor überlassen, solange die Entscheidungen oben eingehalten werden.
- Im Custom-Modus darf keine veraltete Preset-Dauer angezeigt werden; die genaue minimale Darstellung bleibt offen. Die erweiterte Custom-Zusammenfassung bleibt ausdrücklich v2 (CREATE-04).

### Deferred Ideas (OUT OF SCOPE)
- Keine — die Diskussion blieb im Phase-Scope. Erweiterte Zusammenfassung eigener Endzeitpunkte bleibt gemäß CREATE-04 für v2 zurückgestellt; das Bearbeiten bestehender Endzeitpunkte gehört zu Phase 2. API, automatisches Runden, unvollständige Slots und einzelne Slot-Längen sind explizit nicht Teil dieser Phase.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CREATE-01 | Organisatoren können beim Erstellen zusätzlich zu den Dauer-Vorschlägen ein eigenes Enddatum mit Uhrzeit auswählen | Custom-Modus-Button im Raster [D-01]; natives `datetime-local`-Feld [D-06, CITED: MDN datetime-local]; unveränderter `POST /projects`-Payload mit custom `endDate` [VERIFIED: page.tsx:81-98] |
| CREATE-02 | Organisatoren können weiterhin einen der bisherigen Dauer-Vorschläge auswählen | Preset-Buttons und `hours`-Arithmetik bleiben unangetastet [VERIFIED: page.tsx:25-39, 60-65, 194-211]; Preset-Klick verlässt Custom-Modus [D-05] |
| CREATE-03 | Ende nach Start, ≤ 366 Tage, ausschließlich vollständige Slots; verständliche Fehlermeldung | API erzwingt Spanne serverseitig [VERIFIED: schemas/projects.ts:21-28]; Slot-Ausrichtung neu clientseitig über ms-Arithmetik [D-12]; vier validierte Fehlerfälle mit i18n-Keys + `FieldError`/`aria-invalid` [D-11, D-14; VERIFIED: Input.tsx:9-22, Label.tsx:17-23] |

## Standard Stack

**Diese Phase installiert keine neuen Pakete.** Der „Standard Stack" ist der bereits im Repo verifizierte Bestand; Aufgaben dürfen keine Alternativen einführen.

### Core (bestehend, aus `24pray-web/package.json` verifiziert)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react / react-dom | ^18.3.0 | Client-State (`useState`, `useMemo`) im Formular | Repo-Pin; `'use client'`-Formular nutzt ausschließlich lokale Hooks [VERIFIED: package.json, page.tsx:3] |
| next | ~15.5.28 | Routing (`useRouter.push` nach Erstellen) | Repo-Pin [VERIFIED: package.json] |
| Vitest + jsdom + Testing Library | vitest ^4.1.10, @testing-library/react ^16.3.2, jsdom ^29.1.1 | Verhaltenstests ko-lokalisiert | Bestehendes Harness inkl. `api.post`-Mock [VERIFIED: new-project.test.tsx:1-21]; Baseline 4/4 grün (Lauf diesen Session) |
| zod ^3.23.0 | — | (nur API-Repo; unverändert) | Kein Eingriff |

### Supporting (vorhandene In-Repo-Komponenten — verpflichtend zu verwenden)

| Asset | Zweck | Verifikation |
|-------|-------|--------------|
| `Input` (`src/components/ui/Input.tsx`) | Endfeld mit `type="datetime-local"`, `invalid`-Prop → `aria-invalid` + `border-danger` | [VERIFIED: Input.tsx:9-22] |
| `Label`, `FieldError` (`src/components/ui/Label.tsx`) | Feld-Label + Inline-Fehler mit `role="alert"` | [VERIFIED: Label.tsx:4-23] |
| `t(key, params?)` / Kataloge (`src/lib/i18n.ts`) | Alle sichtbaren Texte; `{platzhalter}`-Interpolation | [VERIFIED: i18n.ts:1900-1902] |
| `browserTz()`, `formatDayHeader()` (`src/lib/time.ts`) | Zeitzone + zentrale Datumsformatierung | [VERIFIED: time.ts:33-40, 83-89] |
| `api.post` (`src/lib/api.ts`) | Erstellungs-POST, Fehlerweitergabe | [VERIFIED: api.ts:40-42] |

### Alternatives Considered
Keine — Installationsverbot implizit durch Scope (Web-only, keine neuen Dependencies). Kein Date-Picker, keine Formular-Library (conform/react-hook-form), keine Zeit-Bibliothek: Spec §5 erlaubt explizit „Keine Fremd-Lib zwingend nötig; date-fns-tz optional" [CITED: 24pray-web/docs/specs/2026-07-06-design-system-and-slot-grid-spec.md §5], und das Feature reicht mit nativem Control + ms-Arithmetik.

**Installation:** — (keine)

**Version verification:** — (keine neuen Pakete). Bestand verifiziert via `package.json` + erfolgreicher Testlauf `npx vitest run src/app/projects/new/new-project.test.tsx` → 4 passed.

## Package Legitimacy Audit

**Nicht anwendbar — diese Phase installiert keine externen Pakete.** Der Package-Legitimacy-Gate (seam + Registry-Verifikation) entfällt. Bestehende Dependencies wurden beim Projekt-Setup geprüft und sind unverändert.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (React Client, 'use client')                        │
│                                                             │
│  Step 2 Form (page.tsx)                                     │
│  ┌──────────────┐                                           │
│  │ Startfeld    │ datetime-local String (local)             │
│  └──────┬───────┘                                           │
│         ▼                                                   │
│  ┌──────────────┐   Klick „Eigener Endzeitpunkt"            │
│  │ Dauer-Raster │──────────► customMode = true              │
│  │ (4 Presets + │◄────────── Klick Preset (D-05)            │
│  │  Custom-Btn) │              customMode = false           │
│  └──────┬───────┘                                           │
│         ▼                                                   │
│  ┌──────────────────────────┐   disabled solange kein Start │
│  │ Custom-Endfeld           │ (D-07); Pflichtfeld (D-06)   │
│  │ (datetime-local, Minute- │                                │
│  │  genau, keine native     │──onBlur/onChange──┐           │
│  │  Stunden-Beschränkung)   │                   ▼           │
│  └──────────┬───────────────┘        ┌───────────────────┐  │
│             │                        │ validateCustomEnd │  │
│             │    {errorKey, example?}│ (reine Funktion)  │  │
│             │◄───────────────────────│ 1 fehlendes Ende  │  │
│             │                        │ 2 end <= start    │  │
│             ▼                        │ 3 span > 366d     │  │
│  ┌──────────────────────┐            │ 4 ms % slotMs ≠ 0 │  │
│  │ FieldError (role=     │            └───────────────────┘  │
│  │ alert) + aria-invalid │                                   │
│  └──────────────────────┘                                   │
│             │ submit (nur valide)                             │
│             ▼                                                │
│  endDate = new Date(localEnd).toISOString()  [D-09]         │
└─────────────┬───────────────────────────────────────────────┘
              ▼ POST /projects (unverändert)
┌─────────────────────────────────────────────────────────────┐
│ API (24pray-api, out of scope)                              │
│  zod: endDate/startDate datetime [VERIFIED: projects.ts:43-44]│
│  assertProjectSpan: end>start, span ≤ 366·86_400_000 ms      │
│  [VERIFIED: projects.ts:21-28] — Slot-Ausrichtung NICHT      │
│  serverseitig geprüft [VERIFIED: routes/projects.ts:84]     │
└─────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
24pray-web/src/
├── app/projects/new/
│   ├── page.tsx                  # Custom-Modus-Zustand, Endfeld, Payload (primärer Eingriff)
│   ├── new-project.test.tsx      # bestehende Verhaltenstests erweitern
│   └── custom-end.ts             # NEU: reine Validierungs-/Hilfsfunktionen (ko-lokal. Test custom-end.test.ts)
├── components/ui/                # unverändert (Input, Label, FieldError wiederverwenden)
├── lib/
│   ├── time.ts                   # +1 Formatter (Date → datetime-local-String) [D-08]
│   └── i18n.ts                   # neue Keys in de/en/es/he/ar
```

### Pattern 1: Custom-Modus als lokaler Zustand (kein Store)
**What:** Ein `customMode`-Boolean plus `customEnd: string` im bestehenden `useState`-Formularzustand. `endIso`/`hours` bleiben die Quelle im Preset-Modus; im Custom-Modus wird `endDate` aus `customEnd` abgeleitet. Das etablierte Muster „Lokaler Formularzustand mit `useState`, abgeleitete Werte mit `useMemo`; kein neuer globaler Store" gilt unverändert [VERIFIED: page.tsx:45-65].

**When to use:** Immer hier — der Scope der CONTEXT.md verbietet implizit neue State-Infrastruktur.

**Example:**
```typescript
// Ableitung verifiziert am Bestand [VERIFIED: page.tsx:62-65]
const endIso = useMemo(() => {
  if (!startDate) return null;
  if (customMode) return customEnd ? new Date(customEnd).toISOString() : null;
  return new Date(new Date(startDate).getTime() + hours * 3600_000).toISOString();
}, [startDate, hours, customMode, customEnd]);
```

### Pattern 2: Validierung als reine Funktion (testbar ohne DOM)
**What:** Vier validierte Fälle in fester Reihenfolge [D-11, D-12]. Slot-Größe in ms aus `slotDurationMinutes` ableiten; **ms-Arithmetik**, keine Kalenderarithmetik (CONTEXT-Warnung: lokale Kalendertage ≠ 1440-Minuten-Intervalle — DST). Exakt 366 Tage ist erlaubt, die API lehnt nur `> 366·86_400_000` ab [VERIFIED: schemas/projects.ts:24-26].

**Example:**
```typescript
// Skeleton — Werte den verifizierten Quellen entnommen:
// MAX = 366, slotMs ∈ {60·60_000, 1440·60_000} [VERIFIED: schemas/projects.ts:8,48; page.tsx:61]
export type CustomEndError = 'missing' | 'notAfterStart' | 'tooLong' | 'notAligned';

export function validateCustomEnd(
  startMs: number, endMs: number, slotMs: number,
): { key: CustomEndError; exampleMs?: number } | null {
  const span = endMs - startMs;
  if (!(span > 0)) return { key: 'notAfterStart' };
  if (span > 366 * 86_400_000) return { key: 'tooLong' };
  if (span % slotMs !== 0) {
    return { key: 'notAligned', exampleMs: startMs + Math.ceil(span / slotMs) * slotMs };
  }
  return null; // missing wird vor Aufruf (leerer String) behandelt
}
```

### Pattern 3: Neuer Zeit-Formatter im Layer (nicht im App-Code)
**What:** D-08-Vorbefüllung braucht `Date → "YYYY-MM-DDTHH:mm"` in **Browser-Lokalzeit** (der umgekehrte Weg des Starts). Diese Funktion existiert in `time.ts` noch nicht (dort nur `pad2` als Privat-Helper) [VERIFIED: time.ts:17-19]. Sie gehört als `toDateTimeLocalValue(date: Date): string` in den zentralen Layer — Spec §5 verbietet verstreute Datums-/Zeit-Logik im App-Code [CITED: specs/2026-07-06 §5; VERIFIED: time.ts:1-2 „VERBOT von rohem toLocaleString()"].

**Example:**
```typescript
// Muster folgt dem Layer-Stil [VERIFIED: time.ts:17-19, 33-40]
const p2 = (n: number) => n.toString().padStart(2, '0');
export function toDateTimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
```

### Pattern 4: i18n-Key-Erweiterung (Typvollständigkeit als Gate)
**What:** Jeder neue Key zuerst in `de` (`as const`), dann in `en/es/he/ar` — die `Record<keyof typeof de, string>`-Typisierung macht fehlende Übersetzungen zu `tsc`-Fehlern [VERIFIED: i18n.ts:385, 743, 1102, 1461]. Vorhandene Keys `fieldEnd: 'Ende'`, `errDatesRequired`, `errEndAfterStart` sind direkt wiederverwendbar [VERIFIED: i18n.ts:99, 117-118]. Neue Keys (Empfehlung — Benennung im Discretion-Bereich): `durationCustom` (Button, D-01), `customEndStartFirst` (D-07-Hinweis), `errEndMissing`, `errEndTooLong` (Wortlaut an API-Meldung angleichen [VERIFIED: projects.test.ts:245]), `errEndNotAligned` mit `{example}`-Parameter (D-13). RTL bedingt keine Keys, aber logische Tailwind-Klassen (`ms-`/`me-`/`text-start`) — durchgängiges Repo-Muster [CITED: docs/I18N.md].

### Anti-Patterns to Avoid
- **`step`-Attribut zur Slot-Erzwingung:** D-09 verbietet native Stunden-Beschränkung; Default-`step` von `datetime-local` ist 60 s = minutengenau [CITED: MDN datetime-local]. Alignment wird per Skript validiert, nicht per Control erzwungen.
- **Kalenderarithmetik für Tages-Slots:** DST-Tage haben 23/25 h; alle Prüfungen in verstrichenen ms ab Start [D-12].
- **Veraltete Zusammenfassung im Custom-Modus:** Die Summenzeile (page.tsx:297-309) darf im Custom-Modus keine Preset-Stunden/-Tage zeigen; Darstellung ist Discretion, „stale" Anzeige verboten [CONTEXT.md].
- **`toLocaleString()` im App-Code:** Verbot per Spec §5; neue sichtbare Formatierung (u. a. D-13-Beispiel) über `time.ts`-Formatter [VERIFIED: time.ts:1-2].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Datums-/Zeit-Formatierung | Eigene `toLocaleString`-Aufrufe im Formular | `src/lib/time.ts`-Formatter (ggf. +1 Funktion) | Spec-§5-Verbot; Intl-Bidi-/Locale-Fälle (ar mit nativen Ziffern [VERIFIED: i18n.ts:1840-1848]) |
| Validierungsanzeige | Eigene Fehler-Komponente | `FieldError` (`role="alert"`) + `Input invalid` | Barrierefreiheit (`aria-invalid`) bereits abgesichert [VERIFIED: Label.tsx:17-23, Input.tsx:17-18] |
| Übersetzungskataloge | String-Maps ohne Typ | `Record<keyof typeof de, string>`-Kataloge | tsc erzwingt 5-Sprachen-Vollständigkeit [VERIFIED: i18n.ts:385] |
| Slot-Arithmetik | Zweite, abweichende Rechenstelle | Dieselbe ms-Formel wie Presets (`hours * 3600_000` [VERIFIED: page.tsx:64]) mit `slotDurationMinutes * 60_000` | Konsistenz D-12; sonst divergieren Preset- und Custom-Ende |
| Date-Picker-Komponente | npm-Datetime-Picker | natives `datetime-local` | D-06; null Bundle-Kosten, vorhandenes Startfeld als Präzedenz [VERIFIED: page.tsx:154] |

**Key insight:** Das Feature ist zu ~90 % Komposition verifizierter Bestandteile; der Neu-Anteil ist eine kleine reine Funktion plus ein Formatter. Hand-Rolling an diesen zwei Stellen (im Layer) ist genau richtig — überall sonst wäre es Wiederholung vorhandener, getesteter Muster.

## Common Pitfalls

### Pitfall 1: DST/Wandzeit vs. verstrichene Millisekunden
**What goes wrong:** Tages-Modus-Validierung rechnet in lokalen Kalendertagen; über eine DST-Grenze ist „1 Tag" 23 h — Custom-Ende landet fälschlich als „nicht ausgerichtet".
**Why it happens:** Intuition sagt „24×60 Minuten = 1 Tag"; die Preset-Arithmetik des Bestands arbeitet aber strikt in ms (`hours * 3600_000`) [VERIFIED: page.tsx:64].
**How to avoid:** ausschließlich `endMs - startMs` prüfen (D-12); dieselbe Formel für Beispiel-Ende. Testfälle auf DST-freie Daten legen (Bestand nutzt Januar, z. B. `'2099-01-01T00:00'` [VERIFIED: new-project.test.tsx:41]).
**Warning signs:** Tests, die lokal grün sind und auf einem Rechner in anderer TZ/nahe März-Grenze rot werden; `vitest.config.ts` setzt kein `TZ` [VERIFIED: vitest.config.ts:4-10].

### Pitfall 2: 366-Tage-Grenze inkonsistent zur API
**What goes wrong:** Client lehnt exakt 366 Tage ab (oder erlaubt 366 Tage + 1 Minute).
**Why:** Off-by-one durch „>“ vs. „≥". Die API lehnt nur Spanne **strikt größer** `366 * 86_400_000` ab [VERIFIED: schemas/projects.ts:24-26, Wortlaut: `Eine Gebetswache darf höchstens 366 Tage dauern`, projects.test.ts:245].
**How to avoid:** identischen Vergleich `span > 366 * 86_400_000` übernehmen.
**Warning signs:** Payload-Test mit `start + 366d` schlägt clientseitig fehl.

### Pitfall 3: Veraltete Preset-Dauer in der Zusammenfassung
**What goes wrong:** Custom-Modus zeigt weiterhin „48 Stunden ab …".
**Why:** Summenzeile liest `hours` [VERIFIED: page.tsx:297-309], das im Custom-Modus irrelevant ist.
**How to avoid:** Summenzeile im Custom-Modus aus `customEnd` ableiten oder minimal ausblenden (Discretion: keine stale Anzeige).
**Warning signs:** Screenshot-Review: Dauer ändert sich nicht, wenn Custom-Ende editiert wird.

### Pitfall 4: Fehlendes `Date → datetime-local`-Rundreise-Formatting (D-08)
**What goes wrong:** Vorbefüllung `start + 48h` erscheint als UTC-shifted oder im falschen Format; Browser verwirft den Wert (leeres Feld).
**Why:** `datetime-local` akzeptiert nur `YYYY-MM-DDTHH:mm` in **Lokalzeit** [CITED: MDN datetime-local]; `toISOString()` liefert UTC mit `Z`.
**How to avoid:** Formatter Pattern 3 (Lokalzeit-Komponenten, nicht ISO).
**Warning signs:** jsdom-Test: `input.value` leer nach Vorbefüllung.

### Pitfall 5: Validierungstiming (D-10)
**What goes wrong:** Fehler erscheint bereits bei der ersten unvollständigen Tipp-Eingabe („während einer unvollständigen Ersteingabe erscheint noch kein Fehler") oder gar nicht nach Start-/Unit-Wechsel.
**How to avoid:** Validieren auf `blur` des Endfelds und auf `submit`; Revalidierung in den Effekt-/Handler-Pfaden von `selectUnit` und `startDate`-Change (D-03/D-04); kein Fehler bei Fokus/Teileingabe.
**Warning signs:** Test „tippen ohne blur" zeigt sofort `role="alert"`.

### Pitfall 6: Doppel-Fehleranzeige (D-14)
**What goes wrong:** Custom-End-Fehler erscheint zusätzlich zur allgemeinen Fehlerzeile oder ersetzt API-Fehler.
**How to avoid:** Feldfehler lokal am Endfeld (`FieldError` unter dem Feld, `invalid` am `Input`); allgemeine `error`-State-Zeile bleibt für API-/Submit-Fehler [VERIFIED: page.tsx:311]. Submit bei Invalid per `preventDefault` + früher Return stoppen.

## Code Examples

Verifizierte Muster aus den Repos und offiziellen Quellen:

### Vorhandener Start → Payload (die zu kopierende Konvertierung, D-09)
```typescript
// [VERIFIED: 24pray-web/src/app/projects/new/page.tsx:84-85]
const start = new Date(startDate);
// …
startDate: start.toISOString(),
endDate: new Date(start.getTime() + hours * 3600_000).toISOString(),
```
Im Custom-Modus: `endDate: new Date(customEnd).toISOString()` — identisches `new Date(datetimeLocalString)`-Parsing (date-time ohne Offset = Lokalzeit) [CITED: MDN Date; VERIFIED am Bestand page.tsx:64, 77].

### Natives datetime-local (Vertrag)
- Wert immer normalisiert `YYYY-MM-DDTHH:mm`, Anzeige locale-abhängig, kein Offset [CITED: developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local].
- Default `step = 60` (1 Minute) → minutengenaue Eingabe nativ, kein Attribut nötig [CITED: MDN datetime-local].
- HTML-Validierung ersetzt keine Server-Validierung [CITED: MDN datetime-local, Abschnitt „Validation" — deckt sich mit CONTEXT: „Clientvalidierung ergänzt, ersetzt aber nicht die API-Validierung"].

### Bestehende Preset-Struktur (unverändert zu lassen)
```typescript
// [VERIFIED: 24pray-web/src/app/projects/new/page.tsx:25-39]
const HOUR_DURATIONS = [
  { hours: 24, key: 'duration24' },
  { hours: 48, key: 'duration48' },
  { hours: 72, key: 'duration72' },
  { hours: 168, key: 'durationWeek' },
] as const;
const DAY_DURATIONS = [
  { hours: 168, key: 'durationWeek' },
  { hours: 336, key: 'duration2Weeks' },
  { hours: 672, key: 'duration4Weeks' },
  { hours: 960, key: 'duration40Days' },
] as const;
```

### Server-Vertrag (unverändert, aber begrenzend)
```typescript
// [VERIFIED: 24pray-api/src/schemas/projects.ts:8, 21-28, 48]
export const MAX_PROJECT_DAYS = 366;
// assertProjectSpan: !(end > start) → 400 „endDate muss nach startDate liegen"
// span > MAX_PROJECT_DAYS * 86_400_000 → 400 „Eine Gebetswache darf höchstens 366 Tage dauern"
slotDurationMinutes: z.union([z.literal(60), z.literal(1440)]).default(60)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `datetime` (mit TZ) als HTML-Typ | `datetime-local` (local, kein Offset) | HTML5-Reife, `datetime` obsolet | D-06 verlangt explizit `datetime-local`; TZ separat als `timezone`-Payload-Feld [VERIFIED: page.tsx:86] |
| `moment`/Date-Picker-Libraries | natives Control + Intl im zentralen Layer | Repo-Spec §5 (2026-07) | Keine neue Dependency in dieser Phase |
| React 18.3 + Next 15.5 (Repo-Pin) | React 19/Next 15.x aktuell im Ökosystem | 2024-2025 | **Kein Upgrade im Phase-Scope** — Plan muss auf React-18-APIs bleiben |

**Deprecated/outdated:**
- HTML-Input `type="datetime"`: aus dem Spec entfernt, durch `datetime-local` ersetzt [CITED: MDN datetime-local, „Setting timezones"].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Namen/Benennung der neuen i18n-Keys (`durationCustom`, `errEndMissing`, `errEndTooLong`, `errEndNotAligned`, `customEndStartFirst`) und der neuen `time.ts`-Funktion (`toDateTimeLocalValue`) sind Vorschläge im Discretion-Bereich | Patterns 3-4 | Niedrig — Renaming-Kosten nur; Typ-`Record`-Gate fängt fehlende Keys ab |
| A2 | Übersetzungen für `es/he/ar` werden wie im Bestand maschinell erstellt (Muttersprachler-Review offen) [CITED: docs/I18N.md „Übersetzungs-Status"] | Pattern 4 | Niedrig — Qualitätsniveau entspricht Bestand |
| A3 | D-13-Beispiel-Ende wird in Browser-Lokalzeit dargestellt (konsistent zu Eingabe und Start-Summary, die `browserTz()` nutzt [VERIFIED: page.tsx:59, 302]) | Pitfall-Diagramm | Mittel — bei Anzeige in Projekt-TZ statt Browser-TZ keine Korrekturhilfe für die getippte Uhrzeit |
| A4 | `custom-end.ts` als Ko-lokations-Name für die reine Validierungsfunktion; Test `custom-end.test.ts` | Structure | Niedrig |
| A5 | Die API erzwingt Slot-Ausrichtung bewusst nicht (nur Spanne) — Verhalten so belassen, Phase liefert CREATE-03 clientseitig | Summary/Security | Niedrig — durch Scope ausgeschlossen („Keine Änderungen an API-Verhalten"), aber als bekannte Lücke dokumentiert |

**Hinweis:** A1-A5 liegen alle im ausdrücklichen Discretion-Bereich der CONTEXT.md oder sind beobachtete Bestandsfakten; keine der Annahmen widerspricht Locked Decisions.

## Open Questions

1. **Minimale Custom-Zusammenfassung (Discretion)**
   - What we know: Keine veraltete Preset-Dauer anzeigen; erweiterte Zusammenfassung ist CREATE-04/v2.
   - What's unclear: Ob im Custom-Modus eine Minimalzeile (z. B. abgeleitete Dauer aus `customEnd`) oder gar keine Summenzeile gezeigt wird.
   - Recommendation: Executor wählt die kleinste nicht-veraltete Variante (z. B. `formatDayHeader(endIso, tz)`-basierte Endanzeige oder vollständiges Ausblenden); im Plan als Discretion-Entscheidung festnageln.
2. **Format des D-13-Beispiel-Endzeitpunkts**
   - What we know: Sichtbare Datumsformatierung muss über den Zeit-Layer laufen; `formatDayHeader` liefert „Montag, 6. Juli" ohne Uhrzeit/Jahr [VERIFIED: time.ts:33-40].
   - What's unclear: Ob ein neuer `formatDateTimeShort`-Formatter (Tag+Monat+Jahr+Uhrzeit) gebaut oder komponiert wird.
   - Recommendation: Einen kleinen `time.ts`-Formatter ergänzen (ein Ort, testbar, `time.test.ts` erweitern) statt Inline-Komposition im Formular.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vitest/Next-Toolchain | ✓ | v22.22.0 (verifiziert) | — |
| npm | Scripts/Testläufe | ✓ | 11.13.0 (verifiziert) | — |
| Vitest-Harness | Verhaltenstests | ✓ | 4.1.10, Baseline 4/4 grün | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

Step 2.6-Anmerkung: Reine Code-Phase; die API wird in Tests gemockt [VERIFIED: new-project.test.tsx:15-19], kein laufender `24pray-api`-Server nötig.

## Validation Architecture

**SKIPPED** — `.planning/config.json` setzt `workflow.nyquist_validation: false` (explizit). Abschnitt entfällt gemäß Protokoll.

Trotzdem für den Planner dokumentiert (Bestandslage, kein Nyquist-Verfahren): Test-Framework Vitest 4.1.10 (`vitest.config.ts`), Quick-Run `npx vitest run src/app/projects/new/new-project.test.tsx` (1.6 s, 4/4 grün). Neue Tests: Erweiterung von `new-project.test.tsx` (Verhalten/Payload) + ko-lokalisierte Unit-Tests für die reine Validierungsfunktion — deckt CREATE-01/02/03 ab.

## Security Domain

`security_enforcement` ist aktiviert (ASVS Level 1). Bewertung für diese Phase:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unverändert (`useAuth`-Guard [VERIFIED: page.tsx:43, 106-117]) |
| V3 Session Management | no | Unverändert (httpOnly-Cookie-Client [VERIFIED: api.ts:21]) |
| V4 Access Control | no | Unverändert (nur eingeloggte Organisatoren erstellen) |
| V5 Input Validation | **yes** | Client: neue Validierungsfunktion + `preventDefault` bei Invalid (D-14). Server: `zod`-Schema + `assertProjectSpan` bleiben Pflicht [VERIFIED: schemas/projects.ts:40-59, routes/projects.ts:84] |
| V6 Cryptography | no | Nicht betroffen |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Umgehung der Client-Validierung (Crafted Requests) | Tampering | Server-Validierung bleibt bestehen: Spanne (`end>start`, ≤366 Tage) wird API-seitig erzwungen [VERIFIED: schemas/projects.ts:21-28]. **Bekannte, scope-bedingte Lücke:** Slot-Ausrichtung erzwingt die API nicht — ein manipulierter Client könnte unvollständige Slots erzeugen. Ausgeschlossen durch Scope („Keine Änderungen an API-Endpunkten oder API-Verhalten" [VERIFIED: REQUIREMENTS.md „Out of Scope"]) — als Restrisiko dokumentiert, nicht in dieser Phase beheben. |
| XSS durch neue Fehlermeldungen/Beispieltext | Tampering/Info Disclosure | React escaped interpolierte Werte per Default; `FieldError` rendert Strings als Text-Knoten [VERIFIED: Label.tsx:17-23]; keine `dangerouslySetInnerHTML`-Einführung. |
| Phishing über Gruppen-Links | Spoofing | Unberührt (GroupLink-Regex bleibt serverseitig [VERIFIED: schemas/projects.ts:52-54]). |

## Sources

### Primary (HIGH confidence)
- `24pray-web/src/app/projects/new/page.tsx` (komplett gelesen) — Formularzustand, Presets, Payload, Startfeld
- `24pray-web/src/components/ui/Input.tsx`, `Label.tsx` — `invalid`/`aria-invalid`, `FieldError`/`role="alert"`
- `24pray-web/src/lib/i18n.ts` (komplett gelesen) — Katalogstruktur, vorhandene Keys, RTL-Set, Typ-Gate
- `24pray-web/src/lib/time.ts` (komplett gelesen) — Zeit-Layer-Vertrag, fehlende Rundreise-Funktion
- `24pray-web/src/app/projects/new/new-project.test.tsx` (komplett gelesen) — Test-Harness inkl. Mock-Muster
- `24pray-api/src/schemas/projects.ts` (komplett gelesen) — `MAX_PROJECT_DAYS = 366`, `assertProjectSpan`, `slotDurationMinutes`-Union
- `24pray-api/src/routes/projects.ts:84` (geprüft) — Server validiert nur Spanne, keine Slot-Ausrichtung
- `24pray-web/package.json`, `vitest.config.ts` (geprüft) — Versionsstände, keine TZ-Fixierung
- Testlauf diesen Session: `npx vitest run src/app/projects/new/new-project.test.tsx` → 4 passed

### Secondary (MEDIUM confidence)
- [MDN `<input type="datetime-local">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local) — Wertformat `YYYY-MM-DDTHH:mm`, Default-Step 60 s, min/max-Verhalten, „HTML validation is not a substitute for server-side validation"
- [MDN JavaScript `Date`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date) — date-time ohne Offset = Lokalzeit-Parsing
- `24pray-web/docs/I18N.md`, `docs/DESIGN-VISION.md` §3.5, `docs/specs/2026-07-06-design-system-and-slot-grid-spec.md` §5 (Canonical Refs aus CONTEXT.md)

### Tertiary (LOW confidence)
- Keine — alle kernigen Aussagen sind in Repo oder offizieller Doku verankert.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Bestand direkt aus `package.json` + erfolgreichem Testlauf verifiziert; keine neuen Pakete
- Architecture: HIGH — alle Integrationspunkte (page.tsx, UI-Komponenten, i18n, time.ts, api.ts) diesen Session direkt gelesen
- Pitfalls: HIGH — Pitfalls 1/2/4 aus verifizierten Diskretwerten (API-Vergleichsoperatoren, MDN-Vertrag, Layer-Lücken) abgeleitet; Pitfalls 3/5/6 aus Locked Decisions (D-09/D-10/Discretion)

**Research date:** 2026-10-26
**Valid until:** 2026-11-25 (stabiler Stack; nur MDN-Verhalten/Repo-Bestand — kein schnelllebiger Domain-Druck)
