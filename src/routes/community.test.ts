import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';
import { completeElapsedSlots, sendDueReminders } from '../lib/jobs.js';
import type { ReminderMail } from '../lib/mailer.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string }[] = [];
const reminders: { email: string; r: ReminderMail }[] = [];

let loginSeq = 0;
async function loginAs(email: string): Promise<string> {
  const remoteAddress = `10.1.0.${++loginSeq}`;
  await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email }, remoteAddress });
  const token = new URL(captured.at(-1)!.url).searchParams.get('token')!;
  const verify = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token }, remoteAddress });
  return verify.cookies.find((c) => c.name === 'session')!.value;
}

beforeAll(async () => {
  db = await makeTestDb();
  app = await buildApp({
    prisma: db.prisma,
    env: parseEnv({ APP_URL: 'http://localhost:3000', STATS_CACHE_TTL_MS: '0' }),
    mailer: {
      async sendMagicLink(email, url) { captured.push({ email, url }); },
      async sendReminder(email, r) { reminders.push({ email, r }); },
    },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

const HOUR = 3600_000;
const at = (h: number) => new Date(Date.UTC(2026, 5, 20, h, 0, 0)).toISOString();

async function makePrivateProject(cookie: string): Promise<{ id: string; inviteToken: string }> {
  const res = await app.inject({
    method: 'POST', url: '/projects', cookies: { session: cookie },
    payload: { title: 'Privat', startDate: at(0), endDate: at(12), visibility: 'PRIVATE' },
  });
  return { id: res.json().id, inviteToken: res.json().inviteToken };
}

describe('W3 — Invite-Gap (PRIVATE + ?invite)', () => {
  it('Gast liest PRIVATE Projekt + Grid nur mit gültigem invite-Token', async () => {
    const owner = await loginAs('w3-owner@example.com');
    const { id, inviteToken } = await makePrivateProject(owner);

    // ohne Token: 403
    expect((await app.inject({ method: 'GET', url: `/projects/${id}` })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/projects/${id}/slots` })).statusCode).toBe(403);
    // mit Token: 200
    expect((await app.inject({ method: 'GET', url: `/projects/${id}?invite=${inviteToken}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/projects/${id}/slots?invite=${inviteToken}` })).statusCode).toBe(200);
    // falscher Token: 403
    expect((await app.inject({ method: 'GET', url: `/projects/${id}?invite=falsch` })).statusCode).toBe(403);
  });

  it('Mitglied (per Buchung) liest PRIVATE Projekt auch ohne Token', async () => {
    const owner = await loginAs('w3-owner2@example.com');
    const { id } = await makePrivateProject(owner);
    const member = await loginAs('w3-member@example.com');
    // Buchen (POST ist offen) → Membership
    const book = await app.inject({
      method: 'POST', url: `/projects/${id}/slots`, cookies: { session: member },
      payload: { startTime: at(2) },
    });
    expect(book.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/projects/${id}`, cookies: { session: member } })).statusCode).toBe(200);
  });
});

describe('W3 — Anliegen-Feed', () => {
  it('post + get, Namen für Anonyme maskiert', async () => {
    const owner = await loginAs('w3-req@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'FeedTest', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    // Eine Kette = ein Anliegen des Erstellers: NUR der Owner postet Updates (2026-07-08).
    await db.prisma.user.update({ where: { email: 'w3-req@example.com' }, data: { name: 'Ruth Klein' } });
    const p1 = await app.inject({
      method: 'POST', url: `/projects/${id}/requests`, cookies: { session: owner },
      payload: { text: 'Bitte betet für Lena.' },
    });
    expect(p1.statusCode).toBe(200);
    const guest = await app.inject({
      method: 'POST', url: `/projects/${id}/requests`, payload: { text: 'Ich bete mit.', authorName: 'Gast G' },
    });
    expect(guest.statusCode).toBe(403); // Gast darf nur Slots buchen
    const otherUser = await loginAs('w3-other@example.com');
    const foreign = await app.inject({
      method: 'POST', url: `/projects/${id}/requests`, cookies: { session: otherUser },
      payload: { text: 'Auch von mir.' },
    });
    expect(foreign.statusCode).toBe(403); // eingeloggt ≠ Owner → ebenfalls nur Slots

    const anon = await app.inject({ method: 'GET', url: `/projects/${id}/requests` });
    expect(anon.json()[0].authorName).toBe('Ruth Klein'); // Default: Klartext auch anonym

    // Opt-in-Masking: eigenes Projekt mit maskNames=true
    const resM = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'FeedTest maskiert', startDate: at(0), endDate: at(6), visibility: 'PUBLIC', maskNames: true },
    });
    const idM = resM.json().id;
    await app.inject({
      method: 'POST', url: `/projects/${idM}/requests`, cookies: { session: owner },
      payload: { text: 'Diskretes Anliegen.' },
    });
    const anonM = await app.inject({ method: 'GET', url: `/projects/${idM}/requests` });
    expect(anonM.json()[0].authorName).toBe('Ruth K.'); // Opt-in: maskiert (§E5)
    const authed = await app.inject({ method: 'GET', url: `/projects/${id}/requests`, cookies: { session: owner } });
    expect(authed.json()[0].authorName).toBe('Ruth Klein');
  });
});

