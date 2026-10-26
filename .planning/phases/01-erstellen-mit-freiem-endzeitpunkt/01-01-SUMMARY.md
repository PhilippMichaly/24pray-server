---
phase: 01-erstellen-mit-freiem-endzeitpunkt
plan: 01
subsystem: ui
tags: [react, nextjs, i18n, rtl, datetime-local, validation, vitest]

# Dependency graph
requires:
  - phase: (keine — erste Phase)
    provides: Bestehendes Erstellungsformular, POST /projects-API, Zeit-Layer, i18n-Kataloge
provides:
  - Custom-End-Validierung (validateCustomEnd) mit vier Fehlerfällen und API-identischer 366-Tage-Grenze
  - Custom-Modus im Erstellungsformular (fünfter Raster-Button, datetime-local-Endfeld, Submit-Gate)
  - Zeit-Layer-Erweiterungen (toDateTimeLocalValue, formatDateTimeShort)
  - Fünf neue i18n-Keys in de/en/es/he/ar
affects: [phase-02-bearbeiten, custom-end, time-layer, i18n]

# Actuals (#2632) — chars/4 über dem realisierten Diff (24pray-web, 5f7141b..HEAD)
actuals:
  tokens: 7700
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []  # keine neuen Pakete (Plan-Verbot eingehalten)
  patterns:
    - "Reine ms-Arithmetik für Spanne und Slot-Ausrichtung (keine Kalenderrechnung, DST-frei)"
    - "Validierung als reine Funktion ko-lokalisiert zur Seite (testbar ohne DOM)"
    - "Fehlertexte als lokaler String-State + FieldError/aria-invalid; API-Fehler bleiben in der allgemeinen Zeile"

key-files:
  created:
    - ../24pray-web/src/app/projects/new/custom-end.ts
    - ../24pray-web/src/app/projects/new/custom-end.test.ts
  modified:
    - ../24pray-web/src/app/projects/new/page.tsx
    - ../24pray-web/src/app/projects/new/new-project.test.tsx
    - ../24pray-web/src/lib/time.ts
    - ../24pray-web/src/lib/time.test.ts
    - ../24pray-web/src/lib/i18n.ts

key-decisions:
  - "Summenzeile im Custom-Modus vollständig ausgeblendet (kleinste nicht-veraltete Variante, Pitfall 3) statt abgeleiteter Endanzeige mit neuem Key"
  - "D-13-Beispiel-Ende via formatDateTimeShort in Browser-Lokalzeit (RESEARCH-A3), nie rohe Konkatenation"
  - "errEndTooLong-Wortlaut deckungsgleich mit API-Meldung (Eine Gebetswache darf höchstens 366 Tage dauern)"
  - "TDD je Task mit einem atomischen Commit pro Task (workflow.tdd_mode=false — keine separaten RED-Commits)"

patterns-established:
  - "Pattern: Custom-Modus als lokaler useState-Zweig (customMode/customEnd/customEndError), endIso-Ableitung mit Custom-Zweig"
  - "Pattern: Revalidierung eines bestehenden Werts in den Handlern, die seine Gültigkeit verändern (Start-Change D-04, selectUnit D-03), nie auto-rewrite der Eingabe"

requirements-completed: [CREATE-01, CREATE-02, CREATE-03]

