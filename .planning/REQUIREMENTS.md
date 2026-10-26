# Requirements: 24pray – Freie Zeiträume für Gebetswachen

**Defined:** 2026-10-26
**Core Value:** Organisatoren können die Gesamtdauer ihrer Gebetswache exakt an ihren tatsächlichen Gebetszeitraum anpassen, ohne unvollständige Slots oder bestehende Buchungen zu gefährden.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Erstellen

- [ ] **CREATE-01**: Organisatoren können beim Erstellen einer Gebetswache zusätzlich zu den Dauer-Vorschlägen ein eigenes Enddatum mit Uhrzeit auswählen
- [ ] **CREATE-02**: Organisatoren können weiterhin einen der bisherigen Dauer-Vorschläge für Stunden- oder Tages-Wachen auswählen
- [ ] **CREATE-03**: Beim Erstellen mit eigenem Endzeitpunkt wird sichergestellt, dass das Ende nach dem Start liegt, die Gesamtdauer höchstens 366 Tage beträgt und der Zeitraum ausschließlich vollständige Slots enthält; ungültige Eingaben erhalten eine verständliche Fehlermeldung

### Bearbeiten

- [ ] **EDIT-01**: Organisatoren können das Enddatum mit Uhrzeit einer bestehenden Gebetswache in der Web-Oberfläche verlängern oder verkürzen
- [ ] **EDIT-02**: Beim Bearbeiten wird ein neues Ende mit verständlicher Fehlermeldung abgelehnt, wenn dadurch ein bereits gebuchter Slot ganz oder teilweise außerhalb des Projektzeitraums läge
- [ ] **EDIT-03**: Beim Bearbeiten wird sichergestellt, dass das Ende nach dem Start liegt, die Gesamtdauer höchstens 366 Tage beträgt und der Zeitraum ausschließlich vollständige Slots enthält; ungültige Eingaben erhalten eine verständliche Fehlermeldung

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Erstellen

- **CREATE-04**: Die Zusammenfassung wird für eigene Endzeitpunkte um eine erweiterte Darstellung der tatsächlich gewählten Dauer und des Endzeitpunkts ergänzt

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Änderungen an API-Endpunkten oder API-Verhalten | Der ausdrücklich gewählte Scope umfasst nur die Web-Oberfläche; die vorhandene API wird genutzt |
| Frei definierbare Längen einzelner Gebets-Slots | Das Feature betrifft nur die Gesamtdauer der Gebetswache |
| Automatisches Runden ungültiger Endzeiten | Organisatoren sollen den Zeitraum transparent korrigieren, statt eine automatische Veränderung zu erhalten |
| Automatisches Stornieren gebuchter Slots beim Verkürzen | Bestehende Buchungen werden geschützt; ein Stornierungs- und Benachrichtigungsprozess ist nicht Teil von v1 |
| Unvollständige letzte Slots | Gebetswachen bestehen weiterhin ausschließlich aus vollständigen Stunden- oder Tages-Slots |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CREATE-01 | — | Pending |
| CREATE-02 | — | Pending |
| CREATE-03 | — | Pending |
| EDIT-01 | — | Pending |
| EDIT-02 | — | Pending |
| EDIT-03 | — | Pending |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 0
- Unmapped: 6 — wird bei der Roadmap-Erstellung zugeordnet

---
*Requirements defined: 2026-10-26*
*Last updated: 2026-10-26 after initial definition*
