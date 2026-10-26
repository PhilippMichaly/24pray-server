# Phase 1: Erstellen mit freiem Endzeitpunkt - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-26
**Phase:** 1-Erstellen mit freiem Endzeitpunkt
**Areas discussed:** Auswahl des Endes, Datums-/Zeitfeld, Validierung & Fehler

---

## Auswahl des Endes

### 1. Platzierung des Custom-Einstiegs

| Option | Description | Selected |
|--------|-------------|----------|
| Preset-Button | Zusätzlicher Button „Eigener Endzeitpunkt“ im bestehenden Raster; Endfeld darunter, Presets bleiben Ein-Klick-Optionen. | ✓ |
| Modus-Umschalter | Umschalter „Dauer / Endzeitpunkt“ mit deutlicher Trennung, aber zusätzlicher Auswahlebene. | |
| Endfeld immer zeigen | Endfeld dauerhaft sichtbar; Preset-Klick setzt den Wert, aber zwei Eingabewege bleiben sichtbar. | |

**User's choice:** Preset-Button
**Notes:** Vom Nutzer direkt ausgewählt.

### 2. Wechsel der Slot-Aufteilung im Custom-Modus

| Option | Description | Selected |
|--------|-------------|----------|
| Ende beibehalten | Absoluten Endzeitpunkt behalten und für das neue Slot-Modell erneut prüfen. | ✓ |
| Endfeld leeren | Custom-Modus beibehalten, aber Ende neu eingeben lassen. | |
| Zu Preset wechseln | Custom-Modus verlassen und erstes Preset der neuen Liste verwenden. | |

**User's choice:** Ende beibehalten
**Notes:** Vom Nutzer direkt ausgewählt; keine Eingabe soll verloren gehen.

### 3. Nachträgliche Startänderung

| Option | Description | Selected |
|--------|-------------|----------|
| Ende beibehalten | Absolutes Ende behalten und neu validieren. | ✓ |
| Dauer beibehalten | Ende um dieselbe Spanne wie den Start verschieben. | |
| Endfeld leeren | Nach Startänderung eine neue Endeingabe verlangen. | |

**User's choice:** Ende beibehalten, im Auto-Modus als empfohlene Option übernommen
**Notes:** Keine automatische Verschiebung oder Korrektur.

### 4. Preset-Klick im Custom-Modus

| Option | Description | Selected |
|--------|-------------|----------|
| Preset sofort anwenden | Custom-Modus verlassen und Preset-Ende wie bisher verwenden; Custom-Wert nur für erneutes Öffnen behalten. | ✓ |
| Custom-Modus sperren | Presets bis zum ausdrücklichen Verlassen des Custom-Modus nicht anwenden. | |

**User's choice:** Preset sofort anwenden, im Auto-Modus als empfohlene Option übernommen
**Notes:** Im Preset-Modus wird kein Custom-Endwert gesendet.

---

## Datums-/Zeitfeld

### 1. Art des Eingabefelds

| Option | Description | Selected |
|--------|-------------|----------|
| Kombiniertes `datetime-local`-Feld | Wie das vorhandene Startfeld; Datum und Uhrzeit gemeinsam. | ✓ |
| Getrennte Felder | Eigenes Feld für Datum und eigenes Feld für Uhrzeit. | |

**User's choice:** Kombiniertes `datetime-local`-Feld, im Auto-Modus als empfohlene Option übernommen
**Notes:** Bestehendes natives Eingabemuster wiederverwenden.

### 2. Sichtbarkeit und Aktivierung

| Option | Description | Selected |
|--------|-------------|----------|
| Im Custom-Modus, aktiviert nach Startauswahl | Nur im Custom-Modus zeigen; ohne Start deaktiviert und mit Hinweis. | ✓ |
| Immer bedienbar | Eingabe auch ohne Start zulassen. | |
| Endfeld vor Startauswahl ausblenden | Bis zum Start kein Endfeld zeigen. | |

**User's choice:** Im Custom-Modus, aktiviert nach Startauswahl, im Auto-Modus übernommen
**Notes:** Im Custom-Modus ist das Ende ein Pflichtfeld.

### 3. Eingabeauflösung

