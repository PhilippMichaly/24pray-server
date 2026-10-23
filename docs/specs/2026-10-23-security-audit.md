# Security-Audit 24pray-api + 24pray-web (2026-10-23)

Zwei Audits (API, Web), danach jeder Fund von einem zweiten Reviewer (Fable) im Code nachgeprüft.
Schweregrade sind die **korrigierten** Werte aus dem Review. Fix-Plan:
`docs/superpowers/plans/2026-10-23-security-hardening.md`.

## API (`/home/pmi/24pray-api`)

| ID | Schwere | Ort | Befund |
|---|---|---|---|
| A1 | hoch | `src/app.ts:40` | Kein `trustProxy` → hinter nginx ist `req.ip` immer 127.0.0.1 → alle Rate-Limits global → 5 Magic-Link-Requests/min sperren den Login für alle. Tests merken es nicht (`inject({ remoteAddress })`). |
| A2 | hoch | `src/lib/mailer.ts:291,300,308,318,335,346` | Name/Titel/URL unescaped in Mail-HTML; Gastbuchung ohne Login, ohne Limit, `guestName` unbegrenzt, `guestEmail` frei → Phishing-Relay über `no-reply@24pray.org`. |
| A3 | hoch | `src/schemas/projects.ts:14,45`, `src/routes/projects.ts:147`, `src/lib/slotGrid.ts:48`, `src/routes/slots.ts:210` | Projektdauer unbegrenzt (PATCH prüft nicht einmal end>start) → `GET /projects/:id/slots` baut Millionen Objekte synchron → Prozess-Crash; `recur` hält SQLite stundenlang. |
| A4 | mittel | `src/routes/slots.ts:73-117,141` | Buchen prüft weder `canReadProject` noch Status → Fremder wird Mitglied privater Wachen (Anliegen, Namen), auch PAUSED/ARCHIVED. Kein Invite-Rotieren, kein Mitglied-Entfernen. |
| A5 | mittel | `src/routes/projects.ts:52,65,97` | `POST /projects` ohne Limit, `GET /projects` ohne `take`, Admin-Mail pro Projekt. |
| A6 | mittel | `src/routes/auth.ts:104-111` | Code-Fehlversuche pro Token statt pro Nutzer; jeder neue Magic-Link = 5 neue Versuche; Check+Increment nicht atomar. Muss mit A1 zusammen behoben werden. |
| A7 | hoch (latent) | `src/routes/auth.ts:44` | Leeres `SMTP_URL` ⇒ `devLoginUrl` für jede Adresse = Kontoübernahme. Kein Gate (API-Unit setzt kein `NODE_ENV`). |
| A8 | niedrig | `src/env.ts:22` | `UNSUBSCRIBE_SECRET` Default öffentlich, leerer String akzeptiert (README-Template leer) → fremde Abmeldelinks fälschbar. |
| A9 | niedrig | `slotGrid.ts:57`, `community.ts:101,207`, `projectView.ts:96` | `maskNames` nur für Anonyme; jedes Konto sieht Klarnamen. |
| A10 | niedrig | `src/routes/push.ts:8` | Push-Endpoint beliebige URL → blinde SSRF (POST). |
| A11a | niedrig | `src/routes/auth.ts:26` | Unauth Magic-Link ändert Locale fremder Konten. |
| A11b | niedrig | `src/lib/calendar.ts:31` | ICS: `\r` nicht entfernt → Property-Injection durch Organizer-Titel. |
| A11c | niedrig | `src/routes/funnel.ts:42` | Funnel-Token nicht timing-safe, im Query (→ Access-Log). |
| A11d | mittel | nginx | Keine Security-Header live (HSTS, nosniff, Referrer-Policy, frame-ancestors), Versionsbanner. |
| A11e | niedrig | `Dockerfile` | Läuft als root. |
| A11f | niedrig | `deploy/24pray-api.service` | Repo-Unit veraltet, ohne Hardening (Prod folgt README-Unit). |
| A11g | mittel | `deploy/README.md:235-241` | Backup per `cp` bei WAL → inkonsistent; umask 022 → 0644. |
| A11h | niedrig | `deploy/24pray-selfcheck.sh:45-56` | SMTP-Passwort in Python-Quelltext interpoliert, `curl --user` in Prozessliste. |
| A12 | mittel | `package-lock.json` | proxy-addr 2.0.7, fastify 4.29.1 (4.x ohne Fixes), nodemailer 6.10.1, fast-uri. |
| N1 | mittel | `src/routes/slots.ts:79-83` | `startTime` nicht aufs Raster und nicht auf Zukunft geprüft → Unique-Index per ms-Offset umgehbar (unbegrenzte Geister-Buchungen, Mail-Bombing des Owners), Vergangenheits-Buchungen fälschen `completedHours`. |
| N2 | niedrig | `src/schemas/projects.ts:16,47` | Timezone nicht als IANA validiert → ICS/Mails des Projekts 500/still kaputt. |
| N3 | niedrig | `src/schemas/projects.ts:11,13,37` | `title`/`description` ohne `max`. |
| N4 | niedrig | `src/routes/auth.ts:17-40` | Magic-Link legt für jede Adresse einen User an, nie aufgeräumt; kein Limit pro Adresse. |
| N5 | niedrig | `src/routes/slots.ts:195-236` | `recur` ohne Status-Checks (Basis CANCELLED, Projekt PAUSED). |
| N6 | Prozess | `src/routes/auth.test.ts:74-107` | Rate-Limit-Tests umgehen den Proxy-Pfad. |
| N8 | info | `access.ts:17`, `slots.ts:249` | Secret-Vergleiche mit `===`. |
| N9 | niedrig | `src/server.ts:18` | API bindet 0.0.0.0, nur ufw schützt. |
| N10 | niedrig | `src/routes/me.ts:30-66` | `DELETE /me` lässt `UpdateOptOut`-E-Mail zurück; `guestEmail` ohne Retention. |
| N11 | niedrig | nginx | Tokens (Invite-Pfad, guestToken, Unsubscribe-sig, Funnel-Token) im Access-Log. |