describe('W3 — Jobs + Statistik', () => {
  it('completeElapsedSlots setzt abgelaufene BOOKED auf COMPLETED; Stats zählen Stunden', async () => {
    const owner = await loginAs('w3-stats@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'Stats', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`, cookies: { session: owner }, payload: { startTime: at(1) } });
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`, cookies: { session: owner }, payload: { startTime: at(2) } });

    // „Jetzt" = 04:00 → Slots 1-2 und 2-3 sind vorbei
    const n = await completeElapsedSlots(db.prisma, new Date(at(4)));
    expect(n).toBeGreaterThanOrEqual(2);

    const stats = await app.inject({ method: 'GET', url: `/projects/${id}/stats`, cookies: { session: owner } });
    expect(stats.json().completedHours).toBe(2);
    expect(stats.json().perPerson[0].hours).toBe(2);
  });

  it('sendDueReminders schickt genau einmal, innerhalb des Vorlaufs', async () => {
    const owner = await loginAs('w3-remind@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'Remind', startDate: at(0), endDate: at(12), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`, cookies: { session: owner }, payload: { startTime: at(8) } });

    reminders.length = 0;
    // 06:00 → 2h Vorlauf > 60min-Default: noch nichts
    expect(await sendDueReminders(db.prisma, app0Mailer(), new Date(Date.UTC(2026, 5, 20, 6, 0, 0)))).toBe(0);
    // 07:30 → innerhalb 60min: genau 1
    const dueNow = new Date(Date.UTC(2026, 5, 20, 7, 30, 0));
    expect(await sendDueReminders(db.prisma, app0Mailer(), dueNow)).toBe(1);
    expect(reminders.at(-1)!.email).toBe('w3-remind@example.com');
    // idempotent
    expect(await sendDueReminders(db.prisma, app0Mailer(), dueNow)).toBe(0);
  });
});

function app0Mailer() {
  return {
    async sendMagicLink() {},
    async sendReminder(email: string, r: ReminderMail) { reminders.push({ email, r }); },
  };
}

