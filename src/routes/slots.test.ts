import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
    // Diese Datei bucht weit mehr als 10× pro Minute von 127.0.0.1 (inject-Default).
    // Das Limit selbst prüft „Buchungs-Guard" auf einer eigenen App-Instanz ohne das Flag.
    disableWriteRateLimits: true,
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

const HOUR = 3600_000;
// Buchungs-Guard: nur zukünftige Slots auf dem Stundenraster des Projekts.
// Basis = nächste volle Stunde + 1 Tag, damit alle Buchungen hier in der Zukunft liegen.
const BASE = Math.ceil(Date.now() / HOUR) * HOUR + 24 * HOUR;
const at = (h: number) => new Date(BASE + h * HOUR).toISOString();
/** ISO → ICS-Zeitstempel (20260620T020000Z). */
const icsStamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
/** ISO → Kalendertag (20260620). */
const icsDay = (iso: string) => iso.slice(0, 10).replace(/-/g, '');

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
    expect(ics.body).toContain(`DTSTART:${icsStamp(at(2))}`);
    expect(ics.body).toContain('Slots'); // Projekttitel im SUMMARY
    expect(await app.inject({ method: 'GET', url: '/slots/gibtsnicht/ics' }).then((r) => r.statusCode)).toBe(404);
  });

  it('Tages-Wache (slotDurationMinutes=1440): ICS ist ein Ganztagestermin', async () => {
    const u = await loginAs('ics-day@example.com');
    // 12:00 UTC = 13:00/14:00 Berlin — derselbe Kalendertag in beiden Zonen.
    const dayStartMs = Math.floor(BASE / (24 * HOUR)) * 24 * HOUR + 24 * HOUR + 12 * HOUR;
    const dayStart = new Date(dayStartMs).toISOString();
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: u },
      payload: {
        title: 'Tages-ICS', startDate: dayStart,
        endDate: new Date(dayStartMs + 7 * 24 * HOUR).toISOString(),
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
    expect(ics.body).toContain(`DTSTART;VALUE=DATE:${icsDay(dayStart)}`);
    expect(ics.body).toContain(`DTEND;VALUE=DATE:${icsDay(new Date(dayStartMs + 24 * HOUR).toISOString())}`);
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

describe('A9 — Grid maskiert für Nicht-Teilnehmer', () => {
  it('maskNames: eingeloggter Nicht-Mitglied sieht maskiert, Mitglied und Organizer Klartext', async () => {
    const owner = await loginAs('a9-grid-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'A9 Grid', startDate: at(0), endDate: at(6), visibility: 'PUBLIC', maskNames: true },
    });
    const pid = res.json().id as string;
    const member = await loginAs('a9-grid-member@example.com');
    await db.prisma.user.update({ where: { email: 'a9-grid-member@example.com' }, data: { name: 'Max Muster' } });
    expect((await app.inject({ method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: member }, payload: { startTime: at(2) } })).statusCode).toBe(200);
    const outsider = await loginAs('a9-grid-outsider@example.com');

    const nameFor = async (cookie: string | null) => {
      const grid = await app.inject({ method: 'GET', url: `/projects/${pid}/slots`, cookies: cookie ? { session: cookie } : undefined });
      return grid.json().find((s: { startTime: string }) => s.startTime === at(2)).userName;
    };
    expect(await nameFor(outsider)).toBe('Max M.');
    expect(await nameFor(null)).toBe('Max M.');
    expect(await nameFor(member)).toBe('Max Muster');
    expect(await nameFor(owner)).toBe('Max Muster');
  });
});

