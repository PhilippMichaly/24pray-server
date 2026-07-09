# Benachrichtigungs-Matrix

**Zweck:** Jede Zelle unten ist eine BEWUSSTE Entscheidung, kein Zufall. Fehlerklasse
"Rolle bekommt stillschweigend keine Benachrichtigung" wurde am 2026-07-09 zweimal live
gefunden (Owner-Buchungsmail fehlte historisch, eingeloggte Bucher bekamen nie eine
Bestätigungsmail — s. `slots.ts:122` Kommentar "Live-Befund 2026-07-09"). Diese Matrix
macht jede Zelle sichtbar, damit "leer" nie mehr "vergessen" bedeutet.

**Änderungsregel:** Neues Ereignis oder neuer Kanal ⇒ im selben Commit: Zeile/Spalte in
dieser Matrix + explizite Entscheidung (Ja mit Beweis-Test ODER Nein mit Begründung).
Kein "mach ich später" — eine leere Zelle ist ein Bug in diesem Dokument.

Legende Zellen:
- `Ja` + Beweis-Spalte (Testdatei:Zeile + Testname) — verifiziert per Lesen der echten Testdatei.
- `Nein — bewusst: <Grund>` — Entscheidung, kein Gap.
- `Nein — technisch unmöglich: <Grund>` — es gibt keinen Kanal (z. B. Gast ohne E-Mail, Push ohne Konto).
- `Nein — OFFEN` — echter Gap ohne gute Begründung; siehe Abschnitt "Offene Zellen" unten.
- `n/a` — Rolle für dieses Ereignis nicht anwendbar (kein Empfänger dieser Art existiert für das Ereignis).

## Matrix

### 1. Buchung (`POST /projects/:id/slots`, `src/routes/slots.ts:72`)

| Rolle | Mail | Beweis | Push | Beweis |
|---|---|---|---|---|
| Gast-Bucher (mit E-Mail) | Ja | `src/routes/slots.test.ts:177` „Gast-Buchung mit E-Mail verschickt Bestätigung mit Kalender-Links" | n/a | technisch unmöglich: Gast hat kein Konto/keine PushSubscription |
| Gast-Bucher (ohne E-Mail) | Nein — technisch unmöglich | Gast ohne E-Mail hat keinen Mail-Kanal (`slotRoutes`: `confirmTo` bleibt leer) | n/a | technisch unmöglich: kein Konto |
| Eingeloggter Bucher | Ja | `src/routes/slots.test.ts:318` „eingeloggter Bucher bekommt Bestätigungs-Mail an die Konto-Adresse (Live-Befund 2026-07-09)" | Nein — bewusst | eigene Aktion, Ergebnis direkt in der UI sichtbar |
| Owner | Ja (nur bei Fremd-/Gastbuchung + `notifyOnBooking`-Flag) | `src/routes/slots.test.ts:192` „wb-notifyOnBooking: Owner bekommt Mail bei Fremd-/Gastbuchung, nicht bei Eigenbuchung, nicht wenn Flag aus" | Nein — OFFEN | Kandidat: Owner-Push bei Fremdbuchung (siehe unten) |
| Teilnehmer (andere) | n/a | Ereignis betrifft nur Bucher + Owner, keine weiteren Teilnehmer | n/a | — |

### 2. Stunden-Erinnerung (`sendDueReminders`, `src/lib/jobs.ts:20`, Cron-Tick alle 60s)