describe('W3.4 — Geo-Standorte', () => {
  it('Projekt mit Standort taucht in /stats/public points auf (nur Koordinaten)', async () => {
    const owner = await loginAs('w3-geo@example.com');
    const now = Date.now();
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: {
        title: 'Geo', startDate: new Date(now - 3600_000).toISOString(),
        endDate: new Date(now + 24 * 3600_000).toISOString(), visibility: 'PRIVATE',
        locationName: 'Berlin', locationLat: 52.52, locationLon: 13.4,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().locationName).toBe('Berlin');

    const stats = await app.inject({ method: 'GET', url: '/stats/public' });
    const pts = stats.json().points as { lat: number; lon: number }[];
    expect(pts.some((p) => Math.abs(p.lat - 52.52) < 0.01 && Math.abs(p.lon - 13.4) < 0.01)).toBe(true);
    // Kein Titel/Name im Public-Feed
    expect(JSON.stringify(stats.json())).not.toContain('Geo');
    expect(JSON.stringify(stats.json())).not.toContain('Berlin');
  });

  it('verorteter Beter-Slot erscheint als Link mit active-Flag (W3.5, nur Koordinaten)', async () => {
    const owner = await loginAs('w3-net@example.com');
    const now = Date.now();
    const hourStart = new Date(Math.floor(now / 3600_000) * 3600_000 - 3600_000); // laufende Stunde inkl. now
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: {
        title: 'Netz', startDate: hourStart.toISOString(),
        endDate: new Date(hourStart.getTime() + 24 * 3600_000).toISOString(), visibility: 'PUBLIC',
        locationName: 'Köln', locationLat: 50.94, locationLon: 6.96,
      },
    });
    const id = res.json().id;
    // Gast bucht die GERADE LAUFENDE Stunde mit Standort Nairobi
    const runningStart = new Date(Math.floor(now / 3600_000) * 3600_000);
    const book = await app.inject({
      method: 'POST', url: `/projects/${id}/slots`,
      payload: {
        startTime: runningStart.toISOString(), guestName: 'Grace W', guestEmail: 'g@x.de',
        locationLat: -1.29, locationLon: 36.82,
      },
    });
    expect(book.statusCode).toBe(200);

    const stats = await app.inject({ method: 'GET', url: '/stats/public' });
    const koeln = (stats.json().points as { lat: number; links: { lat: number; active: boolean }[] }[])
      .find((p) => Math.abs(p.lat - 50.94) < 0.01);
    expect(koeln).toBeTruthy();
    expect(koeln!.links.length).toBe(1);
    expect(Math.abs(koeln!.links[0].lat - -1.29)).toBeLessThan(0.01);
    expect(koeln!.links[0].active).toBe(true); // läuft JETZT
    expect(JSON.stringify(stats.json())).not.toContain('Grace'); // Privacy
    // W3.7: PUBLIC-Kette gibt sich zu erkennen (Fokus-Flug), PRIVATE nicht
    expect((koeln as { title?: string }).title).toBe('Netz');
    const berlinPrivat = (stats.json().points as { lat: number; title?: string }[])
      .find((p) => Math.abs(p.lat - 52.52) < 0.01);
    expect(berlinPrivat?.title).toBeUndefined();
  });
});

describe('W3.5-Fix — Ort nachträglich + geplante Ketten leuchten', () => {
  it('PATCH setzt Ort (nur Organizer); GEPLANTE Kette erscheint in points', async () => {
    const owner = await loginAs('w3-patchloc@example.com');
    const now = Date.now();
    // Kette startet erst MORGEN → zählt nicht als „brennt gerade", soll aber leuchten
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: {
        title: 'Geplant', startDate: new Date(now + 24 * 3600_000).toISOString(),
        endDate: new Date(now + 48 * 3600_000).toISOString(), visibility: 'PRIVATE',
      },
    });
    const id = res.json().id;
    // Ort nachträglich setzen
    const patch = await app.inject({
      method: 'PATCH', url: `/projects/${id}`, cookies: { session: owner },
      payload: { locationName: 'Siegen', locationLat: 50.87, locationLon: 8.02 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().locationName).toBe('Siegen');
    // Fremder darf nicht patchen
    const mallory = await loginAs('w3-mallory-loc@example.com');
    const forbidden = await app.inject({
      method: 'PATCH', url: `/projects/${id}`, cookies: { session: mallory },
      payload: { locationName: 'Berlin', locationLat: 52.5, locationLon: 13.4 },
    });
    expect(forbidden.statusCode).toBe(403);
    // Geplante Kette leuchtet in points (auch wenn activeChains sie nicht zählt)
    const stats = await app.inject({ method: 'GET', url: '/stats/public' });
    const pts = stats.json().points as { lat: number }[];
    expect(pts.some((p) => Math.abs(p.lat - 50.87) < 0.01)).toBe(true);
  });
});

