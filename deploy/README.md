# Deploying 24pray-api on a VPS

1. `git clone` into `/opt/24pray-api`, `npm ci`, `npm run build`.
2. Create `/etc/24pray-api.env` from `.env.example`, set `APP_URL=https://app.example.com`,
   `COOKIE_SECURE=true`, and `DATABASE_URL="file:/opt/24pray-api/data/24pray.db"`,
   `DATA_DIR=/opt/24pray-api/data`. Set `SMTP_URL`/`SMTP_FROM` for real email.
3. `useradd -r 24pray`, `chown -R 24pray /opt/24pray-api`.
4. `cp deploy/24pray-api.service /etc/systemd/system/ && systemctl enable --now 24pray-api`.
5. `cp deploy/nginx.conf /etc/nginx/sites-available/24pray-api`, symlink, `nginx -t && systemctl reload nginx`.
6. TLS: `certbot --nginx -d api.example.com`.

Backup (cron): `sqlite3 /opt/24pray-api/data/24pray.db ".backup '/var/backups/24pray-$(date +\%F).db'"`

Frontend: deploy `24pray-web` separately (Vercel or another Nginx vhost) with
`NEXT_PUBLIC_API_URL=https://api.example.com` and `NEXT_PUBLIC_APP_URL=https://app.example.com`.
