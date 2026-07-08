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

export function communityRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; env?: { STATS_CACHE_TTL_MS: number } }) {
  const { prisma, env } = deps;
  // Lasttest-Fix: Landing-Poll (60s pro offenem Tab) darf nicht mit der Nutzerzahl skalieren.
  let statsCache: { data: unknown; ts: number } | null = null;

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
    const anonymous = !req.user && project.maskNames; // Masking nur bei Projekt-Opt-in
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
    // Eine Kette = EIN Anliegen des Erstellers: nur der Owner postet Updates dazu;
    // alle anderen (Gäste wie Eingeloggte) tragen ausschließlich Gebetsstunden bei.
    if (!user || user.id !== project.organizerId) {
      throw httpError(403, 'Nur die Erstellerin/der Ersteller der Wache kann Updates posten');
    }
    const authorName = user.name;
    const created = await prisma.prayerRequest.create({
      data: { projectId: project.id, authorId: user.id, authorName, text: body.text },
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
    const anonymous = !req.user && project.maskNames; // Masking nur bei Projekt-Opt-in
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
    const ttl = env?.STATS_CACHE_TTL_MS ?? 0;
    if (ttl > 0 && statsCache && Date.now() - statsCache.ts < ttl) return statsCache.data;
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
    const data = {
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
    statsCache = { data, ts: Date.now() };
    return data;
  });

  // ── Geocoding (W3.6, GeoNames cities500) ────────────────

  // Diakritik-/Case-insensitiver Normalname für den Exakt-Match-Vergleich (Rang 0).
  // Deckt sich bewusst NICHT mit Transliterationen ("ue" statt "ü") — das übernimmt
  // schon der `search`-Blob mit seinen expliziten Sprachvarianten.
  function normalizeName(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  app.get('/geocode', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req) => {
    const { q } = (req.query ?? {}) as { q?: string };
    const term = (q ?? '').trim().toLowerCase();
    if (term.length < 2) return [];
    // Präfix-Query über den FTS5-Index (city_fts, external-content auf City, siehe
    // Migration 20260708140000_add_city_fts_search) statt LIKE %term% + Populations-Scan —
    // löst seltene Namen (z.B. "petershausen") in <1ms statt ~220ms auf, weil SQLite nur
    // im invertierten Index sucht statt der Population-Reihenfolge nach Treffern zu jagen.
    // Ganze Phrase in Anführungszeichen (innere Quotes verdoppelt escaped) + `*`
    // = Präfix-Match auf das letzte Token einer Phrase — verhindert außerdem, dass
    // FTS5-Operatoren (AND/OR/NOT/^/-) aus Nutzereingaben interpretiert werden.
    const ftsQuery = `"${term.replace(/"/g, '""')}"*`;
    const raw = await prisma.$queryRaw<
      { name: string; country: string; lat: number; lon: number; population: number; search: string }[]
    >`
      SELECT c."name" as name, c."country" as country, c."lat" as lat, c."lon" as lon, c."population" as population, c."search" as search
      FROM "City" c
      JOIN (SELECT "rowid" FROM "city_fts" WHERE "city_fts" MATCH ${ftsQuery}) f ON f."rowid" = c."id"
      ORDER BY c."population" DESC
      LIMIT 200
    `;
    // Ranking: exakter Normalname-Match > Wortanfang (Name ODER irgendeine Sprachvariante
    // im `search`-Blob) > Rest; bei Gleichstand (z.B. cities500-Kollisionen wie "München"
    // vs. "Münchenroda", oder "Petershausen" vs. "Petershausen-West/-Ost") explizit nach
    // Einwohnerzahl absteigend — nicht auf DB-orderBy + Sort-Stabilität allein verlassen.
    const normTerm = normalizeName(term);
    const rank = (c: { name: string; search: string }) => {
      if (normalizeName(c.name) === normTerm) return 0; // exakter Treffer gewinnt IMMER
      if (c.name.toLowerCase().startsWith(term) || c.search.startsWith(term) || c.search.includes(`,${term}`)) {
        return 1; // Wortanfang (Name oder Sprachvariante)
      }
      return 2; // FTS liefert i.d.R. nur Präfix-Treffer, Rest ist ein Sicherheitsnetz
    };
    return raw
      .sort((a, b) => rank(a) - rank(b) || b.population - a.population)
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