describe('W3.6 — Geocoding', () => {
  it('/geocode findet Städte über alle Sprachvarianten, sortiert nach Größe', async () => {
    await db.prisma.city.createMany({
      data: [
        { id: 1, name: 'Munich', country: 'DE', lat: 48.14, lon: 11.58, population: 1_500_000, search: 'munich,munchen,münchen,muenchen' },
        { id: 2, name: 'Münster', country: 'DE', lat: 51.96, lon: 7.63, population: 300_000, search: 'munster,münster,muenster' },
        { id: 3, name: 'Siegen', country: 'DE', lat: 50.87, lon: 8.02, population: 107_000, search: 'siegen,zigen' },
      ],
    });
    // deutscher Name findet den englischen Eintrag
    const r1 = await app.inject({ method: 'GET', url: '/geocode?q=m%C3%BCnchen' });
    expect(r1.json()[0].name).toBe('Munich');
    // Präfix + Populations-Sortierung
    const r2 = await app.inject({ method: 'GET', url: '/geocode?q=m%C3%BCn' });
    expect(r2.json().map((c: { name: string }) => c.name)).toEqual(['Munich', 'Münster']);
    // zu kurz → leer
    expect((await app.inject({ method: 'GET', url: '/geocode?q=m' })).json()).toEqual([]);
  });

  it('Populations-Tiebreak: bei gleicher Wortanfang-Güte gewinnt die größere Stadt (cities500-Kollisionen)', async () => {
    // "münchenroda".startsWith("münchen") → gleicher Rang (0) wie "münchen" selbst;
    // ohne Tiebreak könnte die 600-Seelen-Gemeinde vor der Millionenstadt landen.
    await db.prisma.city.deleteMany(); // isoliert von Fixtures des vorigen Tests
    await db.prisma.city.createMany({
      data: [
        { id: 101, name: 'Münchenroda', country: 'DE', lat: 50.95, lon: 11.6, population: 600, search: 'münchenroda,muenchenroda' },
        { id: 102, name: 'München', country: 'DE', lat: 48.14, lon: 11.58, population: 1_500_000, search: 'münchen,muenchen,munich' },
        { id: 103, name: 'Münchenbernsdorf', country: 'DE', lat: 50.79, lon: 11.78, population: 900, search: 'münchenbernsdorf,muenchenbernsdorf' },
      ],
    });
    const r = await app.inject({ method: 'GET', url: '/geocode?q=m%C3%BCnchen' });
    expect(r.json().map((c: { name: string }) => c.name)).toEqual(['München', 'Münchenbernsdorf', 'Münchenroda']);
  });

  it('findet ein Dorf ≥500 EW (cities500-Abdeckung, z.B. Petershausen bei München)', async () => {
    await db.prisma.city.deleteMany();
    await db.prisma.city.createMany({
      data: [
        { id: 201, name: 'Petershausen', country: 'DE', lat: 48.40967, lon: 11.47056, population: 5965, search: 'petershausen' },
      ],
    });
    const r = await app.inject({ method: 'GET', url: '/geocode?q=petershausen' });
    const names = r.json().map((c: { name: string }) => c.name);
    expect(names).toContain('Petershausen');
  });

  it('Exakt-Boost: "Petershausen" (Dorf, Bayern) schlägt "Petershausen-West/-Ost" (Konstanzer Stadtteile, mehr EW)', async () => {
    // Vorher: reines Populations-Ranking hätte die einwohnerstärkeren Konstanzer
    // Stadtteile vor den exakt passenden Bayern-Ort gestellt. Ein exakter
    // Normalname-Match (case-/diakritik-insensitiv) muss IMMER zuerst kommen,
    // egal wie klein der Ort ist — danach zählt erst die Population.
    await db.prisma.city.deleteMany();
    await db.prisma.city.createMany({
      data: [
        { id: 201, name: 'Petershausen', country: 'DE', lat: 48.40967, lon: 11.47056, population: 5965, search: 'petershausen' },
        { id: 202, name: 'Petershausen-West', country: 'DE', lat: 47.6712, lon: 9.1543, population: 12000, search: 'petershausen-west' },
        { id: 203, name: 'Petershausen-Ost', country: 'DE', lat: 47.6745, lon: 9.1789, population: 11000, search: 'petershausen-ost' },
      ],
    });
    const r = await app.inject({ method: 'GET', url: '/geocode?q=petershausen' });
    const names = r.json().map((c: { name: string }) => c.name);
    expect(names[0]).toBe('Petershausen');
    expect(names.slice(1)).toEqual(['Petershausen-West', 'Petershausen-Ost']);
  });

  it('FTS-Index bleibt nach Update/Delete synchron (Trigger city_fts_au/city_fts_ad)', async () => {
    await db.prisma.city.deleteMany();
    await db.prisma.city.create({
      data: { id: 301, name: 'Testhausen', country: 'DE', lat: 1, lon: 1, population: 100, search: 'testhausen' },
    });
    await db.prisma.city.update({ where: { id: 301 }, data: { name: 'Testhausen-Neu', search: 'testhausenneu' } });
    const afterUpdate = await app.inject({ method: 'GET', url: '/geocode?q=testhausen' });
    expect(afterUpdate.json().map((c: { name: string }) => c.name)).toEqual(['Testhausen-Neu']);
    await db.prisma.city.delete({ where: { id: 301 } });
    const afterDelete = await app.inject({ method: 'GET', url: '/geocode?q=testhausen' });
    expect(afterDelete.json()).toEqual([]);
  });
});