| Rolle | Mail | Beweis | Push | Beweis |
|---|---|---|---|---|
| Gast-Bucher (mit E-Mail) | Ja | `src/routes/community.test.ts:145` „sendDueReminders schickt genau einmal, innerhalb des Vorlaufs" | Nein — technisch unmöglich | Gast hat kein Konto → keine PushSubscription; explizit getestet: `src/lib/jobs.test.ts:113` „Backlog 7: Gast-Slot (ohne userId) erzeugt keinen Push, Job läuft fehlerfrei" |
| Gast-Bucher (ohne E-Mail) | Nein — technisch unmöglich | kein E-Mail-Feld am Slot (`sendDueReminders`: `if (!email) continue`) | n/a | — |
| Eingeloggter Bucher | Ja | `src/lib/jobs.test.ts:73` „Backlog 7: fällige Erinnerung pusht zusätzlich an die Geräte des Users" (Mail-Teil: `reminders.length === 1`) | Ja | `src/lib/jobs.test.ts:73` (gleicher Test, Push-Teil: `pushed[0].endpoint`/`payload.title`) |
| Owner | n/a | Erinnerung ist personenbezogen (pro Slot-Inhaber), kein Owner-Bezug | n/a | — |
| Teilnehmer (andere) | n/a | Erinnerung ist personenbezogen, betrifft nur den Slot-Inhaber selbst | n/a | — |

### 3. Owner-Update im „Neues"-Tab (`POST /projects/:id/requests`, `src/routes/community.ts:107`)

| Rolle | Mail | Beweis | Push | Beweis |
|---|---|---|---|---|
| Gast-Teilnehmer (mit E-Mail) | Ja | `src/routes/community.test.ts:460` „Owner-Update mailt Teilnehmer dedupliziert und lokalisiert, ohne Owner" | Nein — technisch unmöglich | kein Konto → keine PushSubscription (explizit im Testnamen von `community.test.ts:501` „…Gäste nicht") |
| Gast-Teilnehmer (ohne E-Mail) | Nein — technisch unmöglich | `collectUpdateRecipients`: `if (!email) continue` (`community.ts:49`) | n/a | — |
| Eingeloggter Teilnehmer | Ja | `src/routes/community.test.ts:460` (Empfänger `un1-up-member@example.com`) | Ja | `src/routes/community.test.ts:501` „Backlog 7: Owner-Update pusht an Teilnehmer mit Konto+Subscription (Gäste nicht)" |
| Owner (Autor des Updates) | Nein — bewusst | eigene Aktion; `excludeEmail` in `collectUpdateRecipients` schließt den Owner explizit aus (`community.ts:129`) | Nein — bewusst | eigene Aktion, siehe oben |
| Teilnehmer (allgemein) | siehe Gast/eingeloggt oben | — | siehe oben | — |

### 4. Wache verschoben (`POST /projects/:id/shift`, `src/routes/projects.ts:157`)

| Rolle | Mail | Beweis | Push | Beweis |
|---|---|---|---|---|
| Gast-Teilnehmer (mit E-Mail, künftig gebucht) | Ja | `src/routes/projects.test.ts:309` „sendet dedupliziert Zeitplan-Mails an künftige Gebuchte mit alten+neuen Zeiten" | n/a | technisch unmöglich: kein Konto |
| Gast-Teilnehmer (ohne E-Mail) | Nein — technisch unmöglich | `collectFutureBookedRecipients`: `if (!email) continue` (`projects.ts:38`) | n/a | — |
| Eingeloggter Teilnehmer (künftig gebucht) | Ja | `src/routes/projects.test.ts:309` (Empfänger via Konto-E-Mail) | Nein — OFFEN | Kandidat: Push bei Verschiebung (siehe unten) |
| Owner (Akteur) | Nein — bewusst | eigene Aktion | Nein — bewusst | eigene Aktion |
| Teilnehmer (allgemein) | siehe oben | — | siehe oben | — |

### 5. Wache gelöscht (`DELETE /projects/:id`, `src/routes/projects.ts:225`)

| Rolle | Mail | Beweis | Push | Beweis |
|---|---|---|---|---|
| Gast-Teilnehmer (mit E-Mail, künftig gebucht) | Ja | `src/routes/projects.test.ts:557` „sendet dedupliziert Abschieds-Mail an künftige Gebuchte, dann 404" | n/a | technisch unmöglich: kein Konto |
| Gast-Teilnehmer (ohne E-Mail) | Nein — technisch unmöglich | `collectFutureBookedRecipients`: `if (!email) continue` | n/a | — |
| Eingeloggter Teilnehmer (künftig gebucht) | Ja | `src/routes/projects.test.ts:557` | Nein — OFFEN | Kandidat: Push bei Löschung (siehe unten) |
| Owner (Akteur) | Nein — bewusst | eigene Aktion | Nein — bewusst | eigene Aktion |
| Teilnehmer (allgemein) | siehe oben | — | siehe oben | — |

