import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { generateToken } from '../lib/tokens.js';
import { BookSlotBody } from '../schemas/slots.js';
import { buildSlotGrid, slotLengthMs, type BookedSlotInput } from '../lib/slotGrid.js';

function httpError(status: number, message: string) {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = status;
  return e;
}

const CancelQuery = z.object({ guestToken: z.string().optional() });

export function slotRoutes(app: FastifyInstance, deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  // Grid for a project
  app.get('/projects/:id/slots', async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    if (project.visibility === 'PRIVATE' && req.user?.id !== project.organizerId) {
      throw httpError(403, 'Kein Zugriff');
    }
    const slots = await prisma.prayerSlot.findMany({
      where: { projectId: id, status: 'BOOKED' },
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

    return prisma.$transaction(async (tx) => {
      const existing = await tx.prayerSlot.findFirst({
        where: { projectId: id, startTime, status: 'BOOKED' },
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
        },
      });
    });
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
