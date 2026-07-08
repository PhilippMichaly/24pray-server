#!/usr/bin/env bash
# 24pray-Selbstcheck: Dienste, Disk, Zertifikat, Backup, DB-Integrität.
# Mailt NUR bei Zustandswechsel (Problem neu / Problem behoben) über den
# lokalen Strato-SMTP (Zugang aus /etc/24pray-api.env, SMTP_URL).
set -u
RECIPIENT="mflip2@gmx.de"
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
  # SMTP_URL: smtps://user%40host:PASS@smtp.strato.de:465 → curl kann das direkt
  local url user pass
  url=$(grep -oP '^SMTP_URL=\K.*' /etc/24pray-api.env | tr -d '"')
  user=$(python3 -c "from urllib.parse import urlsplit,unquote;u=urlsplit('$url');print(unquote(u.username))")
  pass=$(python3 -c "from urllib.parse import urlsplit,unquote;u=urlsplit('$url');print(unquote(u.password))")
  host=$(python3 -c "from urllib.parse import urlsplit;u=urlsplit('$url');print(f'{u.hostname}:{u.port}')")
  {
    echo "From: 24pray Selfcheck <no-reply@24pray.org>"
    echo "To: $RECIPIENT"
    echo "Subject: $subject"
    echo "Content-Type: text/plain; charset=utf-8"
    echo
    echo -e "$body"
  } | sed 's/$//' | curl -sS --url "smtps://$host" --mail-from no-reply@24pray.org \
        --mail-rcpt "$RECIPIENT" --user "$user:$pass" -T - >/dev/null
}

if [ "$NOW_STATE" = "PROBLEM" ] && [ "$LAST_STATE" = "OK" ]; then
  send_mail "⚠ 24pray VPS-Selbstcheck: $(printf '%s' "${PROBLEMS[0]}")" \
    "Probleme auf dem 24pray-VPS ($(hostname), $(date '+%F %H:%M')):\n\n$(printf ' - %s\n' "${PROBLEMS[@]}")\n\nDieser Check läuft alle 15 Minuten; du bekommst erst wieder Post bei Entwarnung oder neuem Zustandswechsel."
elif [ "$NOW_STATE" = "OK" ] && [ "$LAST_STATE" = "PROBLEM" ]; then
  send_mail "✅ 24pray VPS-Selbstcheck: alles wieder in Ordnung" \
    "Alle Checks grün ($(date '+%F %H:%M'))."
fi
echo "$NOW_STATE: ${PROBLEMS[*]:-alle Checks grün}"
