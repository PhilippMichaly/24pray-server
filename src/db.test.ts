import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { parseEnv } from './env.js';
import { makeTestDb, type TestDb } from './test/helpers.js';

let db: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  db = await makeTestDb();
  app = await buildApp({
    prisma: db.prisma,
    env: parseEnv({ APP_URL: 'http://localhost:3000' }),
    mailer: { async sendMagicLink() {} },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

describe('SQLite-Tuning', () => {
  it('läuft nach App-Start im WAL-Mode (Lasttest-Fix: Reader blockieren Writer nicht)', async () => {
    const rows = await db.prisma.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode');
    expect(rows[0].journal_mode).toBe('wal');
  });
});
