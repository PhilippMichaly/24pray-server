import { describe, it, expect, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../test/helpers.js';
import { pushToUsers, createPushSender } from './push.js';
import { parseEnv } from '../env.js';

describe('push lib (Backlog 7)', () => {
  it('createPushSender ist null ohne VAPID-Keys', () => {
    expect(createPushSender(parseEnv({ APP_URL: 'http://localhost:3000' }))).toBeNull();
  });

  it('pushToUsers sendet an alle Subs der User und räumt 410er auf', async () => {
    const db: TestDb = await makeTestDb();
    try {
      const u = await db.prisma.user.create({ data: { email: 'un7-push@example.com', name: 'un7' } });
      await db.prisma.pushSubscription.createMany({
        data: [
          { endpoint: 'https://fcm.googleapis.com/fcm/send/ok', p256dh: 'k1', auth: 'a1', userId: u.id },
          { endpoint: 'https://fcm.googleapis.com/fcm/send/gone', p256dh: 'k2', auth: 'a2', userId: u.id },
        ],
      });
      const sent: string[] = [];
      const sender = vi.fn(async (sub: { endpoint: string }) => {
        sent.push(sub.endpoint);
        if (sub.endpoint.endsWith('/gone')) {
          const e = new Error('gone') as Error & { statusCode?: number };
          e.statusCode = 410;
          throw e;
        }
      });
      await pushToUsers(db.prisma, sender, [u.id], { title: 't', body: 'b', url: 'https://x/p' });
      expect(sent.sort()).toEqual(['https://fcm.googleapis.com/fcm/send/gone', 'https://fcm.googleapis.com/fcm/send/ok']);
      const left = await db.prisma.pushSubscription.findMany({ where: { userId: u.id } });
      expect(left.map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/ok']); // 410er gelöscht
    } finally { await db.cleanup(); }
  });
  it('pushToUsers überspringt Alt-Endpoints fremder Hosts, löscht sie aber nicht', async () => {
    const db: TestDb = await makeTestDb();
    try {
      const u = await db.prisma.user.create({ data: { email: 'a10-push@example.com', name: 'a10' } });
      await db.prisma.pushSubscription.createMany({
        data: [
          { endpoint: 'https://fcm.googleapis.com/fcm/send/ok', p256dh: 'k1', auth: 'a1', userId: u.id },
          { endpoint: 'https://internal.example/legacy', p256dh: 'k2', auth: 'a2', userId: u.id },
        ],
      });
      const sender = vi.fn(async (_sub: { endpoint: string }) => {});
      await pushToUsers(db.prisma, sender, [u.id], { title: 't', body: 'b', url: 'https://x/p' });
      expect(sender.mock.calls.map((c) => c[0].endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/ok']);
      expect(await db.prisma.pushSubscription.count({ where: { userId: u.id } })).toBe(2);
    } finally { await db.cleanup(); }
  });
});
