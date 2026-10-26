# 24pray – Freie Zeiträume für Gebetswachen

## What This Is

24pray ist eine nichtkommerzielle Plattform, mit der Gemeinden, Hauskreise, Familien und Einzelpersonen Gebetswachen organisieren und Gebets-Slots übernehmen können. Dieser Meilenstein ergänzt die Web-Oberfläche um frei wählbare Endzeitpunkte, damit Organisatoren beim Erstellen und Bearbeiten nicht mehr auf feste Dauer-Vorschläge beschränkt sind.

## Core Value

Organisatoren können die Gesamtdauer ihrer Gebetswache exakt an ihren tatsächlichen Gebetszeitraum anpassen, ohne unvollständige Slots oder bestehende Buchungen zu gefährden.

## Requirements

### Validated

- ✓ Organisatoren können Gebetswachen mit einem freien Start- und Endzeitpunkt über die API anlegen — bestehende API
- ✓ Die API begrenzt Gebetswachen auf höchstens 366 Tage und verlangt ein Ende nach dem Start — bestehende API
- ✓ Gebetswachen verwenden entweder vollständige 60-Minuten-Slots oder vollständige 1440-Minuten-Slots — bestehendes Produktverhalten
- ✓ Das Erstellungsformular bietet feste Dauer-Vorschläge für Stunden- und Tages-Wachen — bestehende Web-Oberfläche
- ✓ Organisatoren können den Zeitpunkt einer Gebetswache verschieben; gebuchte Slots werden dabei mit verschoben — bestehendes Produktverhalten

### Active

- [ ] Organisatoren können beim Erstellen zusätzlich zu den bisherigen Vorschlägen einen eigenen Endzeitpunkt auswählen
- [ ] Organisatoren können das Ende einer bestehenden Gebetswache über die Web-Oberfläche ändern
- [ ] Eigene Endzeitpunkte werden auf vollständige Stunden- beziehungsweise Tages-Slots ab dem Projektstart ausgerichtet
- [ ] Ein eigenes Ende nach dem Start und innerhalb der bestehenden Maximaldauer wird mit verständlicher Validierung sichergestellt
- [ ] Beim Bearbeiten wird ein neues Ende abgelehnt, wenn dadurch bereits gebuchte Slots außerhalb des Zeitraums lägen
- [ ] Die bisherigen Dauer-Vorschläge bleiben als schnelle Auswahl erhalten

### Out of Scope

- Erweiterte Zusammenfassung eigener Endzeitpunkte — auf v2 verschoben; v1 konzentriert sich auf Auswahl, Bearbeitung und Validierung
- Änderungen an API-Endpunkten oder API-Verhalten — der gewünschte Scope ist ausschließlich die Web-Oberfläche; die vorhandenen API-Fähigkeiten werden genutzt
- Frei definierbare Längen einzelner Gebets-Slots — das Feature betrifft nur die Gesamtdauer der Gebetswache
- Automatisches Runden beliebiger Endzeiten — ungültige Endzeiten werden stattdessen erklärt und abgelehnt
- Automatisches Stornieren gebuchter Slots beim Verkürzen — bestehende Buchungen werden geschützt
- Unvollständige letzte Slots — alle Wachen bestehen weiterhin ausschließlich aus vollständigen Slots

## Context

Das Produkt besteht aus zwei unabhängigen Repositories: der Fastify-/SQLite-API unter `/home/pmi/24pray-api` und der Next.js-Web-Oberfläche unter `/home/pmi/24pray-web`. Die Implementierung dieses Meilensteins gehört in `24pray-web`; die Planungsartefakte liegen im aktuellen API-Repository.

Die API akzeptiert bei `POST /projects` und `PATCH /projects/:id` bereits ISO-Zeitwerte für `startDate` und `endDate`. `assertProjectSpan` stellt sicher, dass das Ende nach dem Start liegt und die Spanne höchstens 366 Tage beträgt. Die aktuelle Web-Oberfläche berechnet das Ende beim Erstellen dagegen ausschließlich aus festen Stunden-Presets. Beim Bearbeiten bietet `ScheduleCard` derzeit nur das Verschieben des gesamten Zeitplans an.

Die Web-Oberfläche verwendet Next.js 15, React 18, TypeScript, TailwindCSS, eigene UI-Komponenten und einen zentralen API-Client. Sie unterstützt Deutsch, Englisch, Spanisch, Hebräisch und Arabisch einschließlich RTL. Neue sichtbare Texte müssen deshalb in das bestehende i18n-System eingepasst werden.

Für das Bearbeiten wurde der sichere Umgang mit Buchungen festgelegt: Verlängern und Verkürzen sind grundsätzlich möglich, aber ein neues Ende darf keinen bereits gebuchten Slot abschneiden. Es gibt keine automatische Stornierung in diesem Meilenstein.

## Constraints

- **Scope**: Nur `24pray-web` — die API besitzt die benötigten Datumsfelder und Basisvalidierungen bereits
- **Slot-Modell**: 60 oder 1440 Minuten — freie Endzeiten müssen vollständige Slots ab dem Start ergeben
- **Projektdauer**: Höchstens 366 Tage — bestehende API-Grenze bleibt unverändert
- **Buchungen**: Kein gebuchter Slot darf durch ein neues Projektende abgeschnitten werden — Buchungen und deren Historie bleiben geschützt
- **Internationalisierung**: Neue UI-Texte müssen alle fünf vorhandenen Sprachen und RTL unterstützen
- **Kompatibilität**: Bestehende Dauer-Presets und das Verschieben des gesamten Zeitplans bleiben erhalten

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Freie Eingabe erfolgt als Enddatum und Uhrzeit statt als Zahl mit Einheit | Organisatoren sollen den konkreten Abschluss der Wache direkt bestimmen | — Pending |
| Änderung nur in der Web-Oberfläche | Die API unterstützt freie Start- und Endzeitpunkte bereits | — Pending |
| Freie Endzeiten beim Erstellen und Bearbeiten | Die gewünschte Flexibilität gilt über den gesamten Projekt-Lebenszyklus | — Pending |
| Ungültige Endzeiten ablehnen statt runden | Der gewählte Zeitraum bleibt transparent und es entstehen keine unvollständigen Slots | — Pending |
| Gebuchte Slots beim Verkürzen schützen | Bestehende Zusagen dürfen nicht ohne ausdrücklichen Stornierungsprozess verloren gehen | — Pending |
| Bestehende Presets beibehalten | Häufige Zeiträume bleiben schnell auswählbar; eigene Endzeiten sind eine Ergänzung | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-26 after initialization*
