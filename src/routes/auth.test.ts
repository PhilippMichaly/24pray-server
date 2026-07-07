import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string }[] = [];

beforeAll(async () => {
  db = await makeTestDb();
  const env = parseEnv({ APP_URL: 'http://localhost:3000' });
  app = await buildApp({
    prisma: db.prisma,
    env,
    mailer: { async sendMagicLink(email, url) { captured.push({ email, url }); } },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.cleanup();
});

function tokenFrom(url: string): string {
  return new URL(url).searchParams.get('token')!;
}

describe('auth flow', () => {
  it('full cycle: magic-link -> verify -> me -> logout', async () => {
    const ml = await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'a@example.com' } });
    // Ohne SMTP (Testmodus): 200 + devLoginUrl statt 204 (Mail-los einloggbar).
    expect(ml.statusCode).toBe(200);
    expect(ml.json().devLoginUrl).toContain('/auth/verify?token=');
    expect(captured.at(-1)!.email).toBe('a@example.com');

    const token = tokenFrom(captured.at(-1)!.url);
    const verify = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().email).toBe('a@example.com');
    const cookie = verify.cookies.find((c) => c.name === 'session')!;
    expect(cookie.httpOnly).toBe(true);

    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: { session: cookie.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('a@example.com');

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { session: cookie.value } });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/auth/me', cookies: { session: cookie.value } });
    expect(after.statusCode).toBe(401);
  });

  it('me without cookie is 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('verify is idempotent within the grace window (StrictMode double-POST)', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'b@example.com' } });
    const token = tokenFrom(captured.at(-1)!.url);
    const first = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(first.statusCode).toBe(200);
    // Sofortiger zweiter POST (React-StrictMode) → weiterhin Erfolg, keine Sackgasse.
    const second = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(second.statusCode).toBe(200);
    expect(second.json().email).toBe('b@example.com');
  });

  it('verify rejects a consumed token after the grace window elapsed', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'c@example.com' } });
    const token = tokenFrom(captured.at(-1)!.url);
    const first = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(first.statusCode).toBe(200);
    // Konsum künstlich altern lassen (jenseits des 30s-Grace-Fensters).
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: 'c@example.com' } });
    await db.prisma.magicToken.updateMany({
      where: { userId: user.id },
      data: { consumedAt: new Date(Date.now() - 60_000) },
    });
    const late = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(late.statusCode).toBe(400);
  });
});