coverage:
  - id: D1
    description: "Reine Validierungsfunktion validateCustomEnd: vier Fälle in fester Reihenfolge, API-identische 366-Tage-Grenze (exakt 366 erlaubt), Beispiel-Ende bei falscher Ausrichtung, beide Slot-Granularitäten"
    requirement: CREATE-03
    verification:
      - kind: unit
        ref: "tests/../24pray-web/src/app/projects/new/custom-end.test.ts#validateCustomEnd-Suites (10 Tests, u. a. exakt 366 Tage null für beide Slots, 366 Tage + 1 Minute tooLong, 90 Minuten notAligned exampleMs, 71 h → +3 Tage)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Custom-Modus im Erstellungsformular: fünfter Raster-Button, einmalige Vorbefüllung (D-08), minutengenaue datetime-local-Eingabe, Payload endDate = new Date(customEnd).toISOString() mit passender slotDurationMinutes"
    requirement: CREATE-01
    verification:
      - kind: integration
        ref: "tests/../24pray-web/src/app/projects/new/new-project.test.tsx#Custom-Modus/Validierungs-UX (Vorbefüllung 48 h, Payload exakt + slotDurationMinutes 60/1440, router.push)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Preset-Flow unverändert: ein-Klick-Presets, Stunden/Tage-Wechsel, Preset-Klick verlässt Custom-Modus und sendet gespeichertes Custom-Ende nicht (D-05); bestehende 4 Tests grün"
    requirement: CREATE-02
    verification:
      - kind: integration
        ref: "tests/../24pray-web/src/app/projects/new/new-project.test.tsx#bestehende 4 Tests + Preset-Klick verlässt den Custom-Modus"
        status: pass
    human_judgment: false
  - id: D4
    description: "Vier validierte Fehlerfälle lokalisiert unter dem Endfeld (FieldError role=alert, aria-invalid), Submit-Blockade ohne POST, Beispiel-Ende bei Misalignment, keine Doppelanzeige mit API-Fehlerzeile, in allen fünf Locales, RTL-sicheres Markup"
    requirement: CREATE-03
    verification:
      - kind: unit
        ref: "tests/../24pray-web/src/app/projects/new/new-project.test.tsx#Validierungs-UX (Blur-Timing, kein POST, errEndAfterStart-Text, D-13-Beispiel, D-04/D-03-Revalidierung, Pitfall 6, errEndMissing, 1440-Payload)"
        status: pass
      - kind: other
        ref: "command: npx tsc --noEmit (Record-Gate beweist Schlüssel in allen 5 Katalogen); grep -c errEndNotAligned=5, durationCustom=5; npm run lint → No ESLint warnings or errors"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-10-26
status: complete
---

# Phase 01 Plan 01: Erstellen mit freiem Endzeitpunkt Summary

**Custom-End-Erstellung im Dauer-Raster von 24pray-web: fünfter Button „Eigener Endzeitpunkt", minutengenaues datetime-local-Endfeld, clientseitige Slot-Ausrichtungs-Validierung mit vier lokalisierten Fehlerfällen (de/en/es/he/ar, RTL-sicher), exakter ISO-Payload über die unveränderte POST /projects-API.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-10-26T15:45:16Z
- **Completed:** 2026-10-26T15:57:05Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Organisatoren können im Erstellungsformular zusätzlich zu den Dauer-Presets einen eigenen Endzeitpunkt (Datum + Uhrzeit, minutengenau) eingeben; die Wache wird mit exakt diesem Ende angelegt (CREATE-01, D-01/D-06/D-08/D-09).
- Der Preset-Ein-Klick-Flow inkl. Stunden/Tage-Wechsel arbeitet unverändert; ein Preset-Klick verlässt den Custom-Modus sofort und sendet die gespeicherte Custom-Endzeit nie mit (CREATE-02, D-02/D-05).
- Vier validierte Fehlerfälle (fehlend, nicht nach Start, > 366 Tage, nicht slot-ausgerichtet) blockieren den Submit lokalisiert unter dem Endfeld mit aria-invalid; bei falscher Ausrichtung nennt die Meldung ein konkretes nächstes gültiges Ende (CREATE-03, D-11/D-12/D-13/D-14).
- Keine API-/Schema/DB-Änderung; 24pray-api Produktionsbaum unberührt; keine neuen Pakete.

## Task Commits

**Cross-Repo-Hinweis (Pflicht gemäß Auftrag):** Alle Produktions-Commits dieser Phase liegen im Sibling-Repo **`/home/pmi/24pray-web`** (Branch `main`), nicht in diesem Planungs-Repo. Der GSD-Evaluation-Scope-Befehl kann sie hier nicht entdecken. Verifikation bitte direkt im Web-Repo:

```bash
git -C /home/pmi/24pray-web log --oneline 5f7141b..main
```

Each task was committed atomically:

1. **Task 1: End-to-end Custom-Modus, Endfeld, Validierung, Payload (Tracer)** - `d0543c1` (feat)
2. **Task 2: Validierungs-UX — Blur-/Submit-Timing, Beispiel-Ende, keine stale Summe** - `6d23251` (feat)
3. **Task 3: Edge-Härtung und Gesamtverifikation** - `1438009` (test)

**Plan metadata:** docs(01-01)-Commit in diesem Repo (SUMMARY + STATE/ROADMAP/REQUIREMENTS, siehe `git log` hier).

