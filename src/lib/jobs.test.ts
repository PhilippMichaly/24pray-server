import { describe, it, expect, afterAll, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../test/helpers.js';
import { cleanupExpired, sendDueReminders } from './jobs.js';
import type { PushPayload } from './push.js';

async function makeUser(db: TestDb, email: string) {
  return db.prisma.user.create({ data: { email, name: email.split('@')[0] } });
}

async function makeDueProject(db: TestDb, organizerId: string, title: string, token: string) {
  return db.prisma.prayerProject.create({
    data: {
      title,
      organizerId,
      inviteToken: token,
      startDate: new Date(Date.UTC(2026, 5, 20, 0, 0, 0)),
      endDate: new Date(Date.UTC(2026, 5, 20, 12, 0, 0)),
    },
  });
}

describe('cleanupExpired — wb-Aufräum-Job (Punkt 11)', () => {
  it('löscht abgelaufene Sessions (expiresAt < now)', async () => {
    const db = await makeTestDb();
    try {
      const user = await makeUser(db, 'wb-cleanup-session@example.com');
      const expired = await db.prisma.session.create({
        data: { token: 'wb-expired-session', userId: user.id, expiresAt: new Date(Date.now() - 1000) },
      });
      const valid = await db.prisma.session.create({
        data: { token: 'wb-valid-session', userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
      });

      const result = await cleanupExpired(db.prisma);
      expect(result.sessions).toBe(1);

      expect(await db.prisma.session.findUnique({ where: { id: expired.id } })).toBeNull();
      expect(await db.prisma.session.findUnique({ where: { id: valid.id } })).not.toBeNull();
    } finally {
      await db.cleanup();
    }
  });

  it('löscht MagicTokens erst 1h nach Ablauf (Kulanzfenster, kein sofortiges Löschen)', async () => {
    const db = await makeTestDb();
    try {
      const user = await makeUser(db, 'wb-cleanup-token@example.com');
      const longExpired = await db.prisma.magicToken.create({
        data: { token: 'wb-long-expired', userId: user.id, expiresAt: new Date(Date.now() - 2 * 3600_000) },
      });
      const recentlyExpired = await db.prisma.magicToken.create({
        data: { token: 'wb-recently-expired', userId: user.id, expiresAt: new Date(Date.now() - 5 * 60_000) },
      });
      const stillValid = await db.prisma.magicToken.create({
        data: { token: 'wb-still-valid', userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
      });

      const result = await cleanupExpired(db.prisma);
      expect(result.magicTokens).toBe(1);

      expect(await db.prisma.magicToken.findUnique({ where: { id: longExpired.id } })).toBeNull();
      expect(await db.prisma.magicToken.findUnique({ where: { id: recentlyExpired.id } })).not.toBeNull();
      expect(await db.prisma.magicToken.findUnique({ where: { id: stillValid.id } })).not.toBeNull();
    } finally {
      await db.cleanup();
    }
  });
});

describe('sendDueReminders — Push-Zweitkanal (Backlog 7)', () => {
  const appUrl = 'https://un7.example.com';

  it('Backlog 7: fällige Erinnerung pusht zusätzlich an die Geräte des Users', async () => {
    const db = await makeTestDb();
    try {
      const user = await makeUser(db, 'un7-remind-push@example.com');
      const project = await makeDueProject(db, user.id, 'un7 Push Reminder', 'un7-remind-push-token');
      const startTime = new Date(Date.UTC(2026, 5, 20, 8, 0, 0));
      await db.prisma.prayerSlot.create({
        data: {
          projectId: project.id,
          userId: user.id,
          startTime,
          endTime: new Date(startTime.getTime() + 3600_000),
        },
      });
      await db.prisma.pushSubscription.create({
        data: { endpoint: 'https://push.example/un7-remind', p256dh: 'k', auth: 'a', userId: user.id },
      });

      const reminders: { email: string }[] = [];
      const mailer = { async sendReminder(email: string) { reminders.push({ email }); } };
      const pushed: { endpoint: string; payload: PushPayload }[] = [];
      const fakeSender = async (sub: { endpoint: string }, payload: PushPayload) => {
        pushed.push({ endpoint: sub.endpoint, payload });
      };

      const dueNow = new Date(Date.UTC(2026, 5, 20, 7, 30, 0)); // 30min vor Start, 60min-Default-Vorlauf
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sent = await sendDueReminders(db.prisma, mailer as any, dueNow, appUrl, fakeSender);
      expect(sent).toBe(1);
      expect(reminders.length).toBe(1); // Mail-Kanal bleibt unverändert (Zweitkanal!)

      await vi.waitFor(() => expect(pushed.length).toBe(1)); // fire-and-forget
      expect(pushed[0].endpoint).toBe('https://push.example/un7-remind');
      expect(pushed[0].payload.title).toContain('un7 Push Reminder');
      expect(pushed[0].payload.url).toBe(`${appUrl}/projects/${project.id}`);
    } finally {
      await db.cleanup();
    }
  });

  it('Backlog 7: Gast-Slot (ohne userId) erzeugt keinen Push, Job läuft fehlerfrei', async () => {
    const db = await makeTestDb();
    try {
      const owner = await makeUser(db, 'un7-remind-owner@example.com');
      const project = await makeDueProject(db, owner.id, 'un7 Push Guest', 'un7-remind-guest-token');
      const startTime = new Date(Date.UTC(2026, 5, 20, 8, 0, 0));
      await db.prisma.prayerSlot.create({
        data: {
          projectId: project.id,
          guestEmail: 'un7-remind-guest@example.com',
          guestName: 'Gast',
          startTime,
          endTime: new Date(startTime.getTime() + 3600_000),
        },
      });

      const reminders: { email: string }[] = [];
      const mailer = { async sendReminder(email: string) { reminders.push({ email }); } };
      const pushed: { endpoint: string; payload: PushPayload }[] = [];
      const fakeSender = async (sub: { endpoint: string }, payload: PushPayload) => {
        pushed.push({ endpoint: sub.endpoint, payload });
      };

      const dueNow = new Date(Date.UTC(2026, 5, 20, 7, 30, 0));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sent = await sendDueReminders(db.prisma, mailer as any, dueNow, appUrl, fakeSender);
      expect(sent).toBe(1);
      expect(reminders.length).toBe(1);
      expect(pushed.length).toBe(0);
    } finally {
      await db.cleanup();
    }
  });
});
