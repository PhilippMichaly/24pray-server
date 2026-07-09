import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

// fix2 (HOCH, End-User-Test v2 Befund 2): 500er leakten bisher err.message roh an den
// Client (Interna wie SQL-/Unique-Constraint-Details), und `logger: false` protokollierte
// nichts serverseitig — ein 500er verschwand spurlos. Eigene App-Instanz + Test-Route,
// die absichtlich einen Error mit geheimem Inhalt wirft.
describe('fix2 setErrorHandler — 500er sind generisch + serverseitig geloggt', () => {
  let errDb: TestDb;
  let errApp: FastifyInstance;

  beforeAll(async () => {
    errDb = await makeTestDb();
    errApp = await buildApp({
      prisma: errDb.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000' }),
      mailer: { async sendMagicLink() {} },
    });
    errApp.get('/fix2-throw', async () => {
      throw new Error('geheime UNIQUE-Interna');
    });
    await errApp.ready();
  });

  afterAll(async () => {
    await errApp.close();
    await errDb.cleanup();
  });

  it('leakt die Error-Message NICHT an den Client und liefert einen generischen Text', async () => {
    const res = await errApp.inject({ method: 'GET', url: '/fix2-throw' });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).not.toContain('geheime UNIQUE-Interna');
    expect(res.json().message).toBe('Serverfehler');
  });

  it('loggt 500er serverseitig (console.error), damit ein 500er nicht spurlos verschwindet', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await errApp.inject({ method: 'GET', url: '/fix2-throw' });
      expect(spy).toHaveBeenCalled();
      const loggedText = spy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(loggedText).toContain('geheime UNIQUE-Interna'); // Interna landen im Server-Log, nicht in der Response
    } finally {
      spy.mockRestore();
    }
  });
});
