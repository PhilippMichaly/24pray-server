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
    env: parseEnv({ APP_URL: 'http://localhost:3000' }),
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
    // User-Post (Name aus Session), Gast-Post (Name Pflicht)
    await db.prisma.user.update({ where: { email: 'w3-req@example.com' }, data: { name: 'Ruth Klein' } });
    const p1 = await app.inject({
      method: 'POST', url: `/projects/${id}/requests`, cookies: { session: owner },
      payload: { text: 'Bitte betet für Lena.' },
    });
    expect(p1.statusCode).toBe(200);
    const pGuestNoName = await app.inject({
      method: 'POST', url: `/projects/${id}/requests`, payload: { text: 'Ich bete mit.' },
    });
    expect(pGuestNoName.statusCode).toBe(400);

    const anon = await app.inject({ method: 'GET', url: `/projects/${id}/requests` });
    expect(anon.json()[0].authorName).toBe('Ruth K.'); // §E5 maskiert
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
