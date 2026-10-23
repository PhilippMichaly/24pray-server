# 24pray — Deployment-Runbook (VPS, from zero → live)

Reproduzierbare Anleitung für das komplette Produktions-Setup. So wurde
**https://24pray.org** am 2026-07-07/08 aufgesetzt (Strato V-Server,
Ubuntu 26.04 LTS, 4 vCPU / 8 GB / 232 GB — kleinere Stufen reichen auch:
die App läuft auf SQLite + Node, 2 GB RAM genügen).

Architektur auf einen Blick:

```
Browser ──HTTPS──▶ nginx ──▶ /      → Next.js  (127.0.0.1:3000, systemd 24pray-web)
                         └─▶ /api/  → Fastify  (127.0.0.1:3001, systemd 24pray-api)
                                        └─ SQLite  /opt/24pray/data/24pray.db
Magic-Link-/Reminder-Mails ──▶ smtp.strato.de:465 (Postfach no-reply@24pray.org)
```

Web und API teilen sich eine Origin (`/api/` wird per nginx auf die API
gemappt, Prefix wird gestrippt) → **kein CORS, keine Cookie-Probleme**, und
das Web-Build referenziert nur `NEXT_PUBLIC_API_URL=/api` (relativ) —
ein Domain-Wechsel braucht **kein** Rebuild.

---

## 0. Voraussetzungen

- VPS mit Ubuntu 24.04+ (26.04 bringt Node 22 direkt aus dem Ubuntu-Repo)
- Domain (hier: bei Strato, Nameserver `rzone.de`)
- Lokal: die beiden Repos `24pray-api` + `24pray-web`, `rsync`, `ssh`

**SSH-Key für das Deployment erzeugen (lokal):**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/24pray_vps -N "" -C "24pray-deploy"
cat ~/.ssh/24pray_vps.pub   # bei der VPS-Bestellung hinterlegen, sonst Schritt 1b
```

## 1. Erstzugang + SSH-Härtung

```bash
IP=217.154.240.224   # eure VPS-IP

# 1b. Falls der Key nicht schon bei der Bestellung hinterlegt wurde (einmalig mit Passwort):
ssh root@$IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '<INHALT von 24pray_vps.pub>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

SSH="ssh -i ~/.ssh/24pray_vps -o IdentitiesOnly=yes root@$IP"
$SSH "echo KEY_LOGIN_OK"   # muss ohne Passwort klappen, sonst NICHT weitermachen

# Passwort-Login abschalten + initiales Root-Passwort verbrennen
$SSH "echo root:\$(openssl rand -base64 24) | chpasswd &&
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' \
    > /etc/ssh/sshd_config.d/99-hardening.conf &&
  systemctl reload ssh"
```

Rettungsanker bei ausgesperrtem Key: die VNC-/Seriell-Konsole im Strato-Panel.

## 2. Basissystem: Pakete, Firewall, User, Verzeichnisse

```bash
$SSH 'export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx ufw fail2ban rsync curl nodejs npm
node -v   # >= 22 erwartet (Ubuntu 26.04); ältere Ubuntus: NodeSource nutzen

ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban

useradd -r -m -d /opt/24pray -s /usr/sbin/nologin pray
mkdir -p /opt/24pray/{api,web,data,backup}
chown -R pray:pray /opt/24pray'
```

## 3. Code auf den Server (rsync, ohne lokale Artefakte)

```bash
RS="rsync -az --delete -e 'ssh -i ~/.ssh/24pray_vps -o IdentitiesOnly=yes' \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude data --exclude .env --exclude .env.local --exclude .env.production \
  --exclude .superpowers --exclude docs --exclude coverage"
eval $RS ~/24pray-api/ root@$IP:/opt/24pray/api/
eval $RS ~/24pray-web/ root@$IP:/opt/24pray/web/
$SSH 'chown -R pray:pray /opt/24pray'
```

## 4. Builds

```bash
# API: deps → Prisma-Client → tsc
$SSH 'cd /opt/24pray/api && sudo -u pray npm ci --silent &&
  sudo -u pray npx prisma generate && sudo -u pray npm run build'

# Web: API-Basis ist RELATIV (/api) → überlebt Domain-Wechsel ohne Rebuild
$SSH 'cd /opt/24pray/web &&
  printf "NEXT_PUBLIC_API_URL=/api\nNEXT_PUBLIC_APP_URL=https://24pray.org\n" | sudo -u pray tee .env.production >/dev/null &&
  sudo -u pray npm ci --silent && sudo -u pray npx next build'
