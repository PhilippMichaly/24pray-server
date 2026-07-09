# 24pray-api

Backend der Gebetsketten-Plattform **https://24pray.org**.
Fastify + SQLite (Prisma) + Magic-Link-Auth (passwortlos).

## Entwicklung

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev   # http://localhost:3001
```

Ohne `SMTP_URL` werden Magic-Links in die Konsole geloggt **und**
`/auth/magic-link` liefert `{devLoginUrl}` zurück (Testmodus — das Frontend
zeigt dann einen Direkt-Login-Button). Mit gesetztem `SMTP_URL` gehen echte
Mails raus und der Testmodus verschwindet automatisch.

```bash
npm test   # Vitest: Auth (inkl. StrictMode-Idempotenz), Slots (Grid/Booking/
           # Gast-Token), Community (Invite-Zugriff, Feed-Masking, Stats,
           # Reminder-Job, Recurring, Geo-Privacy), CORS
```

## Domänen-Überblick

- **Projekte** = Gebetsketten (Zeitraum, Slot-Dauer, PUBLIC/PRIVATE mit
  Invite-Token, optionaler Standort für den Landing-Globus)
- **Slots** = Stunden der Kette; buchbar eingeloggt oder als Gast
  (Gast-Storno per `guestToken`); optionaler Beter-Standort (nur Koordinaten)
- **Jobs** (minütlich): abgelaufene Slots → COMPLETED (Statistik),
  Erinnerungs-Mails (Vorlauf je User-Preference)
- **Community**: Anliegen-Feed, Statistik, `/stats/public` (Globus-Punkte +
  Beter-Links mit „betet gerade"-Flag; niemals Namen/Titel)
- **Privacy**: Namen werden für anonyme Betrachter serverseitig maskiert
  („Ruth Klein" → „Ruth K."); öffentliche Geo-Daten sind reine Koordinaten

## Endpunkte (Kurzreferenz)

**Auth** (`src/routes/auth.ts`)
- `POST /auth/magic-link` — E-Mail rein, Link+6-stelliger Code raus (rate-limited 5/min/IP).
  Ohne `SMTP_URL` liefert die Response direkt `{devLoginUrl}` (Testmodus).
- `POST /auth/verify` — Token aus dem Link einlösen → Session-Cookie. Idempotent für
  30s nach Verbrauch (React-StrictMode feuert den Aufruf doppelt).
- `POST /auth/verify-code` — 6-stelliger Code (Alternative für ein anderes Gerät ohne
  Zugriff auf den Link), 5 Fehlversuche sperren den Code.
- `GET /auth/me` — aktueller User aus der Session. `POST /auth/logout` — Session invalidieren.
- `PATCH /me` — Anzeigename ändern. `DELETE /me` — Konto löschen (eigene Projekte komplett
  weg, Buchungen in fremden Ketten: COMPLETED anonymisiert, Rest gelöscht).

**Projects** (`src/routes/projects.ts`)
- `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`
- `POST /projects/:id/shift` — Wache verschieben (Ersteller-only, Zwei-Phasen-Update s.u.),
  mailt allen mit künftigen Buchungen die neue Zeit.
- `DELETE /projects/:id` — Wache löschen (Ersteller-only), mailt Abschieds-Notiz an alle
  mit künftigen Buchungen, danach Kaskade über Prisma-FKs (Slots/Memberships/…).
- `GET /join/:token` — Invite-Auflösung für PRIVATE-Ketten.
- Relevante Felder auf dem Projekt: `maskNames` (Namens-Kürzung Opt-in, Default aus),
  `notifyOnBooking` (Owner-Mail bei Fremdbuchung, Default an), `linkWhatsapp` /
  `linkTelegram` / `linkSignal` (nur https + Domain-Whitelist), `slotDurationMinutes`
  (`60` = Stunden-Wache, `1440` = Tages-Wache, kein Zwischenwert).

**Slots** (`src/routes/slots.ts`)
- `GET /projects/:id/slots` — Grid (Organizer, Mitglied oder `?invite=<token>`).
- `POST /projects/:id/slots` — buchen, eingeloggt oder als Gast (`guestName` Pflicht,
  `guestEmail` optional). Doppelbuchung wird von der DB abgelehnt (P2002 → 409), nicht
  von App-Logik.
- `DELETE /slots/:id?guestToken=…` — stornieren (Bucher, Organisator, oder Gast per Token).
- `POST /slots/:id/recur` — „jede Woche übernehmen", materialisiert echte Folge-Slots
  bis Projektende, überspringt belegte Wochen statt abzubrechen.
- `GET /slots/:id/ics` — Kalendereintrag über die unerratbare Slot-ID (kein Auth nötig).

**Community** (`src/routes/community.ts`)
- `GET/POST /projects/:id/requests` — Anliegen-Feed; POST ist **owner-only** (eine Wache
  = ein Anliegen, alle anderen tragen nur Gebetsstunden bei).
- `GET /projects/:id/stats` — Stunden pro Person aus COMPLETED-Slots.
- `GET /stats/public` — gecachte Landing-Statistik (aktive Ketten, gehaltene Slots,
  Beter-Standorte für den Globus — nie Namen/Titel).
- `GET /geocode?q=` — Orts-Autocomplete über den FTS5-Präfix-Index (`city_fts`),
  rate-limited 60/min.

## Betriebs-Eigenheiten

- **SQLite WAL + partieller Unique-Index**: Buchung ist atomar über
  `PrayerSlot_active_slot_unique` (`projectId`, `startTime` WHERE `status IN (BOOKED,
  COMPLETED)`) statt App-seitiger Transaktion — unter Last serialisierte
  `findFirst`+`create` sonst in Prisma-Transaction-Timeouts. Kollision landet als
  Prisma-`P2002` und wird zu HTTP 409 gemappt. `CANCELLED` bleibt re-buchbar.
- **Zwei-Phasen-Shift** (`POST /projects/:id/shift`): eine einzige `startTime =
  startTime + delta`-UPDATE-Zeile verletzt denselben partiellen Unique-Index, sobald ein
  Slot beim Verschieben auf die noch-unverschobene Zeit eines anderen rutscht — SQLite
  prüft die Constraint pro Zeile während eines Multi-Row-UPDATE, nicht erst am Ende. Fix:
  Phase 1 verschiebt alle Zeiten um `delta + OFFSET` (OFFSET ≈126.900 Jahre in ms, weit
  außerhalb jedes realen Epoch-Werts), Phase 2 zieht OFFSET wieder ab — dann sind bereits
  alle Zeilen uniform verschoben, keine Kollision mehr möglich.
- **Fehlerbehandlung**: `app.setErrorHandler` (`src/app.ts`) unterscheidet 4xx (Zod-
  Validierungsfehler + bewusste `httpError`-Meldungen aus den Routen — gehen unverändert
  raus) von ≥500 (interner Fehler, potenziell SQL/Constraint/Stacktrace-Fragmente in
  `err.message`) — Fix vom 2026-07-09: 500er werden serverseitig geloggt (`console.error`)
  und geben nur noch den neutralen Text `"Serverfehler"` an den Client zurück, statt die
  Rohmeldung zu leaken.
- **Jobs** (`src/lib/jobs.ts`, minütlicher Tick mit Overlap-Guard — ein langsamer SMTP-Tick
  darf sich nicht stapeln): `completeElapsedSlots` (BOOKED → COMPLETED nach Ablauf, Basis
  der Statistik), `sendDueReminders` (Vorlauf je User-Preference, default 60 min, max.
  24h-Fenster), `cleanupExpired` (abgelaufene Sessions sofort, abgelaufene MagicTokens
  nach 1h Kulanzfenster).
- **Mails** (`src/lib/mailer.ts`): Magic-Link (+Code), Erinnerung, Buchungsbestätigung
  (Gast mit E-Mail), Buchungs-Notiz an den Owner (Opt-out per `notifyOnBooking`),
  Zeitplan-Änderung (bei Wache-Verschieben), Abschieds-Mail (bei Wache-Löschen).
  **Falle:** Strato-SMTP verlangt CRLF-Zeilenenden — betrifft sowohl den Mailer als auch
  Shell-Mails im Selfcheck-Skript (`sed 's/$/\r/'`).

## Deployment

**Vollständiges, reproduzierbares Runbook:** [`deploy/README.md`](deploy/README.md)
— VPS-Erst-Setup (Härtung, systemd, nginx, Backup), Update-Deploy,
Domain/HTTPS (certbot), SMTP, Betrieb & Troubleshooting, Secrets-Inventar.
Design/API-Spec: `docs/specs/2026-06-15-24pray-api-design.md`.
