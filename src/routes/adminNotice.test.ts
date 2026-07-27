import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';
import type { AdminNotice } from '../lib/mailer.js';

let db: TestDb;
let app: FastifyInstance;
let quietApp: FastifyInstance; // gleiche Routen, aber ohne ADMIN_NOTIFY_TO
const magicLinks: { email: string; url: string }[] = [];
const notices: { to: string; n: AdminNotice }[] = [];
const quietNotices: { to: string; n: AdminNotice }[] = [];

/** notifyAdmin ist fire-and-forget — vor dem Assert die Mikrotask-Queue leeren. */
const flush = () => new Promise((r) => setTimeout(r, 0));

let loginSeq = 0;
async function loginAs(target: FastifyInstance, email: string): Promise<string> {
  // Eigene Quell-IP pro Login: /auth/magic-link limitiert 5/min pro IP.
  const remoteAddress = `10.1.0.${++loginSeq}`;
  await target.inject({ method: 'POST', url: '/auth/magic-link', payload: { email }, remoteAddress });
  const token = new URL(magicLinks.at(-1)!.url).searchParams.get('token')!;
  const verify = await target.inject({ method: 'POST', url: '/auth/verify', payload: { token }, remoteAddress });
  return verify.cookies.find((c) => c.name === 'session')!.value;
}

beforeAll(async () => {
  db = await makeTestDb();
  const mailer = {
    async sendMagicLink(email: string, url: string) { magicLinks.push({ email, url }); },
    async sendAdminNotice(to: string, n: AdminNotice) { notices.push({ to, n }); },
  };
  app = await buildApp({
    prisma: db.prisma,
    env: parseEnv({ APP_URL: 'http://localhost:3000', ADMIN_NOTIFY_TO: 'an-betreiber@example.com' }),
    mailer,
  });
  await app.ready();

  quietApp = await buildApp({
    prisma: db.prisma,
    env: parseEnv({ APP_URL: 'http://localhost:3000' }), // ADMIN_NOTIFY_TO absichtlich leer
    mailer: {
      async sendMagicLink(email: string, url: string) { magicLinks.push({ email, url }); },
      async sendAdminNotice(to: string, n: AdminNotice) { quietNotices.push({ to, n }); },
    },
  });
  await quietApp.ready();
});
afterAll(async () => { await app.close(); await quietApp.close(); await db.cleanup(); });

const at = (h: number) => new Date(Date.UTC(2026, 8, 10, h, 0, 0)).toISOString();

async function createProject(session: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST', url: '/projects', cookies: { session },
    payload: {
      title: 'an-Wache', startDate: at(0), endDate: at(6), timezone: 'Europe/Berlin',
      language: 'de', slotDurationMinutes: 60, visibility: 'PUBLIC',
      maskNames: false, notifyOnBooking: true, locationName: 'an-Stadt', ...overrides,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string };
}

describe('Betreiber-Benachrichtigungen (ADMIN_NOTIFY_TO)', () => {
  it('erster erfolgreicher Login meldet ein neues Konto — jeder weitere Login nicht mehr', async () => {
    notices.length = 0;
    const email = 'an-neuling@example.com';
    await loginAs(app, email);
    await flush();

    const activated = notices.filter((x) => x.n.kind === 'user_activated');
    expect(activated.length).toBe(1);
    expect(activated[0].to).toBe('an-betreiber@example.com');
    expect(activated[0].n).toMatchObject({ kind: 'user_activated', email, locale: 'de' });

    // Zweiter Login derselben Adresse: activatedAt ist gesetzt → keine weitere Mail.
    notices.length = 0;
    await loginAs(app, email);
    await flush();
    expect(notices.filter((x) => x.n.kind === 'user_activated')).toEqual([]);
  });

  it('das bloße ANFORDERN eines Magic-Links meldet noch nichts (nicht von außen auslösbar)', async () => {
    notices.length = 0;
    await app.inject({
      method: 'POST', url: '/auth/magic-link',
      payload: { email: 'an-nie-eingeloest@example.com' }, remoteAddress: '10.1.9.9',
    });
    await flush();
    expect(notices).toEqual([]);
  });

  it('neue Wache meldet Titel, Sichtbarkeit, Zeitraum, Ersteller und Link', async () => {
    const session = await loginAs(app, 'an-owner@example.com');
    notices.length = 0;
    const project = await createProject(session, { title: 'an-Nachtwache', visibility: 'PRIVATE' });
    await flush();

    const created = notices.filter((x) => x.n.kind === 'project_created');
    expect(created.length).toBe(1);
    expect(created[0].to).toBe('an-betreiber@example.com');
    expect(created[0].n).toMatchObject({
      kind: 'project_created',
      title: 'an-Nachtwache',
      visibility: 'PRIVATE',
      timezone: 'Europe/Berlin',
      slotDurationMinutes: 60,
      language: 'de',
      locationName: 'an-Stadt',
      organizerEmail: 'an-owner@example.com',
      projectUrl: `http://localhost:3000/projects/${project.id}`,
    });
  });

  it('jede Buchung meldet sich; die erste Stunde einer Wache ist als solche markiert', async () => {
    const session = await loginAs(app, 'an-owner2@example.com');
    const project = await createProject(session, { title: 'an-Buchwache' });

    // Erste Stunde — Gast ohne Konto.
    notices.length = 0;
    const first = await app.inject({
      method: 'POST', url: `/projects/${project.id}/slots`,
      payload: { startTime: at(0), guestName: 'an-Gast' },
    });
    expect(first.statusCode).toBe(200);
    await flush();

    const b1 = notices.filter((x) => x.n.kind === 'slot_booked');
    expect(b1.length).toBe(1);
    expect(b1[0].n).toMatchObject({
      kind: 'slot_booked',
      projectTitle: 'an-Buchwache',
      bookerName: 'an-Gast',
      isGuest: true,
      isFirstBooking: true,
      bookedSlots: 1,
    });

    // Zweite Stunde — eingeloggt. Kein "erste Stunde" mehr, Zähler steht auf 2.
    notices.length = 0;
    const booker = await loginAs(app, 'an-beter@example.com');
    const second = await app.inject({
      method: 'POST', url: `/projects/${project.id}/slots`,
      cookies: { session: booker }, payload: { startTime: at(1) },
    });
    expect(second.statusCode).toBe(200);
    await flush();

    const b2 = notices.filter((x) => x.n.kind === 'slot_booked');
    expect(b2.length).toBe(1);
    expect(b2[0].n).toMatchObject({
      kind: 'slot_booked',
      isGuest: false,
      isFirstBooking: false,
      bookedSlots: 2,
      bookerEmail: 'an-beter@example.com',
    });
  });

  it('ohne ADMIN_NOTIFY_TO meldet keine der drei Routen etwas (fail-closed)', async () => {
    quietNotices.length = 0;
    const session = await loginAs(quietApp, 'an-quiet@example.com');
    const res = await quietApp.inject({
      method: 'POST', url: '/projects', cookies: { session },
      payload: {
        title: 'an-Stillwache', startDate: at(0), endDate: at(6), timezone: 'Europe/Berlin',
        language: 'de', slotDurationMinutes: 60, visibility: 'PUBLIC',
        maskNames: false, notifyOnBooking: true,
      },
    });
    expect(res.statusCode).toBe(200);
    await quietApp.inject({
      method: 'POST', url: `/projects/${(res.json() as { id: string }).id}/slots`,
      payload: { startTime: at(0), guestName: 'an-Stillgast' },
    });
    await flush();
    expect(quietNotices).toEqual([]);
  });
});
