import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireUser } from '../plugins/auth.js';
import { canReadProject } from '../lib/access.js';
import { maskName } from '../lib/slotGrid.js';

function httpError(status: number, message: string) {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = status;
  return e;
}

const InviteQuery = z.object({ invite: z.string().optional() });
const CreateRequestBody = z.object({
  text: z.string().min(2).max(1000),
  authorName: z.string().min(2).max(80).optional(), // Pflicht für Gäste
});
const ReminderBody = z.object({ minutesBefore: z.number().int().min(5).max(24 * 60) });

export function communityRoutes(app: FastifyInstance, deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  async function loadProjectChecked(req: FastifyRequest) {
    const { id } = req.params as { id: string };
    const { invite } = InviteQuery.parse(req.query);
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    if (!(await canReadProject(prisma, project, req.user, invite))) throw httpError(403, 'Kein Zugriff');
    return project;
  }

  // ── Anliegen-Feed (W3.2) ────────────────────────────────

  app.get('/projects/:id/requests', async (req) => {
    const project = await loadProjectChecked(req);
    const items = await prisma.prayerRequest.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const anonymous = !req.user;
    return items.map((r) => ({
      id: r.id,
      authorName: anonymous ? maskName(r.authorName) : r.authorName, // §E5 auch im Feed
      text: r.text,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  app.post('/projects/:id/requests', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const project = await loadProjectChecked(req);
    const body = CreateRequestBody.parse(req.body);
    const user = req.user;
    const authorName = user?.name ?? body.authorName;
    if (!authorName) throw httpError(400, 'Name erforderlich');
    const created = await prisma.prayerRequest.create({
      data: { projectId: project.id, authorId: user?.id ?? null, authorName, text: body.text },
    });
    return { id: created.id, authorName, text: created.text, createdAt: created.createdAt.toISOString() };
  });

  // ── Statistik (W3.2, aus COMPLETED-Slots) ───────────────

  app.get('/projects/:id/stats', async (req) => {
    const project = await loadProjectChecked(req);
    const done = await prisma.prayerSlot.findMany({
      where: { projectId: project.id, status: 'COMPLETED' },
      include: { user: true },
    });
    const hoursPerSlot = project.slotDurationMinutes / 60;
    const byPerson = new Map<string, { name: string; hours: number }>();
    for (const s of done) {
      const key = s.userId ?? `guest:${s.guestName ?? '?'}`;
      const name = s.user?.name ?? s.guestName ?? '—';
      const e = byPerson.get(key) ?? { name, hours: 0 };
      e.hours += hoursPerSlot;
      byPerson.set(key, e);
    }
    const anonymous = !req.user;
    const perPerson = [...byPerson.values()]
      .sort((a, b) => b.hours - a.hours)
      .map((p) => ({ name: anonymous ? maskName(p.name) : p.name, hours: Math.round(p.hours * 100) / 100 }));
    return {
      completedHours: Math.round(done.length * hoursPerSlot * 100) / 100,
      perPerson,
    };
  });

  // ── Public-Stats für die Landing (Globus) ───────────────

  app.get('/stats/public', async () => {
    const now = new Date();
    const activeWhere = { status: 'ACTIVE', startDate: { lte: now }, endDate: { gte: now } };
    const [activeChains, heldSlots, located] = await Promise.all([
      prisma.prayerProject.count({ where: activeWhere }),
      prisma.prayerSlot.count({ where: { status: { in: ['BOOKED', 'COMPLETED'] } } }),
      // Echte Globus-Punkte: aktive Ketten mit freiwilligem Standort (nur Koordinaten,
      // kein Name/Titel — auch PRIVATE-Ketten bleiben so anonym).
      prisma.prayerProject.findMany({
        where: { ...activeWhere, locationLat: { not: null }, locationLon: { not: null } },
        select: { locationLat: true, locationLon: true },
        take: 60,
      }),
    ]);
    return {
      activeChains,
      heldSlots,
      points: located.map((p) => ({ lat: p.locationLat, lon: p.locationLon })),
    };
  });

  // ── Reminder-Preference (W3.2) ──────────────────────────

  app.get('/me/reminder', async (req) => {
    const user = requireUser(req);
    const pref = await prisma.reminderPreference.findUnique({ where: { userId: user.id } });
    return { minutesBefore: pref?.minutesBefore ?? 60, channel: pref?.channel ?? 'EMAIL' };
  });

  app.put('/me/reminder', async (req) => {
    const user = requireUser(req);
    const { minutesBefore } = ReminderBody.parse(req.body);
    const pref = await prisma.reminderPreference.upsert({
      where: { userId: user.id },
      update: { minutesBefore },
      create: { userId: user.id, minutesBefore },
    });
    return { minutesBefore: pref.minutesBefore, channel: pref.channel };
  });
}
