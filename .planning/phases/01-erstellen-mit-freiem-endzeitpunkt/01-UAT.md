---
status: complete
phase: 01-erstellen-mit-freiem-endzeitpunkt
source: [01-01-SUMMARY.md, 01-VERIFICATION.md]
started: 2026-10-26T16:24:16Z
updated: 2026-10-26T16:35:32.695Z
---

## Current Test

[testing complete]

## Tests

### 1. Automatisierte Ergebnisse bestätigen
expected: Vier Lieferungen sind durch 41 fokussierte Tests sowie die vollständige Suite mit 234 Tests, TypeScript und Lint nachgewiesen. Bitte bestätigen, damit mit den verbleibenden Browser-Prüfungen fortgefahren wird.
result: pass

### 2. Reine Custom-End-Validierung
expected: Vier Validierungsfälle in fester Reihenfolge, exakt 366 Tage erlaubt, konkretes Beispiel-Ende und beide Slot-Granularitäten.
result: pass
source: automated
coverage_id: D1

### 3. Custom-Modus und exaktes Payload
expected: Fünfter Raster-Button, einmalige Vorbefüllung, minutengenaue Eingabe und exaktes endDate mit passender slotDurationMinutes.
result: pass
source: automated
coverage_id: D2

### 4. Bestehender Preset-Flow
expected: Ein-Klick-Presets und Stunden/Tage-Wechsel bleiben erhalten; Preset-Auswahl verlässt den Custom-Modus und sendet kein gespeichertes Custom-Ende.
result: pass
source: automated
coverage_id: D3

### 5. Lokalisierte Validierungsfehler
expected: Alle vier Fehlerfälle erscheinen unter dem Endfeld mit role=alert und aria-invalid; ungültige Formulare senden kein POST; i18n ist in fünf Locales vollständig.
result: pass
source: automated
coverage_id: D4

### 6. RTL-Rendering der Fehlermeldung
expected: In Locale he (und ar) bleibt die Fehlermeldung mit dem Beispiel-Datum nach einem nicht ausgerichteten Ende visuell korrekt geordnet und lesbar; der Latin-Digit-Datumsteil wird nicht falsch umgeordnet.
result: pass

### 7. Layout und echter Create-Flow
expected: Bei 1440px und 390px sowie in allen fünf Locales erscheinen fünfte Raster-Kachel und Endfeld stimmig. Preset-Wache und Custom-End-Wache lassen sich gegen die echte API mit dem erwarteten Ende und vollständigen Slots anlegen.
result: pass

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
