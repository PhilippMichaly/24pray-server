import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { requireUser } from '../plugins/auth.js';
import { BookSlotBody } from '../schemas/slots.js';
import { buildSlotGrid, SLOT_LENGTH_MS, type BookedSlotInput } from '../lib/slotGrid.js';

function httpError(status: number, message: string) {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = status;
  return e;
}

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
      startTime: s.startTime,
      userName: s.user?.name ?? null,
      guestName: s.guestName,
    }));
    return buildSlotGrid(project.startDate, project.endDate, booked);
  });

  // Book a slot
  app.post('/projects/:id/slots', async (req) => {
    const { id } = req.params as { id: string };
    const body = BookSlotBody.parse(req.body);
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');

    const startTime = new Date(body.startTime);
    const endTime = new Date(startTime.getTime() + SLOT_LENGTH_MS);
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
          notifyChannel: body.notifyChannel,
        },
      });
    });
  });

  // Cancel a slot (booker or organizer)
  app.delete('/slots/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const slot = await prisma.prayerSlot.findUnique({ where: { id }, include: { project: true } });
    if (!slot) throw httpError(404, 'Slot nicht gefunden');
    const isBooker = slot.userId === user.id;
    const isOrganizer = slot.project.organizerId === user.id;
    if (!isBooker && !isOrganizer) throw httpError(403, 'Nur Bucher oder Organisator dürfen stornieren');
    await prisma.prayerSlot.update({ where: { id }, data: { status: 'CANCELLED' } });
    return reply.code(204).send();
  });
}
