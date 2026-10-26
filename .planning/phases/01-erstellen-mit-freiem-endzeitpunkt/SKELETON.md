# Walking Skeleton — 24pray – Freie Zeiträume für Gebetswachen

**Phase:** 1 (Erstellen mit freiem Endzeitpunkt)
**Generated:** 2026-10-26

> Angepasst an die vorhandene Anwendung: Dieses Projekt ist kein Greenfield — das Skeleton
> zeichnet die bereits getroffenen Architektur-Entscheidungen des Sibling-Repos `24pray-web`,
> auf denen dieser und jeder spätere Vertikal-Slice aufbaut. Es wird keine neue Anwendung
> gescaffolded und kein Backend/UI außerhalb des Phase-Scopes hinzugefügt.

## Capability Proven End-to-End

Eine Organisator:in legt eine Gebetswache mit einem eigenen Enddatum samt Uhrzeit über das
bestehende zweistufige Erstellungsformular an; der unveränderte `POST /projects`-Endpunkt
persistiert die Wache mit exakt diesem Endzeitpunkt und vollständigen Stunden-/Tages-Slots.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15.5 (App Router, gepinnt) + React 18 Client Components (`'use client'`) | Repo-Pin; kein Upgrade im Phase-Scope (RESEARCH „State of the Art") |
| Data layer | Kein eigenes Persistence-Layer im UI — bestehender `ApiClient` (`src/lib/api.ts`) gegen die unveränderte Fastify-API (`POST /projects`) | Milestone-Scope: API besitzt Datumsfelder + Basisvalidierung bereits; UI liefert `startDate`, `endDate`, `timezone`, `slotDurationMinutes` |
| Auth | Bestehender `useAuth`-Guard + Session-Cookie (httpOnly, API-seitig) | Unverändert übernommen; nur eingeloggte Organisatoren:innen erstellen Wachen |
| Zeit-Layer | `src/lib/time.ts` als einzige Formatierungsstelle (Intl-basiert; Verbot rohen `toLocaleString` im App-Code) | Spec §5 / Design-Vision §3.5; D-08/D-13-Formatierung (`toDateTimeLocalValue`, `formatDateTimeShort`) werden diesem Layer hinzugefügt |
| Validierung | Reine Funktion ko-lokalisiert im Feature (`custom-end.ts`, ms-Arithmetik), clientseitig; API erzwingt weiterhin Spanne serverseitig | Slot-Ausrichtung ist bewusst clientseitig (API ändert sich nicht); Identität der 366-Tage-Grenze zur API (`span > 366 * 86_400_000`) |
| i18n | Typgesicherter Fünf-Kataloge (`de` Source of Truth, `Record<keyof typeof de, string>`-Gate), `de/en/es/he/ar` inkl. RTL | tsc erzwingt Locale-Vollständigkeit; neue Keys in D-11 |
| State | Lokaler Formular-State (`useState`/`useMemo`), kein neuer globaler Store | Etabliertes Muster der Seite; Custom-Modus als `customMode`/`customEnd`-State |
| Deployment | Unverändert: zwei Systemd-Units hinter nginx (`/api/` → Fastify, `/` → Next), siehe `deploy/README.md` im API-Repo | Kein Deploy-Anteil in dieser Phase |
| Directory layout | Feature-Ordner unter `src/app/projects/new/` (Seite, Verhaltenstests, neue reine Validierungsdatei `custom-end.ts` + Test) | Ko-lokations-Konvention des Repos |

## Stack Touched in Phase 1

- [x] Routing — bestehende Route `src/app/projects/new/page.tsx` (kein neuer Scaffold)
- [x] Database — genau ein realer Write über die unveränderte API (`POST /projects`, in Tests gemockt; kein laufender API-Server nötig)
- [x] UI — mind. ein interaktives Element (Custom-End-Button + `datetime-local`-Endfeld) wired an den API-Call
- [x] Tests — Vitest 4 + Testing Library + jsdom (`new-project.test.tsx`), reine Unit-Tests (`custom-end.test.ts`, `time.test.ts`); Baseline 4/4 grün
- [x] Deployment — unverändert; dokumentierter lokaler Full-Stack-Lauf: `npm run dev` in `24pray-api` (:3001) und `24pray-web` (:3000)

## Out of Scope (Deferred to Later Slices)

- Bearbeiten/Verlängern/Verkürzen des Endes bestehender Wachen → Phase 2 (EDIT-01 bis EDIT-03, Schutz gebuchter Slots)
- Erweiterte Custom-Zusammenfassung → v2 (CREATE-04)
- API-Änderungen jeder Art (Endpunkte, Verhalten, Schema, Datenbank) — ausgeschlossen per REQUIREMENTS
- Automatisches Runden ungültiger Endzeiten, unvollständige Slots, freie Slot-Längen — ausgeschlossen per REQUIREMENTS
- Neue Drittanbieter-Pakete (Date-Picker, Formular-Libraries, Zeit-Bibliotheken) — verboten per Scope
- Serverseitige Erzwingung der Slot-Ausrichtung — dokumentierte Lücke (RESEARCH A5), bewusst nicht Teil des Meilensteils

## Subsequent Slice Plan

- Phase 2: Organisator:innen verlängern/verkürzen das Ende bestehender Wachen über die Web-Oberfläche, ohne gebuchte Slots zu gefährden (baut auf `custom-end.ts`-Validierung und Zeit-Layer auf)
