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
      // Nerven-Netz (W3.5): aktive Ketten mit Standort + verortete Beter-Slots.
      // NUR Koordinaten — nie Namen/Titel; auch PRIVATE-Ketten bleiben anonym.
      prisma.prayerProject.findMany({
        // Punkt auf dem Globus: laufende UND geplante Ketten (Hoffnung leuchtet schon vorher);
        // das active-Flag der Links bleibt „betet in diesem Moment".
        where: {
          status: 'ACTIVE',
          endDate: { gte: now },
          locationLat: { not: null },
          locationLon: { not: null },
        },
        select: {
          id: true,
          title: true,
          visibility: true,
          locationName: true,
          locationLat: true,
          locationLon: true,
          slots: {
            where: {
              status: { in: ['BOOKED', 'COMPLETED'] },
              locationLat: { not: null },
              locationLon: { not: null },
            },
            select: { locationLat: true, locationLon: true, startTime: true, endTime: true, status: true },
            take: 40,
          },
        },
        take: 60,
      }),
    ]);
    return {
      activeChains,
      heldSlots,
      points: located.map((p) => ({
        lat: p.locationLat,
        lon: p.locationLon,
        // Fokus-Flug (W3.7): NUR öffentliche Ketten geben sich zu erkennen —
        // PRIVATE bleiben ein stilles, anonymes Licht.
        ...(p.visibility === 'PUBLIC'
          ? { id: p.id, title: p.title, locationName: p.locationName }
          : {}),
        links: p.slots.map((s) => ({
          lat: s.locationLat,
          lon: s.locationLon,
          // „gerade am Beten": Slot läuft in diesem Moment
          active: s.status === 'BOOKED' && s.startTime <= now && now < s.endTime,
        })),
      })),
    };
  });

  // ── Geocoding (W3.6, GeoNames cities15000) ─────────────

  app.get('/geocode', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req) => {
    const { q } = (req.query ?? {}) as { q?: string };
    const term = (q ?? '').trim().toLowerCase();
    if (term.length < 2) return [];
    const raw = await prisma.city.findMany({
      where: { search: { contains: term } },
      orderBy: { population: 'desc' },
      take: 30,
      select: { name: true, country: true, lat: true, lon: true, search: true },
    });
    // Ranking: Wortanfang (Name ODER irgendeine Sprachvariante) > Substring; dann Größe.
    const rank = (c: { name: string; search: string }) =>
      c.name.toLowerCase().startsWith(term) || c.search.startsWith(term) || c.search.includes(`,${term}`)
        ? 0
        : 1;
    return raw
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 8)
      .map(({ name, country, lat, lon }) => ({ name, country, lat, lon }));
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