RED/GREEN-Evidenz (TDD je Task, ein atomischer Commit pro Task — tdd_mode=false, keine separaten RED-Commits):
- **Task 1 RED:** 5 Tests failed / 15 passed (`custom-end.test.ts` Modul fehlte, `toDateTimeLocalValue` fehlte, 3 Verhaltenstests fanden keinen Custom-Button). **GREEN:** 28/28, danach tsc OK, grep 5/5, Vollsuite 221/221.
- **Task 2 RED:** 8 Tests failed / 21 passed (Blur/D-04/D-03 zeigten nichts, D-13-Beispiel ohne Uhrzeit, veraltete Summenzeile). **GREEN:** 37/37, tsc OK, Vollsuite 230/230.
- **Task 3:** Härtungs-/Charakterisierungstests ohne neue Produktionslogik (liefen gegen die bestehende Implementation grün ein) — bewusst, da Task 3 laut Plan nur Tests + Verifikation definiert.

## Files Created/Modified
- `../24pray-web/src/app/projects/new/custom-end.ts` (neu) — CustomEndError-Typ + validateCustomEnd (reine ms-Arithmetik)
- `../24pray-web/src/app/projects/new/custom-end.test.ts` (neu) — Unit-Tests: vier Fälle, 366er-Grenze (API-Parität), beide Slotgrößen
- `../24pray-web/src/app/projects/new/page.tsx` — Custom-Modus-Zustand, fünfter Raster-Button, Endfeld, Submit-Gate, endIso-Ableitung, Revalidierung (D-03/D-04/D-10), Summenzeilen-Bedingung
- `../24pray-web/src/app/projects/new/new-project.test.tsx` — 13 neue Verhaltenstests (Vorbefüllung, Payload 60/1440, Preset-Exit, Blur-Timing, vier Fehlerfälle, Beispiel-Ende, Pitfall 6)
- `../24pray-web/src/lib/time.ts` — toDateTimeLocalValue (D-08), formatDateTimeShort (D-13)
- `../24pray-web/src/lib/time.test.ts` — Rundreise-Test + formatDateTimeShort-Test (UTC/Europe-Berlin-Literale)
- `../24pray-web/src/lib/i18n.ts` — durationCustom, customEndStartFirst, errEndMissing, errEndTooLong, errEndNotAligned ({example}) in de/en/es/he/ar

## Decisions Made
- Summenzeile im Custom-Modus **ausgeblendet** statt Endanzeige mit neuem Key: kleinste nicht-veraltete Variante (Pitfall 3), kein sechster i18n-Key nötig, kein RTL/Bidi-Risiko durch „Ende:"-Konstrukt.
- D-13-Beispiel-Ende wird in Browser-Lokalzeit formatiert (RESEARCH-A3), konsistent zur Eingabe und Start-Summary.
- Preset-Buttons zeigen im Custom-Modus keinen aktiven Preset mehr (`!customMode && hours === d.hours`) — der Custom-Button ist die einzige aktive Kachel; kein Preset-Zustand wird verändert, nur nicht mehr als „aktiv" angezeigt.

## Deviations from Plan

### Planmäßige, vom Auftrag erzwungene Abweichung: Cross-Repo-Commits
- **Found during:** gesamte Plan-Ausführung
- **Issue:** Der Plan adressiert Dateien unter `../24pray-web`, aber das Planungs-/Orchestrator-Repo ist `24pray-api`. Der GSD-Evaluation-Scope kann die Web-Repo-Commits nicht als Produktions-Commits dieses Repos entdecken.
- **Fix:** Produktions-Commits atomisch in `24pray-web` (d0543c1, 6d23251, 1438009); ausschließlich SUMMARY/Tracking-Metadaten in `24pray-api`. Kein Produktionscode wurde in `24pray-api` gefaked oder hinüberkopiert; Verifikation via `git -C /home/pmi/24pray-web log`.
- **Verification:** `git -C /home/pmi/24pray-web log --oneline 5f7141b..main` zeigt genau die drei Task-Commits; `git -C /home/pmi/24pray-api status` zeigt keinerlei src/-Änderung.
- **Committed in:** siehe Task Commits

### Auto-fixed Issues

**1. [Rule 1 - Bug im eigenen Test] Falsches Erwartungsliteral bei 1440er-notAligned-Beispiel**
- **Found during:** Task 1, GREEN-Phase (`custom-end.test.ts`)
- **Issue:** Test erwartete `exampleMs = start + 2 Tage` für die Eingabe „2 Tage + 23 Stunden" (71 h). Korrekt ist `start + 3 Tage` (nächstes 24-h-Vielfaches ≥ 71 h = 72 h); die Produktionslogik war richtig, das Test-Literal falsch.
- **Fix:** Erwartung auf `startMs + 3 * DAY` korrigiert, Testnamen präzisiert.
- **Files modified:** `../24pray-web/src/app/projects/new/custom-end.test.ts`
- **Verification:** Fokussierter Vitest-Lauf grün (28/28).
- **Committed in:** d0543c1 (Task 1)

