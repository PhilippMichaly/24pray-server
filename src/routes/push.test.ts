import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { isAllowedPushEndpoint } from './push.js';
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
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/un7-a', keys: { p256dh: 'p', auth: 'a' } };
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

  it('Subscribe akzeptiert nur bekannte Push-Dienste (SSRF-Schutz)', async () => {
    const cookie = await loginAs('un10-a@example.com');
    const keys = { p256dh: 'p', auth: 'a' };
    const post = (endpoint: string, remoteAddress: string) => app.inject({ method: 'POST', url: '/me/push-subscriptions', cookies: { session: cookie }, payload: { endpoint, keys }, remoteAddress });
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/x',
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
      'https://web.push.apple.com/x',
    ]) {
      expect((await post(ok, '10.2.9.1')).statusCode, ok).toBe(204);
    }
    for (const bad of [
      'http://fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://evil.com/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://169.254.169.254%2efcm.googleapis.com/latest',
      'https://localhost%2efcm.googleapis.com/x',
      'https:fcm.googleapis.com/x',
      'https:/fcm.googleapis.com/x',
    ]) {
      expect((await post(bad, '10.2.9.2')).statusCode, bad).toBe(400);
      expect(await db.prisma.pushSubscription.count({ where: { endpoint: bad } })).toBe(0);
    }
  });

  it('isAllowedPushEndpoint: Randfälle', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:443/x')).toBe(false); // nicht kanonisch
    expect(isAllowedPushEndpoint('https://xfcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('nicht-eine-url')).toBe(false);
    expect(isAllowedPushEndpoint('https://FCM.googleapis.com/x')).toBe(false); // nicht kanonisch
    expect(isAllowedPushEndpoint('https://web.push.apple.com/x')).toBe(true);
  });

  it('Altbestand mit unbekanntem Host bleibt abmeldbar', async () => {
    const cookie = await loginAs('un10-b@example.com');
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un10-b@example.com' } });
    const endpoint = 'https://push.example/legacy';
    await db.prisma.pushSubscription.create({ data: { endpoint, p256dh: 'p', auth: 'a', userId: user.id } });
    const res = await app.inject({ method: 'DELETE', url: '/me/push-subscriptions', cookies: { session: cookie }, payload: { endpoint } });
    expect(res.statusCode).toBe(204);
    expect(await db.prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
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
