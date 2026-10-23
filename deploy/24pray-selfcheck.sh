#!/usr/bin/env bash
# 24pray-Selbstcheck: Dienste, Disk, Zertifikat, Backup, DB-Integrität.
# Mailt NUR bei Zustandswechsel (Problem neu / Problem behoben) über den
# lokalen Strato-SMTP (Zugang aus /etc/24pray-api.env, SMTP_URL) an SELFCHECK_TO
# (ebenfalls aus /etc/24pray-api.env; leer = kein Mailversand, nur Ausgabe im Journal).
set -u
ENV_FILE=/etc/24pray-api.env
# Liest einen Wert aus der env-Datei, ohne sie zu sourcen (die Datei ist kein
# Shell-Skript, z. B. SMTP_FROM enthaelt Leerzeichen und spitze Klammern).
env_get() { grep -oP "^$1=\K.*" "$ENV_FILE" | tail -1 | tr -d '"'; }
RECIPIENT=$(env_get SELFCHECK_TO)
STATE=/var/lib/24pray-selfcheck.state
PROBLEMS=()

# 1) Dienste
for svc in 24pray-api 24pray-web nginx; do
  systemctl is-active --quiet "$svc" || PROBLEMS+=("Dienst $svc ist nicht aktiv")
done
# 2) Disk
USE=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$USE" -ge 85 ] && PROBLEMS+=("Disk / zu ${USE}% voll")
# 3) Zertifikat (Tage Restlaufzeit)
EXP=$(echo | openssl s_client -connect localhost:443 -servername 24pray.org 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "${EXP:-}" ]; then
  DAYS=$(( ( $(date -d "$EXP" +%s) - $(date +%s) ) / 86400 ))
  [ "$DAYS" -lt 14 ] && PROBLEMS+=("TLS-Zertifikat läuft in ${DAYS} Tagen ab")
else
  PROBLEMS+=("Zertifikat nicht prüfbar (openssl s_client fehlgeschlagen)")
fi
# 4) Backup von heute vorhanden?
TODAY=$(date +%F)
ls /opt/24pray/backup/*"$TODAY"* >/dev/null 2>&1 || PROBLEMS+=("Kein Backup von heute in /opt/24pray/backup")
# 5) DB-Integrität (quick_check auf Kopie-freiem read-only Zugriff)
QC=$(sqlite3 "file:/opt/24pray/data/24pray.db?mode=ro" "PRAGMA quick_check;" 2>&1 | head -1)
[ "$QC" = "ok" ] || PROBLEMS+=("SQLite quick_check: $QC")
# 6) HTTP lokal
curl -fsS -o /dev/null --max-time 10 https://24pray.org/api/stats/public || PROBLEMS+=("API antwortet nicht (stats/public)")

NOW_STATE="OK"
[ ${#PROBLEMS[@]} -gt 0 ] && NOW_STATE="PROBLEM"
LAST_STATE=$(cat "$STATE" 2>/dev/null || echo "OK")
echo "$NOW_STATE" > "$STATE"

send_mail() {
  local subject="$1" body="$2"
  if [ -z "$RECIPIENT" ]; then
    echo "SELFCHECK_TO fehlt in $ENV_FILE, keine Mail versendet" >&2
    return 0
  fi
  # SMTP_URL: smtps://user%40host:PASS@smtp.strato.de:465. Die URL geht per argv an
  # Python (nie in den Quelltext interpoliert), die Zugangsdaten per Config auf stdin
  # an curl (nie in die Kommandozeile, also nicht in ps sichtbar).
  local url cred host mailfile
  url=$(env_get SMTP_URL)
  {
    read -r cred
    read -r host
  } < <(python3 -c '
import sys
from urllib.parse import urlsplit, unquote
u = urlsplit(sys.argv[1])
c = unquote(u.username or "") + ":" + unquote(u.password or "")
# curl-Config: in "..." sind Backslash und Anfuehrungszeichen zu escapen
print(c.replace("\\", "\\\\").replace(chr(34), "\\" + chr(34)))
print(f"{u.hostname}:{u.port}")
' "$url")
  mailfile=$(mktemp)
  {
    echo "From: 24pray Selfcheck <no-reply@24pray.org>"
    echo "To: $RECIPIENT"
    echo "Subject: $subject"
    echo "Content-Type: text/plain; charset=utf-8"
    echo
    echo -e "$body"
  } | sed 's/$/\r/' > "$mailfile"
  curl -sS -K - --url "smtps://$host/24pray.org" --mail-from no-reply@24pray.org \
    --mail-rcpt "$RECIPIENT" -T "$mailfile" >/dev/null <<EOF
user = "$cred"
EOF
  rm -f "$mailfile"
}

if [ "$NOW_STATE" = "PROBLEM" ] && [ "$LAST_STATE" = "OK" ]; then
  send_mail "⚠ 24pray VPS-Selbstcheck: $(printf '%s' "${PROBLEMS[0]}")" \
    "Probleme auf dem 24pray-VPS ($(hostname), $(date '+%F %H:%M')):\n\n$(printf ' - %s\n' "${PROBLEMS[@]}")\n\nDieser Check läuft alle 15 Minuten; du bekommst erst wieder Post bei Entwarnung oder neuem Zustandswechsel."
elif [ "$NOW_STATE" = "OK" ] && [ "$LAST_STATE" = "PROBLEM" ]; then
  send_mail "✅ 24pray VPS-Selbstcheck: alles wieder in Ordnung" \
    "Alle Checks grün ($(date '+%F %H:%M'))."
fi
echo "$NOW_STATE: ${PROBLEMS[*]:-alle Checks grün}"