describe('guestName-Grenzen', () => {
  it('leer nach trim oder > 80 Zeichen -> 400', async () => {
    const alice = await loginAs('guestname-limit@example.com');
    const projectId = await makeProject(alice);
    const book = (guestName: string) => app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`,
      payload: { startTime: at(1), guestName, guestEmail: 'g@example.com' },
    });
    expect((await book('   ')).statusCode).toBe(400);
    const tooLong = await book('x'.repeat(81));
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().message).toBe('Name darf höchstens 80 Zeichen haben');
    expect((await book('x'.repeat(80))).statusCode).toBe(200);
  });
});

describe('Backlog 1 — Locale-Erfassung bei Buchung', () => {
  it('Gastbuchung persistiert locale am Slot (default de)', async () => {
    const owner = await loginAs('un1-slotloc-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un1 LocTest', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    const b1 = await app.inject({
      method: 'POST', url: `/projects/${id}/slots`,
      payload: { startTime: at(1), guestName: 'Gast Es', guestEmail: 'un1-es@example.com', locale: 'es' },
    });
    expect(b1.statusCode).toBe(200);
    const s1 = await db.prisma.prayerSlot.findUniqueOrThrow({ where: { id: b1.json().id } });
    expect(s1.locale).toBe('es');
    const b2 = await app.inject({
      method: 'POST', url: `/projects/${id}/slots`,
      payload: { startTime: at(2), guestName: 'Gast De' },
    });
    const s2 = await db.prisma.prayerSlot.findUniqueOrThrow({ where: { id: b2.json().id } });
    expect(s2.locale).toBe('de');
  });
});

describe('Backlog 4 — Bestätigungsmail trägt projectUrl', () => {
  it('Gastbuchung mit E-Mail: BookingMail enthält projectUrl der Wache', async () => {
    const owner = await loginAs('un4-mail-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un4 MailTest', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    await app.inject({
      method: 'POST', url: `/projects/${id}/slots`,
      payload: { startTime: at(2), guestName: 'Gast', guestEmail: 'un4-guest@example.com' },
    });
    await vi.waitFor(() => {
      const hit = bookingMails.find((b) => b.email === 'un4-guest@example.com');
      expect(hit).toBeTruthy();
      expect(hit!.m.projectUrl).toContain(`/projects/${id}`);
    });
  });

  it('eingeloggter Bucher bekommt Bestätigungs-Mail an die Konto-Adresse (Live-Befund 2026-07-09)', async () => {
    const owner = await loginAs('un10-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un10 MailTest', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    const booker = await loginAs('un10-booker@example.com');
    await app.inject({
      method: 'POST', url: `/projects/${id}/slots`, cookies: { session: booker },
      payload: { startTime: at(2) },
    });
    await vi.waitFor(() => {
      const hit = bookingMails.find((b) => b.email === 'un10-booker@example.com');
      expect(hit).toBeTruthy();
      expect(hit!.m.projectUrl).toContain(`/projects/${id}`);
    });
  });
});

describe('Buchungs-Guard (A4, N1, N5, A2)', () => {
  const book = (projectId: string, payload: object, opts: { cookie?: string; query?: string } = {}) =>
    app.inject({
      method: 'POST', url: `/projects/${projectId}/slots${opts.query ?? ''}`,
      ...(opts.cookie ? { cookies: { session: opts.cookie } } : {}),
      payload,
    });

  async function makePrivateProject(cookie: string) {
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: cookie },
      payload: { title: 'Guard privat', startDate: at(0), endDate: at(12), visibility: 'PRIVATE' },
    });
    return { id: res.json().id as string, inviteToken: res.json().inviteToken as string };
  }

  it('lehnt Buchung in PRIVATE ohne Invite ab (404, kein Existenz-Orakel)', async () => {
    const owner = await loginAs('guard-priv-owner@example.com');
    const { id } = await makePrivateProject(owner);
    const anon = await book(id, { startTime: at(1), guestName: 'Gast' });
    expect(anon.statusCode).toBe(404);
    expect(anon.json().message).toBe('Projekt nicht gefunden');
    const stranger = await loginAs('guard-priv-stranger@example.com');
    expect((await book(id, { startTime: at(1) }, { cookie: stranger })).statusCode).toBe(404);
    const wrong = await book(id, { startTime: at(1), guestName: 'Gast', invite: 'falsch' });
    expect(wrong.statusCode).toBe(404);
  });

  it('books private project with invite in body', async () => {
    const owner = await loginAs('guard-priv-body@example.com');
    const { id, inviteToken } = await makePrivateProject(owner);
    const res = await book(id, { startTime: at(1), guestName: 'Gast', invite: inviteToken });
    expect(res.statusCode).toBe(200);
  });

  it('books private project with invite in query', async () => {
    const owner = await loginAs('guard-priv-query@example.com');
    const { id, inviteToken } = await makePrivateProject(owner);
    const res = await book(id, { startTime: at(2), guestName: 'Gast' }, { query: `?invite=${inviteToken}` });
    expect(res.statusCode).toBe(200);
  });

  it('lehnt Buchung in PAUSED/ARCHIVED/DRAFT ab (409)', async () => {
    const owner = await loginAs('guard-status@example.com');
    const projectId = await makeProject(owner);
    for (const status of ['PAUSED', 'ARCHIVED', 'DRAFT']) {
      const patch = await app.inject({
        method: 'PATCH', url: `/projects/${projectId}`, cookies: { session: owner }, payload: { status },
      });
      expect(patch.statusCode).toBe(200);
      const res = await book(projectId, { startTime: at(1) }, { cookie: owner });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe('Diese Gebetswache nimmt gerade keine Buchungen an');
    }
  });

  it('409 bei inaktivem PRIVATE-Projekt nur mit Leserecht — Fremde bekommen 404', async () => {
    const owner = await loginAs('guard-status-priv@example.com');
    const { id } = await makePrivateProject(owner);
    await app.inject({ method: 'PATCH', url: `/projects/${id}`, cookies: { session: owner }, payload: { status: 'PAUSED' } });
    expect((await book(id, { startTime: at(1), guestName: 'Gast' })).statusCode).toBe(404);
    expect((await book(id, { startTime: at(1) }, { cookie: owner })).statusCode).toBe(409);
  });

  it('lehnt Startzeit neben dem Raster ab (400)', async () => {
    const owner = await loginAs('guard-grid@example.com');
    const projectId = await makeProject(owner);
    const offGrid = new Date(BASE + 1).toISOString();
    const res = await book(projectId, { startTime: offGrid }, { cookie: owner });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Ungültiges Zeitfenster');
  });

  it('lehnt vergangene Slots ab (400), erlaubt den gerade laufenden Slot', async () => {
    const owner = await loginAs('guard-past@example.com');
    // Raster-Anker: Slot, der vor 10 min begann — Projektstart 48 h davor liegt auf demselben Raster.
    const running = Date.now() - 10 * 60_000;
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: {
        title: 'Guard Vergangenheit', visibility: 'PUBLIC',
        startDate: new Date(running - 48 * HOUR).toISOString(),
        endDate: new Date(running + 48 * HOUR).toISOString(),
      },
    });
    const projectId = res.json().id as string;

    // Vor 2 h geendet (Start vor 3 h 10 min).
    const past = await book(projectId, { startTime: new Date(running - 3 * HOUR).toISOString() }, { cookie: owner });
    expect(past.statusCode).toBe(400);
    expect(past.json().message).toBe('Dieses Zeitfenster liegt in der Vergangenheit');

    const now = await book(projectId, { startTime: new Date(running).toISOString() }, { cookie: owner });
    expect(now.statusCode).toBe(200);
  });

  it('limitiert Buchungen auf 10 pro Minute und IP (11. Request 429)', async () => {
    // Eigene App-Instanz OHNE disableWriteRateLimits — der Zähler ist pro Instanz.
    const limited = await buildApp({
      prisma: db.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000' }),
      mailer: { async sendMagicLink() {} },
    });
    await limited.ready();
    try {
      const owner = await loginAs('guard-rate@example.com');
      const res = await app.inject({
        method: 'POST', url: '/projects', cookies: { session: owner },
        payload: { title: 'Guard Rate', startDate: at(0), endDate: at(24), visibility: 'PUBLIC' },
      });
      const projectId = res.json().id as string;
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        const r = await limited.inject({
          method: 'POST', url: `/projects/${projectId}/slots`, remoteAddress: '10.6.0.1',
          payload: { startTime: at(i), guestName: `Gast ${i}` },
        });
        codes.push(r.statusCode);
      }
      expect(codes.slice(0, 10)).toEqual(Array(10).fill(200));
      expect(codes[10]).toBe(429);
      // Andere IP: eigener Zähler.
      const other = await limited.inject({
        method: 'POST', url: `/projects/${projectId}/slots`, remoteAddress: '10.6.0.2',
        payload: { startTime: at(11), guestName: 'Gast andere IP' },
      });
      expect(other.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('recur-Härtung', () => {
  it('recur nur für BOOKED-Basis in ACTIVE-Projekt (sonst 409)', async () => {
    const owner = await loginAs('recur-guard@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'Recur Guard', startDate: at(0), endDate: at(15 * 24), visibility: 'PUBLIC' },
    });
    const projectId = res.json().id as string;

    // Stornierte Basis → 409.
    const cancelled = await app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`, cookies: { session: owner }, payload: { startTime: at(1) },
    });
    await app.inject({ method: 'DELETE', url: `/slots/${cancelled.json().id}`, cookies: { session: owner } });
    const r1 = await app.inject({ method: 'POST', url: `/slots/${cancelled.json().id}/recur`, cookies: { session: owner } });
    expect(r1.statusCode).toBe(409);

    // Gebuchte Basis, aber Projekt pausiert → 409.
    const booked = await app.inject({
      method: 'POST', url: `/projects/${projectId}/slots`, cookies: { session: owner }, payload: { startTime: at(2) },
    });
    await app.inject({ method: 'PATCH', url: `/projects/${projectId}`, cookies: { session: owner }, payload: { status: 'PAUSED' } });
    const r2 = await app.inject({ method: 'POST', url: `/slots/${booked.json().id}/recur`, cookies: { session: owner } });
    expect(r2.statusCode).toBe(409);
    expect(await db.prisma.prayerSlot.count({ where: { projectId } })).toBe(2);

    // Wieder aktiv → 200.
    await app.inject({ method: 'PATCH', url: `/projects/${projectId}`, cookies: { session: owner }, payload: { status: 'ACTIVE' } });
    const r3 = await app.inject({ method: 'POST', url: `/slots/${booked.json().id}/recur`, cookies: { session: owner } });
    expect(r3.statusCode).toBe(200);
    expect(r3.json().createdSlotIds).toHaveLength(2);
  });

  it('recur legt höchstens 53 Folgetermine an', async () => {
    const owner = await loginAs('recur-cap@example.com');
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: 'recur-cap@example.com' } });
    // Altprojekt über 2 Jahre (die 366-Tage-Grenze gilt nur beim Schreiben über die API).
    const project = await db.prisma.prayerProject.create({
      data: {
        title: 'Recur Cap', organizerId: user.id, status: 'ACTIVE', visibility: 'PUBLIC',
        inviteToken: 'recur-cap-token', startDate: new Date(BASE), endDate: new Date(BASE + 2 * 366 * 24 * HOUR),
      },
    });
    const base = await db.prisma.prayerSlot.create({
      data: { projectId: project.id, userId: user.id, startTime: new Date(BASE), endTime: new Date(BASE + HOUR), status: 'BOOKED' },
    });
    const recur = await app.inject({ method: 'POST', url: `/slots/${base.id}/recur`, cookies: { session: owner } });
    expect(recur.statusCode).toBe(200);
    expect(recur.json().createdSlotIds).toHaveLength(53);
  });
});