```

## 5. API-Environment (`/etc/24pray-api.env`, chmod 600)

```bash
$SSH 'cat > /etc/24pray-api.env <<EOF
PORT=3001
# Basis der Magic-Links UND CORS-Origin. Phase 1 (nur IP): http://<IP>
# Nach Domain+HTTPS (Schritt 9): https://24pray.org
APP_URL=http://217.154.240.224
DATA_DIR=/opt/24pray/data
DATABASE_URL=file:/opt/24pray/data/24pray.db
SESSION_TTL_DAYS=30
# Phase 1 (HTTP): false — nach HTTPS zwingend true
COOKIE_SECURE=false
# SMTP-Versand der Magic-Links. Gesetzt = echter Versand.
# Ein leeres SMTP_URL liefert KEINEN Login-Link mehr in der Response; das macht nur
# DEV_LOGIN_RESPONSE=true, und das gehoert NIE in diese Datei (nur lokal/E2E; mit
# COOKIE_SECURE=true oder https-APP_URL verweigert die API den Start).
SMTP_URL=
SMTP_FROM=24pray <no-reply@24pray.org>
# Signiert Abmelde-Links der Update-Mails (Backlog 1). Mit gesetztem SMTP_URL Pflicht,
# mind. 32 Zeichen, sonst startet die API nicht: UNSUBSCRIBE_SECRET=<openssl rand -hex 32>
UNSUBSCRIBE_SECRET=
# Bind-Adresse der API; Default 127.0.0.1 (nginx davor). Nicht auf 0.0.0.0 setzen.
# HOST=127.0.0.1
# Lese-Token fuer GET /stats/funnel (Backlog 8) — lang+zufaellig; leer = Endpoint aus (404)
FUNNEL_TOKEN=
# Empfaenger der Nutzer-Feedback-Mails (Footer-Dialog) — leer = Feature aus (404)
FEEDBACK_TO=
# Betreiber-Benachrichtigungen: neue Wache, neues Konto, jede Buchung.
# Leer = kein Versand. Achtung: diese Mails enthalten Klartext-Namen und -Adressen der
# Nutzer — nur an ein Postfach schicken, das du selbst kontrollierst.
ADMIN_NOTIFY_TO=
# Web-Push VAPID (Backlog 7) — erzeugen mit: npx web-push generate-vapid-keys; leer = Push aus
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:no-reply@24pray.org
# Empfaenger der Alarm-Mails des VPS-Selbstchecks (Monitoring, deploy/24pray-selfcheck.sh).
# Leer = Selbstcheck mailt nicht, schreibt nur ins Journal. Von der API nicht gelesen.
SELFCHECK_TO=
EOF
chmod 600 /etc/24pray-api.env'
```

## 6. systemd-Dienste

Die API-Unit liegt versioniert in `deploy/24pray-api.service` (einzige Quelle, inkl.
Sandbox-Härtung) und kommt mit dem rsync aus Schritt 3 schon auf den Server:

```bash
$SSH 'install -m 644 /opt/24pray/api/deploy/24pray-api.service /etc/systemd/system/24pray-api.service

cat > /etc/systemd/system/24pray-web.service <<EOF
[Unit]
Description=24pray Web (Next.js)
After=network.target 24pray-api.service