### 6. Storno (`DELETE /slots/:id`, `src/routes/slots.ts:217`)

| Rolle | Mail | Beweis | Push | Beweis |
|---|---|---|---|---|
| Gast-Bucher (eigener Slot, Selbst-Storno per Token) | Nein — bewusst | eigene Aktion | Nein — bewusst | eigene Aktion |
| Eingeloggter Bucher (eigener Slot, Selbst-Storno) | Nein — bewusst | eigene Aktion | Nein — bewusst | eigene Aktion |
| Bucher (fremdes Storno durch Organizer) | Nein — OFFEN | kein Mail-/Push-Code-Pfad in der Route (nur `status: 'CANCELLED'`, keine Benachrichtigung) — Kandidat: Storno-Info an Bucher, wenn Owner storniert | Nein — OFFEN | dito |
| Owner (Storno durch Bucher/Gast) | Nein — OFFEN | dito, kein Code-Pfad | Nein — OFFEN | Kandidat: Storno-Benachrichtigung an Owner |

**Befund:** Storno ist die einzige Ereigniszeile ohne EINE einzige `Ja`-Zelle. `slots.ts:217-233`
enthält keinen `mailer`- oder `pushToUsers`-Aufruf. Nicht implementiert, nicht getestet — echter Gap.

### 7. Login / Magic-Link (`POST /auth/magic-link`, `src/routes/auth.ts:16`)

| Rolle | Mail | Beweis | Push | Beweis |
|---|---|---|---|---|
| Jede Rolle (Login ist rollenneutral, vor Session-Erstellung) | Ja | `src/routes/auth.test.ts:32` „full cycle: magic-link -> verify -> me -> logout" (prüft `captured` = `sendMagicLink`-Aufruf); zusätzlich `src/routes/auth.test.ts:73` „Code-Login: Mail enthält 6-stelligen Code, /auth/verify-code loggt ein" | Nein — technisch unmöglich | Push setzt eine bestehende Session/Konto-Bindung voraus — vor Login nicht adressierbar |

### 8. Feedback (`POST /feedback`, `src/routes/feedback.ts:17`)

| Empfänger | Mail | Beweis | Push | Beweis |
|---|---|---|---|---|
| Betreiber (`FEEDBACK_TO`) | Ja | `src/routes/feedback.test.ts:26` „valides Feedback → 204, Mail an FEEDBACK_TO mit replyTo und page" | n/a | kein Push-Kanal für den Betreiber vorgesehen |
| Feedback-Absender (Gast oder eingeloggt) | Nein — bewusst | Endpoint ist ein Fire-and-Forget-Meldekanal, kein Dialog; Absender erhält HTTP 204 als Bestätigung | Nein — bewusst | dito |

## Offene Zellen (Merkposten)

Ehrlich alles, was heute `Nein` OHNE gute Begründung ist. Nicht umgesetzt — nur gelistet:

1. **Push bei Verschiebung** (Ereignis 4, eingeloggter Teilnehmer) — Mail existiert, Push fehlt.
2. **Push bei Löschung** (Ereignis 5, eingeloggter Teilnehmer) — Mail existiert, Push fehlt.
3. **Owner-Push bei Fremdbuchung** (Ereignis 1, Owner) — Mail existiert (`notifyOnBooking`), Push fehlt.
4. **Storno-Benachrichtigung an Owner** (Ereignis 6) — kein Kanal (weder Mail noch Push), obwohl der
   Owner eine gebuchte Stunde in seiner Wache plötzlich wieder frei sieht.
5. **Storno-Info an Bucher bei Fremd-Storno durch Organizer** (Ereignis 6) — wenn der Organizer
   eine fremde Buchung storniert, erfährt der ursprüngliche Bucher davon nichts.

Diese fünf Punkte sind Kandidaten für eine bewusste Produktentscheidung (Backlog), nicht für
sofortige Implementierung im Rahmen dieser Matrix-Erstellung.
