# Phase 1: Erstellen mit freiem Endzeitpunkt - Context

**Gathered:** 2026-10-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Im vorhandenen zweistufigen Erstellungsformular in `24pray-web` können Organisatoren zusätzlich zu den bisherigen Dauer-Presets einen eigenen Endzeitpunkt mit Datum und Uhrzeit wählen. Der gewählte Zeitraum wird über die bestehende `POST /projects`-API angelegt. Ungültige Enden werden im Formular verständlich abgelehnt: Ende nicht nach Start, mehr als 366 Tage oder keine vollständigen 60-/1440-Minuten-Slots ab dem Start.

Phase 1 umfasst CREATE-01, CREATE-02 und CREATE-03. Die API, das Bearbeiten bestehender Wachen, automatisches Runden, unvollständige Slots und Änderungen einzelner Slot-Längen sind nicht Teil dieser Phase.

</domain>

<decisions>
## Implementation Decisions

### Auswahl des eigenen Endes
- **D-01:** Das Dauer-Raster erhält einen zusätzlichen Button „Eigener Endzeitpunkt“. Bei Auswahl erscheint das Endfeld direkt unter dem Raster; die bisherigen Presets bleiben sichtbar und als Ein-Klick-Auswahl erhalten.
- **D-02:** Der bisherige Ausgangszustand bleibt erhalten: Stunden-Aufteilung und 48-Stunden-Preset. Im normalen Preset-Modus behalten Stunden-/Tageswechsel und Preset-Berechnung ihr bestehendes Verhalten.
- **D-03:** Beim Wechsel zwischen Stunden und Tagen im Custom-Modus bleibt der eingegebene absolute Endzeitpunkt erhalten und wird für das neue Slot-Modell erneut validiert.
- **D-04:** Bei einer nachträglichen Startänderung bleibt das eigene Ende unverändert und wird neu validiert. Es wird weder verschoben noch automatisch angepasst.
- **D-05:** Ein Klick auf ein Dauer-Preset verlässt den Custom-Modus sofort; das Preset bestimmt das Ende wie bisher. Die zuletzt eingegebene Custom-Endzeit bleibt für ein erneutes Öffnen erhalten, wird im Preset-Modus aber nicht gesendet.

### Datums- und Zeitfeld
- **D-06:** Das eigene Ende verwendet ein kombiniertes natives `datetime-local`-Feld wie das vorhandene Startfeld. Es ist nur im Custom-Modus sichtbar und dort ein Pflichtfeld.
- **D-07:** Ohne Startangabe ist das Endfeld leer und deaktiviert; ein kurzer Hinweis nennt den Start als ersten Schritt. Nach der Startauswahl wird es bedienbar.
- **D-08:** Beim ersten Öffnen des Custom-Modus wird bei vorhandenem Start das Ende des zuletzt aktiven Presets als bearbeitbarer Ausgangswert übernommen. Spätere Start- oder Aufteilungswechsel führen keine automatische Vorbefüllung mehr aus.
- **D-09:** Die Eingabe bleibt minutengenau. Die Slot-Ausrichtung wird validiert, nicht durch automatisches Runden oder eine unpassende native Stunden-Beschränkung erzwungen. Beim Absenden wird der lokale `datetime-local`-Wert wie der Start in ISO konvertiert.

### Validierung und Fehler
- **D-10:** Clientseitig wird beim Verlassen des Endfelds und beim Absenden validiert. Nach Start- oder Aufteilungswechseln wird ein vorhandenes Ende erneut geprüft. Während einer unvollständigen Ersteingabe erscheint noch kein Fehler.
- **D-11:** Die Validierung unterscheidet vier verständliche Fälle: fehlendes Ende, Ende nicht nach Start, mehr als 366 Tage und keine vollständige Slot-Ausrichtung. Alle neuen Texte werden für `de`, `en`, `es`, `he` und `ar` gepflegt und funktionieren mit RTL.
- **D-12:** Die Slot-Ausrichtung wird anhand der verstrichenen Millisekunden ab dem Start geprüft, konsistent zur bisherigen Preset-Arithmetik: positive Spanne, höchstens 366 Tage und ganzzahlige Vielfache von 60 oder 1440 Minuten. Es findet keine automatische Korrektur statt.
- **D-13:** Bei falscher Slot-Ausrichtung zeigt die Fehlermeldung zusätzlich einen konkreten nächstmöglichen gültigen Endzeitpunkt als Beispiel. Der eingegebene Wert bleibt unverändert.
- **D-14:** Custom-Endfehler erscheinen direkt unter dem Endfeld über das vorhandene `FieldError`; das Feld erhält den vorhandenen `invalid`/`aria-invalid`-Zustand. Ein ungültiges Formular wird nicht abgesendet. API-Fehler und andere Formularfehler bleiben in der allgemeinen Fehleranzeige erhalten.