describe('W3 — Recurring', () => {
  it('„Jede Woche" materialisiert Folgewochen bis Projektende', async () => {
    const owner = await loginAs('w3-recur@example.com');
    // 15 Tage langes Projekt → Basis + 2 Folgewochen
    const start = Date.UTC(2026, 5, 20, 0, 0, 0);
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: {
        title: 'Recur', startDate: new Date(start).toISOString(),
        endDate: new Date(start + 15 * 24 * HOUR).toISOString(), visibility: 'PUBLIC',
      },
    });
    const id = res.json().id;
    const book = await app.inject({
      method: 'POST', url: `/projects/${id}/slots`, cookies: { session: owner },
      payload: { startTime: new Date(start + 5 * HOUR).toISOString() },
    });
    const slotId = book.json().id;
    const recur = await app.inject({ method: 'POST', url: `/slots/${slotId}/recur`, cookies: { session: owner } });
    expect(recur.statusCode).toBe(200);
    expect(recur.json().createdSlotIds).toHaveLength(2); // +7d, +14d
  });
});

describe('Lasttest-Fix: /stats/public TTL-Cache', () => {
  it('liefert innerhalb der TTL die gecachte Antwort (Landing-Poll skaliert nicht mit Beter-Zahl)', async () => {
    const { buildApp: build } = await import('../app.js');
    const cachedApp = await build({
      prisma: db.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000', STATS_CACHE_TTL_MS: '60000' }),
      mailer: { async sendMagicLink() {} },
    });
    await cachedApp.ready();
    try {
      const first = await cachedApp.inject({ method: 'GET', url: '/stats/public' });
      expect(first.statusCode).toBe(200);
      const before = first.json().activeChains;

      // Neues aktives Projekt anlegen — die gecachte Antwort darf sich NICHT ändern.
      const owner = await loginAs('cache-owner@example.com');
      const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
      await app.inject({
        method: 'POST', url: '/projects', cookies: { session: owner },
        payload: { title: 'CacheTest', startDate: future(-1), endDate: future(4), visibility: 'PUBLIC' },
      });

      const second = await cachedApp.inject({ method: 'GET', url: '/stats/public' });
      expect(second.json().activeChains).toBe(before);

      // Ohne Cache (Haupt-App, TTL=0) ist der neue Stand sofort sichtbar.
      const fresh = await app.inject({ method: 'GET', url: '/stats/public' });
      expect(fresh.json().activeChains).toBe(before + 1);
    } finally {
      await cachedApp.close();
    }
  });
});
