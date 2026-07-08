import { describe, it, expect, afterAll } from 'vitest';
import { makeTestDb, type TestDb } from '../test/helpers.js';
import { cleanupExpired } from './jobs.js';

async function makeUser(db: TestDb, email: string) {
  return db.prisma.user.create({ data: { email, name: email.split('@')[0] } });
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
