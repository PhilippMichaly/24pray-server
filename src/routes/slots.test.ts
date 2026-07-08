import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string }[] = [];
const bookingMails: { email: string; m: import('../lib/mailer.js').BookingMail }[] = [];
const bookingNotices: { email: string; m: import('../lib/mailer.js').BookingNoticeMail }[] = [];

let loginSeq = 0;
async function loginAs(email: string): Promise<string> {
  // Distinct source IP per login so the /auth/magic-link per-IP rate limit
  // (5/min) doesn't accumulate across tests in this file.
  const remoteAddress = `10.0.0.${++loginSeq}`;
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
      async sendBookingConfirmation(email, m) { bookingMails.push({ email, m }); },
      async sendBookingNotice(email, m) { bookingNotices.push({ email, m }); },
    },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

const at = (h: number) => new Date(Date.UTC(2026, 5, 20, h, 0, 0)).toISOString();

async function makeProject(cookie: string) {
  const res = await app.inject({
    method: 'POST', url: '/projects', cookies: { session: cookie },
    payload: { title: 'Slots', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
  });
  return res.json().id as string;
}

describe('slots', () => {
  it('book -> grid shows BOOKED; double-book -> 409; cancel -> FREE again', async () => {
    const alice = await loginAs('alice-slot@example.com');
    const projectId = await makeProject(alice);

    const book = await app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`, cookies: { session: alice },
      payload: { startTime: at(2) },
    });
    expect(book.statusCode).toBe(200);
    const slotId = book.json().id;

    const grid = await app.inject({ method: 'GET', url: `/projects/${projectId}/slots`, cookies: { session: alice } });
    const slot2 = grid.json().find((s: { startTime: string }) => s.startTime === at(2));
    expect(slot2.status).toBe('BOOKED');
    expect(slot2.userName).toBe('alice-slot');

    const dup = await app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`, cookies: { session: alice },
      payload: { startTime: at(2) },
    });
    expect(dup.statusCode).toBe(409);

    const cancel = await app.inject({ method: 'DELETE', url: `/slots/${slotId}`, cookies: { session: alice } });
    expect(cancel.statusCode).toBe(204);

    const grid2 = await app.inject({ method: 'GET', url: `/projects/${projectId}/slots`, cookies: { session: alice } });
    const slot2b = grid2.json().find((s: { startTime: string }) => s.startTime === at(2));
    expect(slot2b.status).toBe('FREE');
  });

  it('private project slot grid is organizer-only', async () => {
    const alice = await loginAs('alice-priv@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: alice },
      payload: { title: 'PrivSlots', startDate: at(0), endDate: at(6), visibility: 'PRIVATE' },
    });
    const projectId = res.json().id as string;

    // Organizer can read the grid.
    const ownerGrid = await app.inject({ method: 'GET', url: `/projects/${projectId}/slots`, cookies: { session: alice } });
    expect(ownerGrid.statusCode).toBe(200);

    // A different logged-in user is forbidden.
    const mallory = await loginAs('mallory-priv@example.com');
    const otherGrid = await app.inject({ method: 'GET', url: `/projects/${projectId}/slots`, cookies: { session: mallory } });
    expect(otherGrid.statusCode).toBe(403);
  });

  it('rejects booking outside the project range', async () => {
    const alice = await loginAs('alice-range@example.com');
    const projectId = await makeProject(alice);
    const res = await app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`, cookies: { session: alice },
      payload: { startTime: at(20) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('non-booker non-organizer cannot cancel', async () => {
    const alice = await loginAs('alice-own@example.com');
    const projectId = await makeProject(alice);
    const book = await app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`, cookies: { session: alice },
      payload: { startTime: at(1) },
    });
    const slotId = book.json().id;
    const mallory = await loginAs('mallory@example.com');
    const res = await app.inject({ method: 'DELETE', url: `/slots/${slotId}`, cookies: { session: mallory } });
    expect(res.statusCode).toBe(403);
  });

  it('grid marks the requester own slot as isMine', async () => {
    const alice = await loginAs('alice-mine@example.com');
    const projectId = await makeProject(alice);
    await app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`, cookies: { session: alice },
      payload: { startTime: at(3) },
    });
    const grid = await app.inject({ method: 'GET', url: `/projects/${projectId}/slots`, cookies: { session: alice } });
    const mine = grid.json().find((s: { startTime: string }) => s.startTime === at(3));
    expect(mine.isMine).toBe(true);
    expect(mine.slotId).toBeTruthy();
  });

  it('GET /slots/:id/ics liefert einen Kalendereintrag (text/calendar)', async () => {
    const u = await loginAs('ics@example.com');
    const pid = await makeProject(u);
    const book = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: u },
      payload: { startTime: at(2) },
    });
    const slotId = book.json().id;

    const ics = await app.inject({ method: 'GET', url: `/slots/${slotId}/ics` });
    expect(ics.statusCode).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('BEGIN:VEVENT');
    expect(ics.body).toContain('DTSTART:20260620T020000Z');
    expect(ics.body).toContain('Slots'); // Projekttitel im SUMMARY
    expect(await app.inject({ method: 'GET', url: '/slots/gibtsnicht/ics' }).then((r) => r.statusCode)).toBe(404);
  });

  it('Tages-Wache (slotDurationMinutes=1440): ICS ist ein Ganztagestermin', async () => {
    const u = await loginAs('ics-day@example.com');
    const dayStart = new Date(Date.UTC(2026, 6, 14, 12, 0, 0)).toISOString(); // 14:00 Berlin
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: u },
      payload: {
        title: 'Tages-ICS', startDate: dayStart,
        endDate: new Date(Date.UTC(2026, 6, 14 + 7, 12, 0, 0)).toISOString(),
        visibility: 'PUBLIC', timezone: 'Europe/Berlin', slotDurationMinutes: 1440,
      },
    });
    const pid = create.json().id as string;
    const book = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: u },
      payload: { startTime: dayStart },
    });
    expect(book.statusCode).toBe(200);
    const slotId = book.json().id;

    const ics = await app.inject({ method: 'GET', url: `/slots/${slotId}/ics` });
    expect(ics.statusCode).toBe(200);
    expect(ics.body).toContain('DTSTART;VALUE=DATE:20260714');
    expect(ics.body).toContain('DTEND;VALUE=DATE:20260715');
  });

  it('Gast-Buchung mit E-Mail verschickt Bestätigung mit Kalender-Links', async () => {
    const u = await loginAs('conf-orga@example.com');
    const pid = await makeProject(u);
    const book = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`,
      payload: { startTime: at(3), guestName: 'Conf Gast', guestEmail: 'gast-conf@example.com' },
    });
    expect(book.statusCode).toBe(200);
    const mail = bookingMails.find((b) => b.email === 'gast-conf@example.com');
    expect(mail).toBeTruthy();
    expect(mail!.m.projectTitle).toBe('Slots');
    expect(mail!.m.icsUrl).toContain(`/api/slots/${book.json().id}/ics`);
    expect(mail!.m.googleUrl).toContain('calendar.google.com');
  });

  it('wb-notifyOnBooking: Owner bekommt Mail bei Fremd-/Gastbuchung, nicht bei Eigenbuchung, nicht wenn Flag aus', async () => {
    const owner = await loginAs('wb-notify-owner@example.com');
    const other = await loginAs('wb-notify-other@example.com');

    const proj = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'wb-NotifyProjekt', startDate: at(0), endDate: at(20), visibility: 'PUBLIC' },
    });
    const pid = proj.json().id;

    // Eigenbuchung des Organisators: KEINE Mail.
    bookingNotices.length = 0;
    await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: owner },
      payload: { startTime: at(1) },
    });
    expect(bookingNotices).toHaveLength(0);

    // Fremdbuchung (eingeloggt): Mail an den Organisator.
    bookingNotices.length = 0;
    await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: other },
      payload: { startTime: at(2) },
    });
    expect(bookingNotices).toHaveLength(1);
    expect(bookingNotices[0].email).toBe('wb-notify-owner@example.com');
    expect(bookingNotices[0].m.projectTitle).toBe('wb-NotifyProjekt');
    expect(bookingNotices[0].m.bookerName).toBe('wb-notify-other');

    // Gastbuchung: ebenfalls Mail an den Organisator.
    bookingNotices.length = 0;
    await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`,
      payload: { startTime: at(3), guestName: 'wb-Gast Notify' },
    });
    expect(bookingNotices).toHaveLength(1);
    expect(bookingNotices[0].m.bookerName).toBe('wb-Gast Notify');

    // Flag aus: keine Mail mehr, auch bei Fremdbuchung.
    await app.inject({
      method: 'PATCH', url: `/projects/${pid}`, cookies: { session: owner },
      payload: { notifyOnBooking: false },
    });
    bookingNotices.length = 0;
    await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: other },
      payload: { startTime: at(4) },
    });
    expect(bookingNotices).toHaveLength(0);
  });

  it('guest booking mints a guestToken; guest can self-cancel with it; foreign token = 403', async () => {
    const alice = await loginAs('alice-guest@example.com');
    const projectId = await makeProject(alice);

    // Gast bucht ohne Session (nur Name/E-Mail).
    const book = await app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`,
      payload: { startTime: at(4), guestName: 'Gast Gustav', guestEmail: 'gustav@example.com' },
    });
    expect(book.statusCode).toBe(200);
    const { id: slotId, guestToken } = book.json();
    expect(guestToken).toBeTruthy();

    // Anonymer Betrachter sieht den Namen maskiert.
    const anonGrid = await app.inject({ method: 'GET', url: `/projects/${projectId}/slots` });
    const gslot = anonGrid.json().find((s: { startTime: string }) => s.startTime === at(4));
    expect(gslotName(gslot)).toBe('Gast Gustav'); // Default Klartext; Opt-in-Masking siehe slotGrid.test

    // Falscher Token → 403.
    const wrong = await app.inject({ method: 'DELETE', url: `/slots/${slotId}?guestToken=nope` });
    expect(wrong.statusCode).toBe(403);

    // Richtiger Token → 204.
    const ok = await app.inject({ method: 'DELETE', url: `/slots/${slotId}?guestToken=${guestToken}` });
    expect(ok.statusCode).toBe(204);
  });
});

function gslotName(s: { userName: string | null }): string | null {
  return s.userName;
}
