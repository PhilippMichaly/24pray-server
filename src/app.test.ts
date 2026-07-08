import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { parseEnv } from './env.js';
import { makeTestDb, type TestDb } from './test/helpers.js';

// CORS-Entkopplung (§6.5): APP_URL immer erlaubt, CORS_ORIGINS fügt weitere hinzu, Rest verboten.
let db: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  db = await makeTestDb();
  const env = parseEnv({
    APP_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:3002, https://preview.24pray.org',
  });
  app = await buildApp({
    prisma: db.prisma,
    env,
    mailer: { async sendMagicLink() {} },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.cleanup();
});

function allowOrigin(origin: string) {
  return app.inject({
    method: 'OPTIONS',
    url: '/auth/me',
    headers: {
      origin,
      'access-control-request-method': 'GET',
    },
  });
}

describe('CORS origins', () => {
  it('erlaubt APP_URL', async () => {
    const res = await allowOrigin('http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('erlaubt eine zusätzliche CORS_ORIGINS-Origin', async () => {
    const res = await allowOrigin('http://localhost:3002');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3002');
  });

  it('verweigert eine fremde Origin', async () => {
    const res = await allowOrigin('https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