[Service]
Type=simple
User=pray
WorkingDirectory=/opt/24pray/web
Environment=PORT=3000
Environment=NODE_ENV=production
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now 24pray-api 24pray-web
systemctl is-active 24pray-api 24pray-web'   # 2x "active"
```

`ExecStartPre` fährt bei jedem Start die Prisma-Migrationen — ein frisches
`data/`-Verzeichnis wird also automatisch zur fertigen DB.

Die API-Unit läuft mit `ProtectSystem=strict`: beschreibbar ist nur `/opt/24pray/data`
(SQLite plus npm-Cache `data/.npm` für das `npx` im `ExecStartPre`). Die Prisma-Engines
müssen deshalb schon beim Deploy in `node_modules` liegen (`npm ci` + `prisma generate`,
Schritt 4); zur Laufzeit lädt Prisma nichts nach. Prüfen: `systemd-analyze security
24pray-api` (Ziel: Exposure < 3.0). Bewusst **kein** `MemoryDenyWriteExecute`, das bricht
den JIT von Node.

## 7. nginx (eine Origin für Web + API)

Phase 1 (nur HTTP, noch kein Zertifikat). Den Endstand nach certbot beschreibt
`deploy/nginx.conf`, siehe Schritt 9. `map` und `log_format` stehen außerhalb des
`server`-Blocks, weil `sites-enabled/*` im http-Kontext eingebunden wird.

```bash
$SSH 'cat > /etc/nginx/sites-available/24pray <<EOF
# Zugriffslog ohne Tokens: kein Query-String, /join/<token> maskiert, kein Referer
map \$uri \$log_uri {
    ~^/join/      /join/***;
    ~^/api/join/  /api/join/***;
    default       \$uri;
}
log_format notokens '\''\$remote_addr - \$remote_user [\$time_local] '\''
                    '\''"\$request_method \$log_uri \$server_protocol" \$status \$body_bytes_sent '\''
                    '\''"\$http_user_agent" \$request_time'\'';

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 24pray.org www.24pray.org _;

    server_tokens off;
    access_log /var/log/nginx/access.log notokens;

    # Gelten nur, solange keine location ein eigenes add_header setzt (sonst dort wiederholen)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "frame-ancestors '\''none'\''" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # API unter /api/ — trailing slash am proxy_pass STRIPPT den Prefix
    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/24pray /etc/nginx/sites-enabled/24pray
nginx -t && systemctl reload nginx'
```

`server_tokens off` steht pro `server`, weil Ubuntus `nginx.conf` im http-Kontext schon
`server_tokens build;` setzt (ein zweites dort wäre ein Duplikat-Fehler). Das Error-Log
(`/var/log/nginx/error.log`) schreibt bei Upstream-Fehlern weiterhin die volle Request-Zeile
samt Query-String und Referer; das Format ist dort nicht konfigurierbar.

**Smoke-Test (Phase 1, nur IP):**

```bash
curl -s http://$IP/api/health                          # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" http://$IP/   # 200
curl -s -X POST http://$IP/api/auth/magic-link \
  -H 'Content-Type: application/json' -d '{"email":"du@example.com"}'
# → 204 (Mail unterwegs). Ein {"devLoginUrl":…} gibt es nur mit DEV_LOGIN_RESPONSE=true,
#   das auf dem Server nie gesetzt sein darf.
```

## 8. Backup (täglich, 14 Tage Rotation)

```bash
$SSH 'cat > /etc/cron.daily/24pray-backup <<'"'"'EOF'"'"'
#!/bin/sh
set -eu
umask 077
src=/opt/24pray/data/24pray.db
dir=/opt/24pray/backup
d=$(date +%F)
t="$dir/.24pray-$d.tmp"
trap 'rm -f "$t" "$t-wal" "$t-shm"' EXIT
test -s "$src"
rm -f "$t"
sqlite3 "$src" ".backup \"$t\""
sqlite3 "$t" "PRAGMA journal_mode=DELETE" >/dev/null
test "$(sqlite3 -readonly "$t" "PRAGMA quick_check")" = ok
test "$(sqlite3 -readonly "$t" "SELECT count(*) FROM sqlite_master WHERE name = 'PrayerProject'")" = 1
mv "$t" "$dir/24pray-$d.db"
find "$dir" -name "24pray-*.db" -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/24pray-backup
chmod 700 /opt/24pray/backup'
```

`sqlite3 .backup` liefert einen konsistenten Snapshot auch bei laufendem Schreibbetrieb
(ein `cp` kann bei WAL eine inkonsistente Datei ergeben); `umask 077` und das
Verzeichnis `0700` halten die Backups privat. Das Skript bricht bei jedem Fehler ab (`set -eu`), sichert erst in eine Temp-Datei
(`.24pray-<datum>.tmp`), prueft sie (`quick_check`, Tabelle `PrayerProject`) und benennt sie
erst dann um; die Rotation laeuft nur nach Erfolg. Voraussetzung: `sqlite3` ist installiert.
Der Off-site-Pull (rrsync als root) liest weiterhin `24pray-*.db` aus `/opt/24pray/backup`.

Restore: Dienst stoppen (`systemctl stop 24pray-api`) → `24pray.db-wal` und `24pray.db-shm`
in `/opt/24pray/data` entfernen (ein stehengebliebenes WAL der alten DB würde sonst auf die
zurückgespielte Datei angewendet und sie korrumpieren) → Backup-Datei nach
`/opt/24pray/data/24pray.db` kopieren → `systemctl start 24pray-api`.

## 8b. Städte-Datenbank (Geocoding, W3.6)

Orts-Autocomplete weltweit — GeoNames cities500 (CC-BY 4.0, alle Orte ≥ 500 EW,
also auch Dörfer) einmalig importieren (und nach GeoNames-Updates bei Bedarf
erneut; der Import ersetzt die Tabelle atomar, dauert lokal ~13s für ~235k Zeilen):

```bash
curl -sL -o /tmp/cities500.zip https://download.geonames.org/export/dump/cities500.zip
unzip -o /tmp/cities500.zip -d /tmp
$SSH 'cd /opt/24pray/api &&
  DATABASE_URL=file:/opt/24pray/data/24pray.db npm run import:cities -- /tmp/cities500.txt &&
  chown pray:pray /opt/24pray/data/24pray.db'
# Test: curl "https://<domain>/api/geocode?q=petershausen" (Dorf bei München, ~7.000 EW)
```

## 9. Domain + HTTPS

**DNS (beim Registrar, hier Strato → Domains → DNS-Verwaltung):**

| Typ | Name | Wert |
|---|---|---|
| A | `@` | VPS-IP |
| A | `www` | VPS-IP |

**MX-/Mail-Einträge NICHT anfassen** (Strato-Mail läuft unabhängig weiter).
Prüfen (direkt am autoritativen NS, umgeht Caches):

```bash
dig +short A 24pray.org @docks12.rzone.de   # → VPS-IP
```

**Zertifikat + Umstellung:**

```bash
$SSH 'export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq certbot python3-certbot-nginx
certbot --nginx -d 24pray.org -d www.24pray.org \
  --non-interactive --agree-tos -m <deine@mail> --redirect
sed -i "s|^APP_URL=.*|APP_URL=https://24pray.org|; s|^COOKIE_SECURE=.*|COOKIE_SECURE=true|" /etc/24pray-api.env
systemctl restart 24pray-api'
```

Renewal läuft automatisch (`systemctl list-timers | grep certbot`).
Verifikation: `curl -i https://24pray.org/api/health`, `http://` → 301,
Magic-Link-Response enthält `https://24pray.org/...`, Set-Cookie hat
`HttpOnly; Secure; SameSite=Lax`.

**www → Apex (SEO, seit 2026-10-12):** Nach certbot zwei Stellen in `/etc/nginx/sites-available/24pray`
anpassen, sonst liefert `www.24pray.org` die Seite als Duplikat aus:

- im 443-Block direkt nach `server_name`:
  `if ($host = www.24pray.org) { return 301 https://24pray.org$request_uri; }`
- im 80-Block den certbot-Redirect für www von `https://$host…` auf `https://24pray.org$request_uri` ändern

Verifikation: `curl -sI https://www.24pray.org/de` → `301`, `location: https://24pray.org/de`.

**Endstand:** `deploy/nginx.conf` ist genau diese Datei nach certbot + www-Umstellung
(inkl. Security-Header und tokenfreiem Log in beiden `server`-Blöcken). Bei Änderungen
die Repo-Datei pflegen und einspielen:

```bash
$SSH 'cp -a /etc/nginx/sites-available/24pray /etc/nginx/sites-available/24pray.bak-$(date +%F) &&
  install -m 644 /opt/24pray/api/deploy/nginx.conf /etc/nginx/sites-available/24pray &&
  nginx -t && systemctl reload nginx'
curl -sI https://24pray.org/de   # 5 Security-Header, "Server: nginx" ohne Version
```

Achtung: das `.bak` nicht in `sites-enabled` legen (dort wird alles eingebunden).

## 10. Echte Mails (SMTP)

Postfach `no-reply@24pray.org` beim Mail-Provider anlegen (hier: Strato).
**Falle: Sonderzeichen in User/Passwort müssen in der URL percent-encodiert
sein** — `@` = `%40`:

```bash
$SSH 'sed -i "s|^SMTP_URL=.*|SMTP_URL=smtps://no-reply%4024pray.org:<PASSWORT-url-encodiert>@smtp.strato.de:465|" /etc/24pray-api.env
systemctl restart 24pray-api'

# Beweis: 204 = Mail angenommen (Testmodus-JSON kommt nicht mehr)
curl -s -i -X POST https://24pray.org/api/auth/magic-link \
  -H "Content-Type: application/json" -d "{\"email\":\"du@example.com\"}" | head -1
```

SMTP-Zugang vorab lokal testen (zeigt `235 Authenticated` bei Erfolg):

```bash
curl -v --url smtps://smtp.strato.de:465 --user 'no-reply@24pray.org:<PASSWORT>' \
  --mail-from no-reply@24pray.org --mail-rcpt du@example.com --upload-file /dev/null
```

*(Erste Mails landen bei manchen Providern im Spam — neue Absender-Domain.)*

---

## Update-Deploy (Standard-Fall)

```bash
IP=217.154.240.224
RS="rsync -az --delete -e 'ssh -i ~/.ssh/24pray_vps -o IdentitiesOnly=yes' \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude data --exclude .env --exclude .env.local --exclude .env.production \
  --exclude .superpowers --exclude docs --exclude coverage"
eval $RS ~/24pray-api/ root@$IP:/opt/24pray/api/
eval $RS ~/24pray-web/ root@$IP:/opt/24pray/web/
ssh -i ~/.ssh/24pray_vps root@$IP '
  chown -R pray:pray /opt/24pray &&
  cd /opt/24pray/api && sudo -u pray npm ci --silent &&
    sudo -u pray npx prisma generate && sudo -u pray npm run build &&
  cd /opt/24pray/web && sudo -u pray npm ci --silent && sudo -u pray npx next build &&
  systemctl restart 24pray-api 24pray-web'
```

Neue Prisma-Migrationen laufen beim API-Neustart automatisch (`ExecStartPre`).

## Betrieb & Troubleshooting

| Aufgabe | Befehl (auf dem Server) |
|---|---|
| Logs API / Web | `journalctl -u 24pray-api -f` / `journalctl -u 24pray-web -f` |
| Status | `systemctl status 24pray-api 24pray-web nginx` |
| DB-Größe / Backups | `ls -lh /opt/24pray/data /opt/24pray/backup` |
| Zertifikate | `certbot certificates` |
| Firewall | `ufw status` |
| Login-Sperren (fail2ban) | `fail2ban-client status sshd` |

**Bekannte Fallen**

- **`rsync` braucht `--delete`** (Befund beim Deploy 2026-07-27). Ohne das bleiben gelöschte
  oder umbenannte Dateien auf dem Server liegen; nach dem SEO-Umbau existierten dadurch die
  alte UND die neue Route parallel (`/projects/[id]` neben `/[locale]/projects/[id]`).
  Ausgeschlossene Pfade (`node_modules`, `data`, `.env*`) sind vor dem Löschen geschützt —
  rsync entfernt Excludes nur mit dem zusätzlichen `--delete-excluded`.
- **`@`/Sonderzeichen in SMTP_URL** → percent-encodieren (`%40`), sonst schlägt der Verbindungsaufbau kryptisch fehl.
- **Lokale Entwicklung:** nie `next build` neben laufendem `next dev` (teilen sich `.next/` — der Dev-Server verliert seine Assets, Seite lädt „leer"). Verwaiste Next-Prozesse findet `lsof` teils nicht → `ss -ltnp | grep :3000`.
- `NEXT_PUBLIC_*`-Variablen werden **zur Build-Zeit** eingebacken — deshalb `/api` relativ halten; absolute URLs erzwingen Rebuilds.
- **`NEXT_PUBLIC_APP_URL` ist die Ausnahme und MUSS absolut sein**: daraus bauen sich
  Canonical-Tags, hreflang-Alternates und die Sitemap. Ist sie falsch, zeigen alle
  Canonicals auf die falsche Domain und Google indexiert im schlimmsten Fall gar nichts.
  Fällt sie weg, greift `https://24pray.org` als Default (`src/lib/routes.ts`) — bei einem
  Domain-Wechsel also hier zwingend nachziehen und neu bauen.
- Der Web-Dienst rendert öffentliche Seiten serverseitig und holt die Daten dafür über
  `API_URL_INTERNAL` (Default `http://localhost:3001`, passt auf dem VPS). Nur wenn die API
  je auf einen anderen Port/Host wandert, muss die Variable in die `24pray-web`-Unit.
- `/robots.txt` und `/sitemap.xml` liefert **Next**, nicht nginx — beide Pfade dürfen dort
  also nicht abgefangen oder auf statische Dateien umgebogen werden.
- SQLite-Pfad: `DATABASE_URL` absolut angeben (`file:/opt/…`), Prisma löst relative Pfade gegen das Schema-Verzeichnis auf.
- **`server.ts` liest `DATA_DIR`, NICHT `DATABASE_URL`** — die Env-Variable in
  Schritt 5 wird nur für `prisma migrate`/CLI-Aufrufe gebraucht; die App selbst baut
  ihre SQLite-URL zur Laufzeit aus `DATA_DIR` (`src/server.ts`). Eigene API-Instanzen
  (z. B. für Lasttests) mit `DATA_DIR=<dir> PORT=<p> npx tsx src/server.ts` starten,
  sonst landet man ungewollt auf der falschen DB.
- **`prisma migrate dev` bei laufender Dev-API** → „database is locked" (SQLite-Writer-
  Konflikt). Migrationsordner stattdessen manuell anlegen
  (`prisma/migrations/<timestamp>_<name>/migration.sql`, Timestamp nach dem letzten
  vorhandenen), SQL direkt gegen die Dev-DB ausführen, dann
  `DATABASE_URL="file:../data/24pray.db" npx prisma migrate resolve --applied <name>`.
- **tsx-watch lädt neue Routen manchmal nicht** — nach `prisma generate` hängt der
  Dev-Prozess gelegentlich am alten Client/alten Routen fest. Abhilfe: `touch
  src/server.ts` oder den Dev-Prozess killen und `npm run dev` neu starten.

## Off-site-Backup

Die Produktions-DB wird nachts per Pull-Prinzip von **tsrv** (Heim-Nettop) vom VPS
gezogen, `age`-verschlüsselt und zusätzlich nach OneDrive gesynct — das VPS bekommt
dabei keine Cloud-Credentials, tsrv zieht aktiv über einen auf `rrsync -ro` beschränkten
SSH-Key. Canonical-Doku (Architektur, Recipient, Restore): `LGRL/scripts/24pray-backup/README.md`.

## Secrets-Inventar

| Secret | Ort | Rotation |
|---|---|---|
| SSH-Deploy-Key | lokal `~/.ssh/24pray_vps` (Server: nur Pubkey) | neuen Key erzeugen → `authorized_keys` tauschen |
| Root-Passwort | keins im Umlauf (Zufall, Login key-only) | Strato-VNC-Konsole als Fallback |
| SMTP-Postfach | `/etc/24pray-api.env` (0600, root) | Passwort im Mail-Panel ändern → env anpassen → API restart |
| Session-/Magic-Tokens | nur gehasht in der DB | — |

## Monitoring (eigene Infra, bewusst getrennt von allem anderen)

Stand 2026-07-08. Zwei Bausteine, beide ohne Dritt-Dienste:

1. **VPS-Selbstcheck** — `deploy/24pray-selfcheck.sh` (deployt nach
   `/usr/local/sbin/24pray-selfcheck.sh`, systemd-Timer `24pray-selfcheck.timer`,
   alle 15 min): prüft Dienste (24pray-api/-web/nginx), Disk ≥85 %,
   TLS-Restlaufzeit <14 Tage, „Backup von heute vorhanden", SQLite `quick_check`,
   API-Antwort. Alarm-Mail über den eigenen Strato-SMTP (Zugang wird zur Laufzeit
   aus `/etc/24pray-api.env` gelesen) an `SELFCHECK_TO` (ebenfalls aus
   `/etc/24pray-api.env`; leer = keine Mail) — nur bei
   Zustandswechsel (Problem neu/behoben), State in `/var/lib/24pray-selfcheck.state`.
   **Falle:** Strato-SMTP verlangt CRLF-Zeilenenden — daher das `sed 's/$/\r/'`
   vor curl. Die SMTP-Zugangsdaten bekommt curl per Config auf stdin (`-K -`), nicht als
   Argument, sie stehen also nicht in `ps`. Test: Skriptkopie mit erzwungenem `PROBLEMS`-Eintrag laufen lassen.

2. **Externer Uptime-Check** (Totalausfall-Erkennung): geplant als
   GitHub-Actions-Cron in diesem Repo (`.github/workflows/uptime.yml`).
   **Status (2026-07-09): weiterhin pending workflow-Scope** — pusht erst, wenn der
   gh-Token den `workflow`-Scope hat (`gh auth refresh -h github.com -s workflow`);
   unverändert seit Ersteinrichtung, kein Fortschritt in den letzten zwei Feature-Tagen.

Grundsatz: Selbstcheck erkennt alles außer „Server komplett weg"; dafür ist der
externe Cron zuständig. Kein Prometheus/Grafana auf dem VPS (RAM, Wartungsfläche,
blinder Fleck bei Totalausfall).
