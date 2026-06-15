# 24pray-api

Backend for the 24pray prayer-chain platform. Fastify + SQLite (Prisma) + magic-link auth.

## Dev
```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev   # http://localhost:3001
```
Magic links are printed to the console when `SMTP_URL` is empty.

## Test
```bash
npm test
```

## Deploy
See `deploy/` (systemd unit + Nginx snippet) and `docs/specs/2026-06-15-24pray-api-design.md`.
