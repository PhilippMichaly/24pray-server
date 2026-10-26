# Roadmap: 24pray – Freie Zeiträume für Gebetswachen

## Overview

Dieser Meilenstein erweitert die Web-Oberfläche von 24pray (24pray-web) um frei wählbare Endzeitpunkte für Gebetswachen. Phase 1 ermöglicht das Anlegen neuer Wachen mit eigenem Enddatum und Uhrzeit neben den bestehenden Dauer-Presets, inklusive verständlicher Validierung. Phase 2 ergänzt das Bearbeiten des Endzeitpunkts bestehender Wachen mit Schutz bereits gebuchter Slots. Die API ändert sich nicht.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Erstellen mit freiem Endzeitpunkt** - Neue Gebetswachen mit eigenem Enddatum/Uhrzeit statt nur Dauer-Presets anlegen
- [ ] **Phase 2: Bearbeiten des Endzeitpunkts** - Ende bestehender Wachen verlängern/verkürzen, ohne gebuchte Slots zu gefährden

## Phase Details

### Phase 1: Erstellen mit freiem Endzeitpunkt
**Goal**: Organisatoren legen Gebetswachen mit einem eigenen Enddatum samt Uhrzeit an, statt ausschließlich über feste Dauer-Presets
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CREATE-01, CREATE-02, CREATE-03
**Success Criteria** (what must be TRUE):
  1. Organisator kann beim Erstellen einer Gebetswache zusätzlich zu den bisherigen Dauer-Vorschlägen ein eigenes Enddatum mit Uhrzeit eingeben; die Wache wird mit genau diesem Endzeitpunkt angelegt
  2. Organisator kann weiterhin mit einem Klick einen der bisherigen Stunden- oder Tages-Presets auswählen und die Wache wird wie bisher angelegt
  3. Eine mit eigenem Endzeitpunkt angelegte Wache besteht ausschließlich aus vollständigen Stunden- oder Tages-Slots ab dem Projektstart
  4. Ungültige eigene Enden (Ende vor/nicht nach Start, mehr als 366 Tage, kein vollständiger Slot) werden abgelehnt; der Organisator erhält eine verständliche Fehlermeldung in seiner Sprache
**Plans**: 1 plan
**UI hint**: yes

Plans:
- [ ] 01-01-PLAN.md — Custom-End-Erstellung im Dauer-Raster (Validierung, i18n, Payload) in 24pray-web; API unverändert

### Phase 2: Bearbeiten des Endzeitpunkts
**Goal**: Organisatoren verlängern oder verkürzen das Ende bestehender Gebetswachen über die Web-Oberfläche, ohne unvollständige Slots oder bestehende Buchungen zu gefährden
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: EDIT-01, EDIT-02, EDIT-03
**Success Criteria** (what must be TRUE):
  1. Organisator kann das Enddatum mit Uhrzeit einer bestehenden Wache verlängern; alle bisherigen Slots und Buchungen bleiben erhalten
  2. Organisator kann das Ende verkürzen, solange dadurch kein Slot mit bestehender Buchung betroffen ist
  3. Wird beim Verkürzen ein bereits gebuchter Slot ganz oder teilweise außerhalb des neuen Zeitraums liegen, wird die Änderung abgelehnt und der Organisator erhält eine verständliche Fehlermeldung
  4. Ungültige neue Enden (Ende vor/nicht nach Start, mehr als 366 Tage, kein vollständiger Slot) werden beim Bearbeiten abgelehnt mit verständlicher Fehlermeldung
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 02-01: TBD (wird in plan-phase abgeleitet)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Erstellen mit freiem Endzeitpunkt | 0/1 | Not started | - |
| 2. Bearbeiten des Endzeitpunkts | 0/TBD | Not started | - |