| Option | Description | Selected |
|--------|-------------|----------|
| Minutengenau mit Validierung | Slot-Ausrichtung prüfen, ohne native Stunden-Beschränkung oder Rundung. | ✓ |
| Auf ganze Uhrzeiten beschränken | Native Auswahl auf volle Stunden begrenzen. | |
| Eingabe automatisch runden | Ungültige Enden auf eine Slot-Grenze verändern. | |

**User's choice:** Minutengenau mit Validierung, im Auto-Modus übernommen
**Notes:** Automatisches Runden ist im Milestone ausdrücklich ausgeschlossen.

### 4. Ausgangswert beim Öffnen

| Option | Description | Selected |
|--------|-------------|----------|
| Aktuelles Preset-Ende vorbefüllen | Bei vorhandenem Start das zuletzt aktive Preset-Ende als bearbeitbaren Ausgangswert nutzen. | ✓ |
| Immer leer beginnen | Keine Vorbefüllung vornehmen. | |

**User's choice:** Aktuelles Preset-Ende vorbefüllen, im Auto-Modus übernommen
**Notes:** Ohne Start bleibt das Feld leer und deaktiviert; spätere Start-/Einheitenwechsel füllen nicht automatisch neu.

---

## Validierung & Fehler

### 1. Zeitpunkt der Validierung

| Option | Description | Selected |
|--------|-------------|----------|
| Bei Blur und Submit | Beim Verlassen und Absenden prüfen; nach Start-/Aufteilungswechsel erneut prüfen. | ✓ |
| Bei jedem Tastendruck | Unmittelbar während jeder Eingabe validieren. | |
| Nur beim Absenden | Keine vorherige Inline-Rückmeldung. | |

**User's choice:** Bei Blur und Submit, im Auto-Modus übernommen
**Notes:** Während einer unvollständigen Ersteingabe noch keinen Fehler zeigen.

### 2. Spezifität der Meldungen

| Option | Description | Selected |
|--------|-------------|----------|
| Eine spezifische Meldung je Regel | Fehlendes Ende, Reihenfolge, 366-Tage-Grenze und Slot-Ausrichtung getrennt erklären. | ✓ |
| Eine allgemeine Datumsfehlermeldung | Alle Fälle mit derselben Meldung behandeln. | |

**User's choice:** Eine spezifische Meldung je Regel, im Auto-Modus übernommen
**Notes:** Alle fünf Sprachen und RTL sind erforderlich.

### 3. Beispiel bei Slot-Ausrichtungsfehlern

| Option | Description | Selected |
|--------|-------------|----------|
| Konkretes gültiges Beispiel zeigen | Nächstmöglichen gültigen Endzeitpunkt nennen, ohne den Wert zu verändern. | ✓ |
| Nur die Regel erklären | Kein konkretes Beispiel anzeigen. | |

**User's choice:** Konkretes gültiges Beispiel zeigen, im Auto-Modus übernommen
**Notes:** Das Beispiel ist eine Hilfe, keine automatische Korrektur.

### 4. Fehlerplatzierung und Submit

| Option | Description | Selected |
|--------|-------------|----------|
| Inline am Endfeld und Submit blockieren | `FieldError` und `invalid`/`aria-invalid` verwenden; ungültig nicht senden. | ✓ |
| Nur allgemeine Fehleranzeige | Fehler nur am Formularende zeigen. | |
| API validieren lassen | Keine clientseitige Fachvalidierung vor dem POST. | |

**User's choice:** Inline am Endfeld und Submit blockieren, im Auto-Modus übernommen
**Notes:** API-Fehler bleiben in der allgemeinen Fehleranzeige.

## Claude's Discretion

Nach Aktivierung des Auto-Modus wurden die jeweils empfohlenen Optionen für die verbleibenden Detailfragen übernommen. State-Struktur, Helper-Aufteilung und konkrete Testimplementierung bleiben Planner/Executor überlassen. Die nicht ausgewählte Zusammenfassung erhält keine erweiterte v1-Darstellung; eine veraltete Preset-Dauer darf im Custom-Modus nicht erscheinen.

## Deferred Ideas

Keine neuen Deferred Ideas aus der Diskussion. CREATE-04 (erweiterte Custom-Zusammenfassung) bleibt v2; das Bearbeiten bestehender Endzeitpunkte bleibt Phase 2.
