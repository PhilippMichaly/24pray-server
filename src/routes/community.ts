import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireUser } from '../plugins/auth.js';
import { canReadProject } from '../lib/access.js';
import { maskName } from '../lib/slotGrid.js';
import type { Env } from '../env.js';
import type { Mailer, UpdateNoticeMail } from '../lib/mailer.js';
import { unsubscribeUrl, verifyUnsubscribeSig } from '../lib/unsubscribe.js';
import { MailLocale } from '../schemas/auth.js';

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

/** Alle Update-Empfänger einer Wache: jede Person, die je eine Stunde gehalten oder gebucht hat
 *  (BOOKED + COMPLETED — wer mitgebetet hat, will vom Ausgang hören), dedupliziert pro E-Mail,
 *  ohne Opt-outs und ohne den Owner selbst. Locale: User-Präferenz, für Gäste die Buchungs-Sprache. */
interface UpdateRecipient { email: string; locale: string }

async function collectUpdateRecipients(
  prisma: PrismaClient,
  projectId: string,
  excludeEmail: string | null,
): Promise<UpdateRecipient[]> {
  const [slots, optOuts] = await Promise.all([
    prisma.prayerSlot.findMany({
      where: { projectId, status: { in: ['BOOKED', 'COMPLETED'] } },
      include: { user: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.updateOptOut.findMany({ where: { projectId } }),
  ]);
  const suppressed = new Set(optOuts.map((o) => o.email.toLowerCase()));
  if (excludeEmail) suppressed.add(excludeEmail.toLowerCase());
  const byEmail = new Map<string, UpdateRecipient>();
  for (const s of slots) {
    const email = s.user?.email ?? s.guestEmail;
    if (!email) continue; // Gast ohne E-Mail: kein Kanal
    const key = email.toLowerCase();
    if (suppressed.has(key) || byEmail.has(key)) continue;
    byEmail.set(key, { email, locale: s.user?.locale ?? s.locale });
  }
  return [...byEmail.values()];
}

const UnsubscribeQuery = z.object({
  email: z.string().email(),
  sig: z.string().min(1),
  locale: MailLocale.optional(),
});

// Bestätigungsseite in der Sprache der Mail, aus der geklickt wurde.
const UNSUB_CONFIRM: Record<string, { lang: string; dir: string; title: string; body: string }> = {
  de: { lang: 'de', dir: 'ltr', title: 'Abgemeldet', body: 'Du bekommst keine Update-Mails mehr zu dieser Gebetswache.' },
  en: { lang: 'en', dir: 'ltr', title: 'Unsubscribed', body: 'You will no longer receive update emails for this prayer watch.' },
  es: { lang: 'es', dir: 'ltr', title: 'Baja confirmada', body: 'Ya no recibirás correos de novedades de esta vigilia de oración.' },
  he: { lang: 'he', dir: 'rtl', title: 'הוסרת מהרשימה', body: 'לא תקבל/י עוד מיילים עם עדכונים עבור משמרת תפילה זו.' },
  ar: { lang: 'ar', dir: 'rtl', title: 'تم إلغاء الاشتراك', body: 'لن تصلك بعد الآن رسائل التحديثات لسهرة الصلاة هذه.' },
};

export function communityRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; mailer?: Mailer; env?: Env }) {
  const { prisma, mailer, env } = deps;
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
      throw httpError(403, 'Nur die Erstellerin/der Ersteller der Gebetswache kann Updates posten');
    }
    const authorName = user.name;
    const created = await prisma.prayerRequest.create({
      data: { projectId: project.id, authorId: user.id, authorName, text: body.text },
    });
    // Fan-out (Backlog 1): fire-and-forget — die Antwort auf den Post wartet nie auf SMTP.
    if (mailer?.sendUpdateNotice && env) {
      const mail = mailer.sendUpdateNotice.bind(mailer);
      void (async () => {
        const organizer = await prisma.user.findUniqueOrThrow({
          where: { id: project.organizerId }, select: { email: true },
        });
        const recipients = await collectUpdateRecipients(prisma, project.id, organizer.email);
        const invite = project.visibility === 'PRIVATE' ? `?invite=${project.inviteToken}` : '';
        const projectUrl = `${env.APP_URL}/projects/${project.id}${invite}`;
        for (const r of recipients) {
          const notice: UpdateNoticeMail = {
            projectTitle: project.title,
            authorName,
            text: body.text,
            projectUrl,
            unsubscribeUrl: unsubscribeUrl(env.APP_URL, env.UNSUBSCRIBE_SECRET, project.id, r.email, r.locale),
            locale: r.locale,
          };
          await mail(r.email, notice).catch((err) => console.error(`[mail] update notice failed for ${r.email}:`, err));
        }
      })().catch((err) => console.error('[mail] update fan-out failed:', err));
    }
    return { id: created.id, authorName, text: created.text, createdAt: created.createdAt.toISOString() };
  });

  // Abmelde-Link aus der Update-Mail (Backlog 1): login-frei, HMAC-signiert, idempotent.
  app.get('/projects/:id/updates/unsubscribe', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { email, sig, locale } = UnsubscribeQuery.parse(req.query);
    if (!env) throw httpError(500, 'Serverfehler');
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    if (!verifyUnsubscribeSig(env.UNSUBSCRIBE_SECRET, id, email, sig)) {
      throw httpError(403, 'Ungültiger Abmeldelink');
    }
    await prisma.updateOptOut.upsert({
      where: { projectId_email: { projectId: id, email: email.toLowerCase() } },
      update: {},
      create: { projectId: id, email: email.toLowerCase() },
    });
    const c = UNSUB_CONFIRM[locale ?? ''] ?? UNSUB_CONFIRM.de;
    reply.type('text/html; charset=utf-8');
    return `<!doctype html><html lang="${c.lang}" dir="${c.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.title} — 24pray</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center"><h1 style="font-size:1.3rem">${c.title}</h1><p>${c.body}</p></body></html>`;
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
    const [activeChains, heldSlots, completedRows, located] = await Promise.all([
      prisma.prayerProject.count({ where: activeWhere }),
      prisma.prayerSlot.count({ where: { status: { in: ['BOOKED', 'COMPLETED'] } } }),
      // Kumulative Gebets-Stunden (Backlog 2): COMPLETED-Slots gewichtet nach Projekt-Slot-Dauer
      // (60 vs. 1440 min) — ein Join-Aggregat statt N+1, läuft im TTL-Cache mit.
      prisma.$queryRaw<{ hours: number | null }[]>`
        SELECT SUM(p."slotDurationMinutes") / 60.0 AS hours
        FROM "PrayerSlot" s JOIN "PrayerProject" p ON p."id" = s."projectId"
        WHERE s."status" = 'COMPLETED'
      `,
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
    const completedHours = Math.round(Number(completedRows[0]?.hours ?? 0) * 100) / 100;
    const data = {
      activeChains,
      heldSlots,
      completedHours,
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
