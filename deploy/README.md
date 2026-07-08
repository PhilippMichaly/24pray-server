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
RS="rsync -az -e 'ssh -i ~/.ssh/24pray_vps -o IdentitiesOnly=yes' \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude data --exclude .env --exclude .env.local"
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
  printf "NEXT_PUBLIC_API_URL=/api\n" | sudo -u pray tee .env.production >/dev/null &&
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
# Leer = Testmodus: /auth/magic-link liefert {devLoginUrl}, Login ohne Postfach.
# Gesetzt = echter Versand, Testmodus-Button verschwindet automatisch.
SMTP_URL=
SMTP_FROM=24pray <no-reply@24pray.org>
EOF
chmod 600 /etc/24pray-api.env'
```

## 6. systemd-Dienste

```bash
$SSH 'cat > /etc/systemd/system/24pray-api.service <<EOF
[Unit]
Description=24pray API
After=network.target

[Service]
Type=simple
User=pray
WorkingDirectory=/opt/24pray/api
EnvironmentFile=/etc/24pray-api.env
ExecStartPre=/usr/bin/npx prisma migrate deploy
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/24pray/data
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

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

## 7. nginx (eine Origin für Web + API)

```bash
$SSH 'cat > /etc/nginx/sites-available/24pray <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 24pray.org www.24pray.org _;

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

**Smoke-Test (Phase 1, nur IP):**

```bash
curl -s http://$IP/api/health                          # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" http://$IP/   # 200
curl -s -X POST http://$IP/api/auth/magic-link \
  -H 'Content-Type: application/json' -d '{"email":"du@example.com"}'
# → {"devLoginUrl":"http://<IP>/auth/verify?token=…"} = Testmodus-Login funktioniert
```

## 8. Backup (täglich, 14 Tage Rotation)

```bash
$SSH 'cat > /etc/cron.daily/24pray-backup <<EOF
#!/bin/sh
d=\$(date +%F)
cp /opt/24pray/data/24pray.db /opt/24pray/backup/24pray-\$d.db 2>/dev/null
find /opt/24pray/backup -name "24pray-*.db" -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/24pray-backup'
```

Restore: Dienst stoppen → Backup-Datei nach `/opt/24pray/data/24pray.db`
kopieren → `systemctl start 24pray-api`.

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
RS="rsync -az -e 'ssh -i ~/.ssh/24pray_vps -o IdentitiesOnly=yes' \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude data --exclude .env --exclude .env.local"
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

- **`@`/Sonderzeichen in SMTP_URL** → percent-encodieren (`%40`), sonst schlägt der Verbindungsaufbau kryptisch fehl.
- **Lokale Entwicklung:** nie `next build` neben laufendem `next dev` (teilen sich `.next/` — der Dev-Server verliert seine Assets, Seite lädt „leer"). Verwaiste Next-Prozesse findet `lsof` teils nicht → `ss -ltnp | grep :3000`.
- `NEXT_PUBLIC_*`-Variablen werden **zur Build-Zeit** eingebacken — deshalb `/api` relativ halten; absolute URLs erzwingen Rebuilds.
- SQLite-Pfad: `DATABASE_URL` absolut angeben (`file:/opt/…`), Prisma löst relative Pfade gegen das Schema-Verzeichnis auf.

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
   aus `/etc/24pray-api.env` gelesen) an `RECIPIENT` (im Skript) — nur bei
   Zustandswechsel (Problem neu/behoben), State in `/var/lib/24pray-selfcheck.state`.
   **Falle:** Strato-SMTP verlangt CRLF-Zeilenenden — daher das `sed 's/$/\r/'`
   vor curl. Test: Skriptkopie mit erzwungenem `PROBLEMS`-Eintrag laufen lassen.

2. **Externer Uptime-Check** (Totalausfall-Erkennung): geplant als
   GitHub-Actions-Cron in diesem Repo (`.github/workflows/uptime.yml`) — pusht
   erst, wenn der gh-Token den `workflow`-Scope hat
   (`gh auth refresh -h github.com -s workflow`).

Grundsatz: Selbstcheck erkennt alles außer „Server komplett weg"; dafür ist der
externe Cron zuständig. Kein Prometheus/Grafana auf dem VPS (RAM, Wartungsfläche,
blinder Fleck bei Totalausfall).