## Web (`/home/pmi/24pray-web`)

| ID | Schwere | Ort | Befund |
|---|---|---|---|
| W1 | hoch | `package.json` | next 14.2.35, 25 Advisories, 14.x ohne Fixes (RSC-DoS, Middleware-Redirect-Cache-Poisoning). Image-RCE nicht ausnutzbar (kein sharp). |
| W2 | mittel | `next.config.mjs`, nginx | Keine Security-Header, `X-Powered-By: Next.js`. |
| W3 | niedrig | `src/app/auth/verify/page.tsx:33-44` | Login-CSRF: `?token=` wird ohne Klick eingelöst; Token bleibt in der URL. |
| W4 | niedrig | `src/lib/api.ts:88` | `guestToken` im Query → Access-Log. |
| W5 | info | `src/app/join/[token]/page.tsx:27`, `watch-client.tsx:76` | Pfadparameter ohne `encodeURIComponent`. |
| W6 | niedrig | `src/lib/time.ts:120` | ICS `\r`. |
| W7 | niedrig | `.github/workflows/ci.yml` | Actions per Tag, kein `permissions:`. |

## Bewusst nicht umgesetzt

- **N7** Push-Upsert hängt fremde Subscription um, wenn der Endpoint bekannt ist — Endpoint ist selbst ein Geheimnis, Besitzerwechsel im selben Browser ist gewollt.
- **Gast-Bestätigungsmail mit inviteToken** (`slots.ts:141`) — dokumentierter Trade-off; mit Invite-Rotation (Plan Task 7) vertretbar.
- Browser-Bindung des Magic-Links — würde den Cross-Device-Code-Login brechen.

## Geprüft und sicher

Tokens 256 Bit, nur gehasht gespeichert; keine Konten-Enumeration; Session-Cookie HttpOnly + SameSite=Lax; CORS exakte Allowlist (live geprüft); alle `$queryRaw`/`$executeRaw` parametrisiert, FTS-Phrase gequotet; Berechtigungen bei PATCH/shift/DELETE/Anliegen/Storno korrekt; `guestToken`/`inviteToken` nicht in Listen; JSON-LD escaped `<`; Gruppenlinks per Regex auf Dienst-Domains beschränkt; keine Open Redirects; Service Worker cached nichts; keine Secrets in der Git-History beider Repos.
