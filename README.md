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

## Deployment

**Vollständiges, reproduzierbares Runbook:** [`deploy/README.md`](deploy/README.md)
— VPS-Erst-Setup (Härtung, systemd, nginx, Backup), Update-Deploy,
Domain/HTTPS (certbot), SMTP, Betrieb & Troubleshooting, Secrets-Inventar.
Design/API-Spec: `docs/specs/2026-06-15-24pray-api-design.md`.
