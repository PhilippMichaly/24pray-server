import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { generateToken } from '../lib/tokens.js';
import { requireUser } from '../plugins/auth.js';
import { BookSlotBody } from '../schemas/slots.js';
import { buildSlotGrid, slotLengthMs, type BookedSlotInput } from '../lib/slotGrid.js';
import { canReadProject, ensureMembership } from '../lib/access.js';

function httpError(status: number, message: string) {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = status;
  return e;
}

const CancelQuery = z.object({ guestToken: z.string().optional() });
const InviteQuery = z.object({ invite: z.string().optional() });

export function slotRoutes(app: FastifyInstance, deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  // Grid for a project (PRIVATE: Organizer, Mitglied oder ?invite=<token> — W3-Gap-Fix)
  app.get('/projects/:id/slots', async (req) => {
    const { id } = req.params as { id: string };
    const { invite } = InviteQuery.parse(req.query);
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    if (!(await canReadProject(prisma, project, req.user, invite))) {
      throw httpError(403, 'Kein Zugriff');
    }
    const slots = await prisma.prayerSlot.findMany({
      // COMPLETED zählt weiter als „gehalten" im Grid (vergangene Kettenglieder)
      where: { projectId: id, status: { in: ['BOOKED', 'COMPLETED'] } },
      include: { user: true },
    });
    const booked: BookedSlotInput[] = slots.map((s) => ({
      id: s.id,
      userId: s.userId,
      startTime: s.startTime,
      userName: s.user?.name ?? null,
      guestName: s.guestName,
    }));
    return buildSlotGrid(
      project.startDate,
      project.endDate,
      booked,
      req.user?.id ?? null,
      project.slotDurationMinutes,
      project.maskNames,
    );
  });

  // Book a slot
  app.post('/projects/:id/slots', async (req) => {
    const { id } = req.params as { id: string };
    const body = BookSlotBody.parse(req.body);
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');

    const startTime = new Date(body.startTime);
    const endTime = new Date(startTime.getTime() + slotLengthMs(project.slotDurationMinutes));
    if (startTime < project.startDate || endTime > project.endDate) {
      throw httpError(400, 'Zeitfenster liegt außerhalb des Projektzeitraums');
    }

    // Logged-in user OR guest (needs a name)
    const userId = req.user?.id ?? null;
    if (!userId && !body.guestName) throw httpError(400, 'Name erforderlich für Gastbuchung');

    const slot = await prisma.$transaction(async (tx) => {
      const existing = await tx.prayerSlot.findFirst({
        where: { projectId: id, startTime, status: { in: ['BOOKED', 'COMPLETED'] } },
      });
      if (existing) throw httpError(409, 'Dieses Zeitfenster ist bereits belegt');

      return tx.prayerSlot.create({
        data: {
          projectId: id,
          userId,
          startTime,
          endTime,
          status: 'BOOKED',
          guestName: userId ? null : body.guestName,
          guestEmail: userId ? null : body.guestEmail,
          // Gast: Secret fürs spätere Selbst-Storno minten (§6.3). Im Response enthalten.
          guestToken: userId ? null : generateToken(),
          notifyChannel: body.notifyChannel,
          locationLat: body.locationLat ?? null,
          locationLon: body.locationLon ?? null,
        },
      });
    });
    // Buchung macht eingeloggte User zu Mitgliedern (W3.2 Membership).
    if (userId) await ensureMembership(prisma, userId, id);
    return slot;
  });

  // W3.2: „Jede Woche übernehmen" — wöchentliche Wiederholung aus eigenem Slot materialisieren.
  // Endliche Projekt-Laufzeit → alle Folgetermine werden als echte Slots angelegt (Grid-Merge trivial).
  app.post('/slots/:id/recur', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const base = await prisma.prayerSlot.findUnique({ where: { id }, include: { project: true } });
    if (!base) throw httpError(404, 'Slot nicht gefunden');
    if (base.userId !== user.id) throw httpError(403, 'Nur der eigene Slot kann wiederholt werden');

    const WEEK = 7 * 24 * 3600_000;
    const slotMs = slotLengthMs(base.project.slotDurationMinutes);
    const created: string[] = [];

    const commitment = await prisma.recurringCommitment.create({
      data: { projectId: base.projectId, userId: user.id, slots: { connect: { id: base.id } } },
    });

    for (let t = base.startTime.getTime() + WEEK; t + slotMs <= base.project.endDate.getTime(); t += WEEK) {
      const startTime = new Date(t);
      try {
        const s = await prisma.$transaction(async (tx) => {
          const clash = await tx.prayerSlot.findFirst({
            where: { projectId: base.projectId, startTime, status: { in: ['BOOKED', 'COMPLETED'] } },
          });
          if (clash) return null; // belegte Folgewoche überspringen, nicht abbrechen
          return tx.prayerSlot.create({
            data: {
              projectId: base.projectId,
              userId: user.id,
              startTime,
              endTime: new Date(t + slotMs),
              status: 'BOOKED',
              notifyChannel: base.notifyChannel,
              recurringId: commitment.id,
            },
          });
        });
        if (s) created.push(s.id);
      } catch {
        // Race mit paralleler Buchung → wie Clash behandeln (überspringen)
      }
    }
    return { recurringId: commitment.id, createdSlotIds: created };
  });

  // Cancel a slot — booker, organizer (beide eingeloggt) ODER Gast per guestToken (§6.3)
  app.delete('/slots/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { guestToken } = CancelQuery.parse(req.query);
    const slot = await prisma.prayerSlot.findUnique({ where: { id }, include: { project: true } });
    if (!slot) throw httpError(404, 'Slot nicht gefunden');

    const user = req.user;
    const isBooker = !!user && slot.userId === user.id;
    const isOrganizer = !!user && slot.project.organizerId === user.id;
    // Gast-Pfad: slot.userId ist null → User-Prüfung greift nicht, Token-Vergleich ist zwingend.
    const isGuest = !user && !!guestToken && slot.guestToken === guestToken;
    if (!isBooker && !isOrganizer && !isGuest) {
      throw httpError(403, 'Nur Bucher, Organisator oder Gast (mit Token) dürfen stornieren');
    }
    await prisma.prayerSlot.update({ where: { id }, data: { status: 'CANCELLED' } });
    return reply.code(204).send();
  });
}