### Claude's Discretion
- Die ersten beiden Entscheidungen wurden direkt vom Nutzer gewählt. Für die übrigen Detailfragen wurden nach Aktivierung des Auto-Modus die empfohlenen Optionen übernommen.
- State-Struktur, Aufteilung in Hilfsfunktionen und konkrete Testfälle bleiben dem Planner/Executor überlassen, solange die Entscheidungen oben eingehalten werden.
- Die Zusammenfassung wurde nicht als eigener Diskussionsbereich gewählt. Im Custom-Modus darf keine veraltete Preset-Dauer angezeigt werden; die genaue minimale Darstellung bleibt offen. Die erweiterte Custom-Zusammenfassung bleibt ausdrücklich v2 (CREATE-04).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Anforderungen und Scope
- `.planning/PROJECT.md` — Produktkontext, Web-only-Scope, Slot- und Buchungsschutz sowie bereits getroffene Milestone-Entscheidungen.
- `.planning/REQUIREMENTS.md` — CREATE-01 bis CREATE-03, v2-Grenze CREATE-04 und Out-of-Scope-Regeln.
- `.planning/ROADMAP.md` — Phase-1-Ziel und die vier verbindlichen Success Criteria.

### UI, Zeit und Internationalisierung
- `../24pray-web/docs/DESIGN-VISION.md` §3.5 — Bestehende Design- und Zeitdarstellungsregeln, aus `src/lib/time.ts` referenziert.
- `../24pray-web/docs/specs/2026-07-06-design-system-and-slot-grid-spec.md` §5 — Bestehende Datums-/Zeit- und Slot-Grid-Verträge, aus `src/lib/time.ts` referenziert.
- `../24pray-web/docs/I18N.md` — Regeln für vollständige Locale-Kataloge und RTL.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `../24pray-web/src/app/projects/new/page.tsx`: Enthält den kompletten zweistufigen Erstellungsflow, `HOUR_DURATIONS`/`DAY_DURATIONS`, `unit`, `hours`, `startDate`, `endIso`, `selectUnit` und `onSubmit`. Custom-Modus und Endvalidierung integrieren sich hier, ohne die übrigen Formularbereiche zu verändern.
- `../24pray-web/src/components/ui/Input.tsx`: Wiederverwendbares `Input` mit `invalid` und `aria-invalid`; unterstützt native `datetime-local`-Attribute.
- `../24pray-web/src/components/ui/Label.tsx`: `Label` und `FieldError` mit `role="alert"` für die inline Validierung.
- `../24pray-web/src/lib/i18n.ts`: Typisierter Fünf-Sprachen-Katalog mit Deutsch als Source of Truth. `fieldEnd`, `errDatesRequired` und `errEndAfterStart` existieren bereits; Custom-Auswahl, Hinweise und weitere Validierungsfälle benötigen konsistente neue Keys.
- `../24pray-web/src/lib/time.ts`: `browserTz()` und zentrale `Intl.DateTimeFormat`-Formatierung. Neue sichtbare Datums-/Zeitformatierung muss diesem Muster folgen; kein rohes `toLocaleString()` im App-Code.
- `../24pray-web/src/lib/api.ts`: Vorhandenes `api.post` und die gemeinsame Fehlerweitergabe; der Erstellungs-POST sendet bereits `startDate`, `endDate`, `timezone` und `slotDurationMinutes`.

### Established Patterns
- Lokaler Formularzustand mit `useState`, abgeleitete Werte mit `useMemo`; kein neuer globaler Store erforderlich.
- Bestehende Presets berechnen das Ende über Millisekunden ab dem Start. Custom-Validierung muss dieselbe 60-/1440-Minuten-Logik verwenden und darf lokale Kalendertage nicht stillschweigend mit 1440-Minuten-Intervallen gleichsetzen.
- UI-Komponenten verwenden semantische Tailwind-Tokens und logische Eigenschaften; keine neuen Rohfarben.
- Fehler werden lokal als Strings gehalten; `ApiClient` übernimmt die API-Fehlermeldung. Clientvalidierung ergänzt, ersetzt aber nicht die API-Validierung.
- Tests liegen ko-lokalisiert. `../24pray-web/src/app/projects/new/new-project.test.tsx` nutzt Vitest, Testing Library, jsdom und ein gemocktes `api.post`.

### Integration Points
- Primäre Änderung: `../24pray-web/src/app/projects/new/page.tsx` für Auswahlzustand, Endfeld, Validierung und Payload.
- Sichtbare Texte: `../24pray-web/src/lib/i18n.ts` in allen fünf Katalogen; Locale-Vollständigkeit wird durch die vorhandenen Typen/Tests abgesichert.
- Verhaltenstests: `../24pray-web/src/app/projects/new/new-project.test.tsx` sowie bei extrahierter reiner Logik ko-lokalisierte Tests nach bestehendem Muster.
- Keine Änderungen an `24pray-api`, API-Routen, Schemas, Datenbank oder API-Verhalten.

</code_context>

<specifics>
## Specific Ideas

Der eigene Endzeitpunkt soll sich wie eine natürliche Erweiterung des vorhandenen Preset-Rasters anfühlen, nicht wie ein separates Formular. Ein konkretes gültiges Beispiel bei falscher Slot-Ausrichtung soll die Korrektur erleichtern, ohne die Eingabe automatisch zu verändern.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Die erweiterte Zusammenfassung eigener Endzeitpunkte bleibt gemäß CREATE-04 für v2 zurückgestellt; das Bearbeiten bestehender Endzeitpunkte gehört zu Phase 2.

</deferred>

---

*Phase: 1-Erstellen mit freiem Endzeitpunkt*
*Context gathered: 2026-10-26*
