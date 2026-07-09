import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string }[] = [];

let loginSeq = 0;
async function loginAs(email: string): Promise<string> {
  const remoteAddress = `10.2.1.${++loginSeq}`;
  await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email }, remoteAddress });
  const token = new URL(captured.at(-1)!.url).searchParams.get('token')!;
  const verify = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token }, remoteAddress });
  return verify.cookies.find((c) => c.name === 'session')!.value;
}

beforeAll(async () => {
  db = await makeTestDb();
  app = await buildApp({
    prisma: db.prisma,
    env: parseEnv({
      APP_URL: 'http://localhost:3000',
      VAPID_PUBLIC_KEY: 'un7-pub',
      VAPID_PRIVATE_KEY: 'un7-priv',
      VAPID_SUBJECT: 'mailto:un7@example.com',
    }),
    mailer: { async sendMagicLink(email, url) { captured.push({ email, url }); } },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

describe('Push-Subscription-Routen (Backlog 7)', () => {
  it('vapid-key liefert den Public Key', async () => {
    const res = await app.inject({ method: 'GET', url: '/push/vapid-key' });
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe('un7-pub');
  });

  it('Subscribe braucht Login; Upsert per endpoint; Delete löscht nur eigene', async () => {
    const sub = { endpoint: 'https://push.example/un7-a', keys: { p256dh: 'p', auth: 'a' } };
    expect((await app.inject({ method: 'POST', url: '/me/push-subscriptions', payload: sub })).statusCode).toBe(401);
    const cookieA = await loginAs('un7-a@example.com');
    expect((await app.inject({ method: 'POST', url: '/me/push-subscriptions', cookies: { session: cookieA }, payload: sub })).statusCode).toBe(204);
    // Upsert: gleicher endpoint nochmal → immer noch genau 1 Row
    expect((await app.inject({ method: 'POST', url: '/me/push-subscriptions', cookies: { session: cookieA }, payload: sub })).statusCode).toBe(204);
    expect(await db.prisma.pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(1);
    // Fremder darf nicht löschen
    const cookieB = await loginAs('un7-b@example.com');
    await app.inject({ method: 'DELETE', url: '/me/push-subscriptions', cookies: { session: cookieB }, payload: { endpoint: sub.endpoint } });
    expect(await db.prisma.pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(1);
    // Eigentümer löscht
    await app.inject({ method: 'DELETE', url: '/me/push-subscriptions', cookies: { session: cookieA }, payload: { endpoint: sub.endpoint } });
    expect(await db.prisma.pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(0);
  });

  it('ohne VAPID-Env: alle Push-Routen 404 (fail-closed)', async () => {
    const { buildApp: build } = await import('../app.js');
    const bare = await build({
      prisma: db.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000' }),
      mailer: { async sendMagicLink() {} },
    });
    await bare.ready();
    try {
      expect((await bare.inject({ method: 'GET', url: '/push/vapid-key' })).statusCode).toBe(404);
      expect((await bare.inject({ method: 'POST', url: '/me/push-subscriptions', payload: { endpoint: 'https://x/y', keys: { p256dh: 'p', auth: 'a' } } })).statusCode).toBe(404);
    } finally { await bare.close(); }
  });
});
