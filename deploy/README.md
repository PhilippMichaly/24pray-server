# Deployment — Strato VPS (live seit 2026-07-07)

**Server:** 217.154.240.224 · Ubuntu 26.04 LTS · 4 vCPU / 8 GB / 232 GB
**Zugang:** SSH key-only (`~/.ssh/24pray_vps` auf dem Laptop), Passwort-Auth deaktiviert, root nur mit Key. ufw (22/80/443) + fail2ban aktiv.

## Layout
```
/opt/24pray/api      # dieses Repo, gebaut (npm ci && npx prisma generate && npm run build)
/opt/24pray/web      # 24pray-web, gebaut (.env.production: NEXT_PUBLIC_API_URL=/api)
/opt/24pray/data     # SQLite (24pray.db)
/opt/24pray/backup   # tägliche DB-Kopien (cron.daily, 14 Tage Rotation)
/etc/24pray-api.env  # API-Env (APP_URL, SMTP_URL, …), 0600
```

## Dienste
- `24pray-api.service` — node dist/server.js, Port 3001, `ExecStartPre` fährt Migrationen
- `24pray-web.service` — next start, Port 3000
- nginx (`/etc/nginx/sites-available/24pray`): `/` → :3000, `/api/` → :3001 (Prefix-Strip, same-origin → kein CORS)

## Update-Deploy (vom Laptop)
```bash
RS="rsync -az -e 'ssh -i ~/.ssh/24pray_vps' --exclude node_modules --exclude .next --exclude .git --exclude data --exclude .env --exclude .env.local"
eval $RS ~/24pray-api/ root@217.154.240.224:/opt/24pray/api/
eval $RS ~/24pray-web/ root@217.154.240.224:/opt/24pray/web/
ssh -i ~/.ssh/24pray_vps root@217.154.240.224 '
  chown -R pray:pray /opt/24pray &&
  cd /opt/24pray/api && sudo -u pray npm ci --silent && sudo -u pray npx prisma generate && sudo -u pray npm run build &&
  cd /opt/24pray/web && sudo -u pray npm ci --silent && sudo -u pray npx next build &&
  systemctl restart 24pray-api 24pray-web'
```

## Domain-Umstellung 24pray.org (wenn DNS zeigt)
1. A-Records `@`/`www`/ggf. `api` → 217.154.240.224 (Strato-DNS; MX nicht anfassen)
2. `certbot --nginx -d 24pray.org -d www.24pray.org`
3. `/etc/24pray-api.env`: `APP_URL=https://24pray.org`, `COOKIE_SECURE=true` → `systemctl restart 24pray-api`
4. Echte Mails: `SMTP_URL=smtps://no-reply%4024pray.org:PASS@smtp.strato.de:465` (Strato-Postfach) → Testmodus-Button verschwindet automatisch
