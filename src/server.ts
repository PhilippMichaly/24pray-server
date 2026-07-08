import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './env.js';
import { createPrisma } from './db.js';
import { buildApp } from './app.js';
import { createMailer } from './lib/mailer.js';
import { startJobs } from './lib/jobs.js';

async function main() {
  mkdirSync(resolve(env.DATA_DIR), { recursive: true });
  const databaseUrl = `file:${resolve(env.DATA_DIR, '24pray.db')}`;
  const prisma = createPrisma(databaseUrl);
  const mailer = createMailer({ smtpUrl: env.SMTP_URL, from: env.SMTP_FROM });
  const app = await buildApp({ prisma, env, mailer });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`24pray-api listening on :${env.PORT} (APP_URL=${env.APP_URL})`);
  // W3.2: Completion- + Reminder-Job (minütlich)
  const stopJobs = startJobs({ prisma, mailer, appUrl: env.APP_URL });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down…`);
    stopJobs();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