**2. [Rule 1 - Test-Harness] `mockResolvedValueOnce`-Queue verursachte Reihenfolge-abhängigen Fehlslag**
- **Found during:** Task 2, RED-Phase (`new-project.test.tsx`)
- **Issue:** Der neue Pitfall-6-Test lief isoliert grün, im Datei-Kontext rot: frühere Tests ohne Submit hinterließen unverbrauchte `mockResolvedValueOnce`-Werte (`clearAllMocks` leert die Once-Queue nicht), sodass der erste POST des Reject-Tests den veralteten Resolve-Wert konsumierte und `waitFor` im Timeout landete.
- **Fix:** `post.mockReset()` zu Beginn des betroffenen Tests — Verhalten gegen den Mock-Vertrag, kein Produktionscode angefasst.
- **Files modified:** `../24pray-web/src/app/projects/new/new-project.test.tsx`
- **Verification:** Gesamte Testdatei grün im Gesamtlauf; Vollsuite 234/234.
- **Committed in:** 6d23251 (Task 2)

---

**Total deviations:** 1 planmäßige Cross-Repo-Deviation (vom Auftrag angeordnet) + 2 auto-fixed (1 Test-Literal, 1 Test-Harness-Mock)
**Impact on plan:** Keine Auswirkung auf Produktionscode oder Scope; beide Auto-Fixes ausschließlich in Testdateien, kein Scope Creep.

## Issues Encountered
- Abgesehen von Deviation 2 (Mock-Once-Queue): keine. Blur-/Submit-Timing, Revalidierung und die 366-Tage-Grenze funktionierten nach dem planmäßigen Umbau auf Anhieb grün.

## User Setup Required
None - no external service configuration required.

## Verification Results (alle tatsächlich ausgeführt, Stand Abschluss)
- `cd ../24pray-web && npx vitest run src/app/projects/new/custom-end.test.ts src/app/projects/new/new-project.test.tsx src/lib/time.test.ts` → **3 files passed, 41/41 Tests**
- `cd ../24pray-web && npm test` (Vollsuite) → **37 files passed, 234/234 Tests**
- `cd ../24pray-web && npx tsc --noEmit` → **exit 0**
- `cd ../24pray-web && npm run lint` → **✔ No ESLint warnings or errors**
- `cd ../24pray-web && npm run build` → ** erfolgreich** (`/projects/new` als ƒ server-rendered, 8.93 kB)
- `grep -c errEndNotAligned src/lib/i18n.ts` → **5**; `grep -c durationCustom src/lib/i18n.ts` → **5**
- ROADMAP-Erfolgskriterien: 1 → D2-Tests; 2 → D3-Tests; 3 → D1-Tests; 4 → D4-Tests (jeweils mind. ein automatisierter Test)
- `24pray-api` Produktionsbaum (`src/`, `deploy/`, `prisma/`, `scripts/`, `package.json`): **keine Änderung** (git diff leer)

## Next Phase Readiness
- Phase 2 (Bearbeiten des Endzeitpunkts) kann planen: `validateCustomEnd`, `formatDateTimeShort` und `toDateTimeLocalValue` sind wiederverwendbar; die Fehlertexte sind bereits für alle fünf Locales gepflegt.
- Keine Blocker. Bekanntes Restrisiko (RESEARCH-A5, scope-bedingt): Die API erzwingt die Slot-Ausrichtung nicht serverseitig — dokumentiert, bewusst nicht Teil dieser Phase.

## Self-Check: PASSED
- Key-Files existieren auf Disk (custom-end.ts, custom-end.test.ts, page.tsx, new-project.test.tsx, time.ts, time.test.ts, i18n.ts) ✓
- Evaluation-Scope im Web-Repo: 3 Task-Commits auf `main` ✓ (in diesem Repo bewusst nur Metadaten — siehe Cross-Repo-Hinweis)
- Alle Task-Acceptance-Criteria erneut geprüft und grün (tsc, fokussierte Vitest, grep 5/5, Lint, Build, Vollsuite) ✓
- Plan-Level-Verifikation komplett ausgeführt und oben dokumentiert ✓

---
*Phase: 01-erstellen-mit-freiem-endzeitpunkt*
*Completed: 2026-10-26*
