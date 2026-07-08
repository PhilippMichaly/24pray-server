import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { requireUser } from '../plugins/auth.js';
import { UpdateMeBody } from '../schemas/me.js';
import { SESSION_COOKIE } from '../schemas/auth.js';

const DELETED_GUEST_NAME = '(gelöscht)';

export function meRoutes(app: FastifyInstance, deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  // Mini-Profil: Anzeigename ändern (Punkt 5).
  app.patch('/me', async (req) => {
    const user = requireUser(req);
    const { name } = UpdateMeBody.parse(req.body);
    const updated = await prisma.user.update({ where: { id: user.id }, data: { name } });
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      telegramChatId: updated.telegramChatId,
      createdAt: updated.createdAt.toISOString(),
    };
  });

  // Konto löschen (Punkt 2). Reihenfolge ist an die FK-Constraints gebunden
  // (siehe prisma/schema.prisma onDelete-Regeln): erst alles, was RESTRICT auf
  // User hat, abräumen — zuletzt den User selbst.
  app.delete('/me', async (req, reply) => {
    const user = requireUser(req);

    await prisma.$transaction(async (tx) => {
      // 1) Eigene organisierte Projekte KOMPLETT löschen — cascadet Slots,
      //    Memberships, RecurringCommitments und PrayerRequests dieser Projekte
      //    (auch Buchungen fremder User darin).
      await tx.prayerProject.deleteMany({ where: { organizerId: user.id } });

      // 2) Eigene RecurringCommitments in FREMDEN Projekten: löschen (setzt
      //    PrayerSlot.recurringId der betroffenen Slots via SetNull zurück).
      await tx.recurringCommitment.deleteMany({ where: { userId: user.id } });

      // 3) Eigene Buchungen in fremden Ketten (nach Schritt 1 sind alle
      //    verbleibenden Slots mit userId=user zwangsläufig in fremden Projekten):
      //    COMPLETED → anonymisieren (Statistik der fremden Kette bleibt korrekt);
      //    alles andere (BOOKED/CANCELLED) → löschen (Stunde wieder frei).
      await tx.prayerSlot.updateMany({
        where: { userId: user.id, status: 'COMPLETED' },
        data: { userId: null, guestName: DELETED_GUEST_NAME },
      });
      await tx.prayerSlot.deleteMany({
        where: { userId: user.id, status: { not: 'COMPLETED' } },
      });

      // 4) Restliche Zuordnungen des Users.
      await tx.membership.deleteMany({ where: { userId: user.id } });
      await tx.reminderPreference.deleteMany({ where: { userId: user.id } });
      await tx.magicToken.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });

      // 5) User selbst.
      await tx.user.delete({ where: { id: user.id } });
    });

    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
