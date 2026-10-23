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

const DAY = 86400_000;

describe('cleanupExpired — wb-unbestätigte Konten (N4)', () => {
  it('löscht nur unbestätigte, > 7 Tage alte User ohne jede Relation (samt abgelaufenen MagicTokens)', async () => {
    const db = await makeTestDb();
    try {
      const old = new Date(Date.now() - 8 * DAY);
      const mk = (email: string, data: { activatedAt?: Date; createdAt?: Date } = {}) =>
        db.prisma.user.create({ data: { email, name: email.split('@')[0], createdAt: old, ...data } });

      const orphan = await mk('wb-inactive-orphan@example.com');
      await db.prisma.magicToken.create({
        data: { token: 'wb-orphan-tok', userId: orphan.id, expiresAt: new Date(Date.now() - 7 * DAY) },
      });

      const activated = await mk('wb-inactive-activated@example.com', { activatedAt: old });
      const young = await mk('wb-inactive-young@example.com', { createdAt: new Date(Date.now() - 3 * DAY) });
      const organizer = await mk('wb-inactive-organizer@example.com');
      const booker = await mk('wb-inactive-booker@example.com');
      const member = await mk('wb-inactive-member@example.com');
      const recurrer = await mk('wb-inactive-recurring@example.com');
      const author = await mk('wb-inactive-author@example.com');
      const prefs = await mk('wb-inactive-pref@example.com');
      const pusher = await mk('wb-inactive-push@example.com');
      const sessioned = await mk('wb-inactive-session@example.com');
      const pendingLink = await mk('wb-inactive-pending@example.com');

      await makeDueProject(db, organizer.id, 'wb-Inactive-Own', 'wb-inactive-own');
      const project = await makeDueProject(db, activated.id, 'wb-Inactive-Host', 'wb-inactive-host');
      await db.prisma.prayerSlot.create({
        data: { projectId: project.id, userId: booker.id, startTime: project.startDate, endTime: project.endDate },
      });
      await db.prisma.membership.create({ data: { userId: member.id, projectId: project.id } });
      await db.prisma.recurringCommitment.create({ data: { userId: recurrer.id, projectId: project.id } });
      await db.prisma.prayerRequest.create({
        data: { projectId: project.id, authorId: author.id, authorName: 'A', text: 'Bitte' },
      });
      await db.prisma.reminderPreference.create({ data: { userId: prefs.id } });
      await db.prisma.pushSubscription.create({
        data: { endpoint: 'https://push.example/wb-inactive', p256dh: 'k', auth: 'a', userId: pusher.id },
      });
      await db.prisma.session.create({
        data: { token: 'wb-inactive-sess', userId: sessioned.id, expiresAt: new Date(Date.now() + DAY) },
      });
      // Gerade angeforderter Link (noch gültig): Klick darf nicht ins Leere laufen.
      await db.prisma.magicToken.create({
        data: { token: 'wb-pending-tok', userId: pendingLink.id, expiresAt: new Date(Date.now() + 15 * 60_000) },
      });

      const result = await cleanupExpired(db.prisma);
      expect(result.inactiveUsers).toBe(1);

      expect(await db.prisma.user.findUnique({ where: { id: orphan.id } })).toBeNull();
      expect(await db.prisma.magicToken.count({ where: { userId: orphan.id } })).toBe(0);
      for (const kept of [activated, young, organizer, booker, member, recurrer, author, prefs, pusher, sessioned, pendingLink]) {
        expect(await db.prisma.user.findUnique({ where: { id: kept.id } }), kept.email).not.toBeNull();
      }

      // Idempotent: zweiter Lauf löscht nichts mehr.
      expect((await cleanupExpired(db.prisma)).inactiveUsers).toBe(0);
    } finally {
      await db.cleanup();
    }
  });
});

describe('cleanupExpired — wb-Gast-Adressen-Retention (N10)', () => {
  it('leert guestEmail (nicht guestName) nur bei Slots von Projekten, die seit > 90 Tagen beendet sind', async () => {
    const db = await makeTestDb();
    try {
      const owner = await db.prisma.user.create({
        data: { email: 'wb-retention-owner@example.com', name: 'owner', activatedAt: new Date() },
      });
      const mkProject = (token: string, endDate: Date) =>
        db.prisma.prayerProject.create({
          data: {
            title: token, organizerId: owner.id, inviteToken: token,
            startDate: new Date(endDate.getTime() - DAY), endDate,
          },
        });
      const mkGuestSlot = (projectId: string, start: Date, email: string) =>
        db.prisma.prayerSlot.create({
          data: {
            projectId, startTime: start, endTime: new Date(start.getTime() + 3600_000),
            status: 'COMPLETED', guestName: 'Gast', guestEmail: email,
          },
        });

      const ancient = await mkProject('wb-ret-ancient', new Date(Date.now() - 100 * DAY));
      const recent = await mkProject('wb-ret-recent', new Date(Date.now() - 30 * DAY));
      const running = await mkProject('wb-ret-running', new Date(Date.now() + 10 * DAY));

      const s1 = await mkGuestSlot(ancient.id, ancient.startDate, 'old@example.com');
      const s2 = await mkGuestSlot(recent.id, recent.startDate, 'recent@example.com');
      const s3 = await mkGuestSlot(running.id, running.startDate, 'running@example.com');

      const result = await cleanupExpired(db.prisma);
      expect(result.guestEmails).toBe(1);

      const r1 = await db.prisma.prayerSlot.findUniqueOrThrow({ where: { id: s1.id } });
      expect(r1.guestEmail).toBeNull();
      expect(r1.guestName).toBe('Gast');
      expect((await db.prisma.prayerSlot.findUniqueOrThrow({ where: { id: s2.id } })).guestEmail).toBe('recent@example.com');
      expect((await db.prisma.prayerSlot.findUniqueOrThrow({ where: { id: s3.id } })).guestEmail).toBe('running@example.com');

      expect((await cleanupExpired(db.prisma)).guestEmails).toBe(0);
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
        data: { endpoint: 'https://fcm.googleapis.com/fcm/send/un7-remind', p256dh: 'k', auth: 'a', userId: user.id },
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
      expect(pushed[0].endpoint).toBe('https://fcm.googleapis.com/fcm/send/un7-remind');
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
