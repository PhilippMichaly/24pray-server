import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string }[] = [];
const scheduleChanges: { email: string; m: import('../lib/mailer.js').ScheduleChangeMail }[] = [];
const farewells: { email: string; m: import('../lib/mailer.js').ProjectFarewellMail }[] = [];

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
      async sendScheduleChange(email, m) { scheduleChanges.push({ email, m }); },
      async sendProjectFarewell(email, m) { farewells.push({ email, m }); },
    },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const DAY = 24 * 3600_000;

describe('projects', () => {
  it('create -> appears in list with stats; private hidden from others', async () => {
    const alice = await loginAs('alice@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: alice },
      payload: { title: 'Nachtgebet', startDate: future(1), endDate: future(4), visibility: 'PRIVATE' },
    });
    expect(create.statusCode).toBe(200);
    const proj = create.json();
    expect(proj.totalSlots).toBe(3);
    expect(proj.bookedSlots).toBe(0);
    expect(proj.organizerName).toBe('alice');

    const mine = await app.inject({ method: 'GET', url: '/projects', cookies: { session: alice } });
    expect(mine.json().some((p: { id: string }) => p.id === proj.id)).toBe(true);

    const bob = await loginAs('bob@example.com');
    const theirs = await app.inject({ method: 'GET', url: '/projects', cookies: { session: bob } });
    expect(theirs.json().some((p: { id: string }) => p.id === proj.id)).toBe(false);

    const direct = await app.inject({ method: 'GET', url: `/projects/${proj.id}`, cookies: { session: bob } });
    expect(direct.statusCode).toBe(403);
  });

  it('slotDurationMinutes: nur 60 (Stunden) oder 1440 (Tage) sind gültig — jeder Zwischenwert -> 400', async () => {
    const finn = await loginAs('finn-duration@example.com');
    const invalid61 = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: finn },
      payload: { title: 'Ungültig 61', startDate: future(1), endDate: future(4), slotDurationMinutes: 61 },
    });
    expect(invalid61.statusCode).toBe(400);
    const invalid1441 = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: finn },
      payload: { title: 'Ungültig 1441', startDate: future(1), endDate: future(200), slotDurationMinutes: 1441 },
    });
    expect(invalid1441.statusCode).toBe(400);

    const validDay = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: finn },
      payload: { title: 'Tages-Wache', startDate: future(24), endDate: future(24 + 7 * 24), slotDurationMinutes: 1440 },
    });
    expect(validDay.statusCode).toBe(200);
    expect(validDay.json().slotDurationMinutes).toBe(1440);
    expect(validDay.json().totalSlots).toBe(7); // 7 Tage / 1440 Min je Slot
  });

  it('Liste liefert korrekte bookedSlots pro Projekt (inkl. 0) — Netz für den N+1-Fix', async () => {
    const dora = await loginAs('dora@example.com');
    const mk = async (title: string) => (await app.inject({
      method: 'POST', url: '/projects', cookies: { session: dora },
      payload: { title, startDate: future(1), endDate: future(4), visibility: 'PUBLIC' },
    })).json();
    const withBookings = await mk('Zwei Buchungen');
    const empty = await mk('Null Buchungen');
    for (const h of [1, 2]) {
      await app.inject({
        method: 'POST', url: `/projects/${withBookings.id}/slots`, cookies: { session: dora },
        payload: { startTime: future(h) },
      });
    }
    const list = (await app.inject({ method: 'GET', url: '/projects', cookies: { session: dora } })).json();
    expect(list.find((p: { id: string }) => p.id === withBookings.id).bookedSlots).toBe(2);
    expect(list.find((p: { id: string }) => p.id === empty.id).bookedSlots).toBe(0);
    expect(list.find((p: { id: string }) => p.id === empty.id).totalSlots).toBe(3);
  });

  it('Gruppen-Links: gültige Dienst-URLs werden gespeichert und ausgeliefert', async () => {
    const eva = await loginAs('eva-links@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: eva },
      payload: {
        title: 'Kette mit Gruppen', startDate: future(1), endDate: future(4), visibility: 'PUBLIC',
        linkWhatsapp: 'https://chat.whatsapp.com/AbC123xyz',
        linkTelegram: 'https://t.me/+abcDEF123',
        linkSignal: 'https://signal.group/#CjQKIabc',
      },
    });
    expect(create.statusCode).toBe(200);
    const anon = await app.inject({ method: 'GET', url: `/projects/${create.json().id}` });
    expect(anon.json().linkWhatsapp).toBe('https://chat.whatsapp.com/AbC123xyz');
    expect(anon.json().linkTelegram).toBe('https://t.me/+abcDEF123');
    expect(anon.json().linkSignal).toBe('https://signal.group/#CjQKIabc');
  });

  it('Gruppen-Links: fremde Domains und http werden abgelehnt (Anti-Phishing)', async () => {
    const eva = await loginAs('eva-links2@example.com');
    const bad = async (payload: Record<string, string>) => (await app.inject({
      method: 'POST', url: '/projects', cookies: { session: eva },
      payload: { title: 'X', startDate: future(1), endDate: future(4), ...payload },
    })).statusCode;
    expect(await bad({ linkWhatsapp: 'https://evil.example.com/AbC' })).toBe(400);
    expect(await bad({ linkWhatsapp: 'http://chat.whatsapp.com/AbC' })).toBe(400);
    expect(await bad({ linkTelegram: 'https://t.me.evil.com/x' })).toBe(400);
    expect(await bad({ linkSignal: 'https://signal.group.phish.io/#x' })).toBe(400);
  });

  it('Gruppen-Links: PATCH setzt und löscht (null)', async () => {
    const eva = await loginAs('eva-links3@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: eva },
      payload: { title: 'PatchLinks', startDate: future(1), endDate: future(4) },
    });
    const id = create.json().id;
    const set = await app.inject({
      method: 'PATCH', url: `/projects/${id}`, cookies: { session: eva },
      payload: { linkTelegram: 'https://t.me/meinekette' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().linkTelegram).toBe('https://t.me/meinekette');
    const clear = await app.inject({
      method: 'PATCH', url: `/projects/${id}`, cookies: { session: eva },
      payload: { linkTelegram: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().linkTelegram).toBe(null);
  });

  it('organizerName: Default Klartext auch anonym; maskiert nur bei maskNames-Opt-in', async () => {
    const carol = await loginAs('carol@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: carol },
      payload: { title: 'Offene Kette E5', startDate: future(1), endDate: future(4), visibility: 'PUBLIC' },
    });
    const proj = create.json();
    expect(proj.organizerName).toBe('carol');
    expect(proj.maskNames).toBe(false);

    const anonGet = await app.inject({ method: 'GET', url: `/projects/${proj.id}` });
    expect(anonGet.json().organizerName).toBe('carol'); // Default: Klartext

    const masked = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: carol },
      payload: { title: 'Diskrete Kette', startDate: future(1), endDate: future(4), visibility: 'PUBLIC', maskNames: true },
    });
    const anonMasked = await app.inject({ method: 'GET', url: `/projects/${masked.json().id}` });
    expect(anonMasked.json().organizerName).toBe('ca…'); // Opt-in: maskiert
  });

  it('inviteToken only leaks to the organizer', async () => {
    const alice = await loginAs('alice-token@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: alice },
      payload: { title: 'Tokentest', startDate: future(1), endDate: future(4), visibility: 'PUBLIC' },
    });
    expect(create.statusCode).toBe(200);
    const proj = create.json();
    // Organizer (the creator) sees their own token.
    expect(proj.inviteToken).not.toBe('');

    // A different logged-in user listing the PUBLIC project gets an empty token.
    const bob = await loginAs('bob-token@example.com');
    const list = await app.inject({ method: 'GET', url: '/projects', cookies: { session: bob } });
    const listed = list.json().find((p: { id: string }) => p.id === proj.id);
    expect(listed).toBeTruthy();
    expect(listed.inviteToken).toBe('');

    // ...and getting it directly also gets an empty token.
    const get = await app.inject({ method: 'GET', url: `/projects/${proj.id}`, cookies: { session: bob } });
    expect(get.statusCode).toBe(200);
    expect(get.json().inviteToken).toBe('');

    // The organizer getting it directly still sees the token.
    const mine = await app.inject({ method: 'GET', url: `/projects/${proj.id}`, cookies: { session: alice } });
    expect(mine.json().inviteToken).not.toBe('');
  });

  it('create requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { title: 'x', startDate: future(1), endDate: future(2) } });
    expect(res.statusCode).toBe(401);
  });

  it('wb-notifyOnBooking: Default true, PATCH kann es umschalten', async () => {
    const finn = await loginAs('wb-notify@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: finn },
      payload: { title: 'wb-NotifyDefault', startDate: future(1), endDate: future(4), visibility: 'PUBLIC' },
    });
    expect(create.json().notifyOnBooking).toBe(true);

    const off = await app.inject({
      method: 'PATCH', url: `/projects/${create.json().id}`, cookies: { session: finn },
      payload: { notifyOnBooking: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().notifyOnBooking).toBe(false);
  });

  it('join by invite token returns the project', async () => {
    const alice = await loginAs('alice2@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: alice },
      payload: { title: 'Joinbar', startDate: future(1), endDate: future(2), visibility: 'PRIVATE' },
    });
    const inviteToken = create.json().inviteToken;
    const join = await app.inject({ method: 'GET', url: `/join/${inviteToken}` });
    expect(join.statusCode).toBe(200);
    expect(join.json().title).toBe('Joinbar');

    const bad = await app.inject({ method: 'GET', url: '/join/does-not-exist' });
    expect(bad.statusCode).toBe(404);
  });
});

describe('wk-POST /projects/:id/shift — Wache verschieben (Ersteller-Lebenszyklus)', () => {
  it('verschiebt Projekt- und ALLE Slot-Zeiten exakt um das Delta, auch CANCELLED/COMPLETED', async () => {
    const orga = await loginAs('wk-shift-orga@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: orga },
      payload: { title: 'wk-Shiftbar', startDate: future(0), endDate: future(240), visibility: 'PUBLIC' },
    });
    const pid = create.json().id;

    const booked = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: orga },
      payload: { startTime: future(2) },
    });
    const cancelled = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: orga },
      payload: { startTime: future(3) },
    });
    await app.inject({ method: 'DELETE', url: `/slots/${cancelled.json().id}`, cookies: { session: orga } });
    const completedBook = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: orga },
      payload: { startTime: future(4) },
    });
    await db.prisma.prayerSlot.update({ where: { id: completedBook.json().id }, data: { status: 'COMPLETED' } });

    const oldStart = new Date(create.json().startDate);
    const deltaMs = 2 * DAY;
    const newStart = new Date(oldStart.getTime() + deltaMs).toISOString();

    const shift = await app.inject({
      method: 'POST', url: `/projects/${pid}/shift`, cookies: { session: orga },
      payload: { newStartDate: newStart },
    });
    expect(shift.statusCode).toBe(200);
    expect(new Date(shift.json().startDate).getTime()).toBe(oldStart.getTime() + deltaMs);
    expect(new Date(shift.json().endDate).getTime()).toBe(new Date(create.json().endDate).getTime() + deltaMs);

    const bookedRow = await db.prisma.prayerSlot.findUnique({ where: { id: booked.json().id } });
    expect(bookedRow!.startTime.getTime()).toBe(new Date(booked.json().startTime).getTime() + deltaMs);
    expect(bookedRow!.endTime.getTime()).toBe(new Date(booked.json().endTime).getTime() + deltaMs);
    expect(bookedRow!.status).toBe('BOOKED');

    const cancelledRow = await db.prisma.prayerSlot.findUnique({ where: { id: cancelled.json().id } });
    expect(cancelledRow!.status).toBe('CANCELLED');
    expect(cancelledRow!.startTime.getTime()).toBe(new Date(cancelled.json().startTime).getTime() + deltaMs);

    const completedRow = await db.prisma.prayerSlot.findUnique({ where: { id: completedBook.json().id } });
    expect(completedRow!.status).toBe('COMPLETED');
    expect(completedRow!.startTime.getTime()).toBe(new Date(completedBook.json().startTime).getTime() + deltaMs);
  });

  it('403 für Nicht-Organisator', async () => {
    const orga = await loginAs('wk-shift-orga2@example.com');
    const mallory = await loginAs('wk-shift-mallory@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: orga },
      payload: { title: 'wk-ShiftFremd', startDate: future(0), endDate: future(10), visibility: 'PUBLIC' },
    });
    const res = await app.inject({
      method: 'POST', url: `/projects/${create.json().id}/shift`, cookies: { session: mallory },
      payload: { newStartDate: future(1) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('sendet dedupliziert Zeitplan-Mails an künftige Gebuchte mit alten+neuen Zeiten', async () => {
    const orga = await loginAs('wk-shift-mail-orga@example.com');
    const dora = await loginAs('wk-shift-mail-dora@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: orga },
      payload: { title: 'wk-ShiftMail', startDate: future(0), endDate: future(240), visibility: 'PUBLIC' },
    });
    const pid = create.json().id;

    // Dora bucht ZWEI Stunden — soll EINE gebündelte Mail bekommen (dedupliziert), nicht zwei.
    const d1 = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: dora },
      payload: { startTime: future(5) },
    });
    const d2 = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: dora },
      payload: { startTime: future(6) },
    });
    // Gast mit E-Mail bucht ebenfalls.
    const guest = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`,
      payload: { startTime: future(7), guestName: 'wk-Gast Shift', guestEmail: 'wk-gast-shift@example.com' },
    });
    // Gast OHNE E-Mail: darf mitverschoben werden, bekommt aber logischerweise keine Mail.
    await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`,
      payload: { startTime: future(8), guestName: 'wk-Gast Ohne Mail' },
    });

    scheduleChanges.length = 0;
    const deltaMs = 3 * DAY;
    const newStart = new Date(new Date(create.json().startDate).getTime() + deltaMs).toISOString();
    const shift = await app.inject({
      method: 'POST', url: `/projects/${pid}/shift`, cookies: { session: orga },
      payload: { newStartDate: newStart },
    });
    expect(shift.statusCode).toBe(200);

    const doraMail = scheduleChanges.filter((m) => m.email === 'wk-shift-mail-dora@example.com');
    expect(doraMail).toHaveLength(1); // dedupliziert trotz 2 Stunden
    expect(doraMail[0].m.slots).toHaveLength(2);
    const d1New = new Date(new Date(d1.json().startTime).getTime() + deltaMs).toISOString();
    const d2New = new Date(new Date(d2.json().startTime).getTime() + deltaMs).toISOString();
    const newTimes = doraMail[0].m.slots.map((s) => s.newStartTime).sort();
    expect(newTimes).toEqual([d1New, d2New].sort());
    expect(doraMail[0].m.slots[0].oldStartTime).not.toBe(doraMail[0].m.slots[0].newStartTime);

    const guestMail = scheduleChanges.filter((m) => m.email === 'wk-gast-shift@example.com');
    expect(guestMail).toHaveLength(1);
    expect(guestMail[0].m.slots).toHaveLength(1);
    expect(new Date(guestMail[0].m.slots[0].newStartTime).getTime()).toBe(
      new Date(guest.json().startTime).getTime() + deltaMs,
    );

    // Kein Eintrag für den mailless Gast.
    const noMailGuestEntries = scheduleChanges.filter((m) => m.m.name === 'wk-Gast Ohne Mail');
    expect(noMailGuestEntries).toHaveLength(0);
  });

  it('setzt remindedAt für künftige Slots zurück, damit Erinnerungen neu feuern', async () => {
    const orga = await loginAs('wk-shift-remind-orga@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: orga },
      payload: { title: 'wk-ShiftRemind', startDate: future(0), endDate: future(10), visibility: 'PUBLIC' },
    });
    const pid = create.json().id;
    const book = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: orga },
      payload: { startTime: future(5) },
    });
    await db.prisma.prayerSlot.update({
      where: { id: book.json().id },
      data: { remindedAt: new Date() },
    });
    const before = await db.prisma.prayerSlot.findUnique({ where: { id: book.json().id } });
    expect(before!.remindedAt).not.toBeNull();

    const newStart = new Date(new Date(create.json().startDate).getTime() + DAY).toISOString();
    await app.inject({
      method: 'POST', url: `/projects/${pid}/shift`, cookies: { session: orga },
      payload: { newStartDate: newStart },
    });

    const after = await db.prisma.prayerSlot.findUnique({ where: { id: book.json().id } });
    expect(after!.remindedAt).toBeNull();
  });
});

// fix2 (KRITISCH, End-User-Test v2 Befund 1): Shift-Kollision -> 500.
// `UPDATE PrayerSlot SET startTime = startTime + delta` verletzt den partiellen Unique-Index
// PrayerSlot_active_slot_unique (projectId, startTime) WHERE status IN (BOOKED, COMPLETED),
// sobald ein Slot beim Verschieben auf die (noch unverschobene) Zeit eines anderen Slots
// rutscht — SQLite prüft die Unique-Constraint pro Zeile während des Updates.
describe('fix2-POST /projects/:id/shift — Shift-Kollision zwischen zwei gebuchten Slots', () => {
  // `bookOrder` steuert, welcher der beiden Slots ZUERST gebucht wird (= niedrigere rowid
  // = wird von SQLite beim Multi-Row-UPDATE zuerst verarbeitet). Ein Vorwärts-Shift kollidiert
  // nur, wenn die zeitlich FRÜHERE Reihe zuerst verarbeitet wird und in die (noch unverschobene)
  // Position der später verarbeiteten, zeitlich SPÄTEREN Reihe rutscht — und umgekehrt für
  // rückwärts. Deshalb: 'earlier-first' für den Vorwärts-, 'later-first' für den Rückwärts-Test.
  async function setupTwoBookedSlotsXApart(
    prefix: string,
    deltaHours: number,
    bookOrder: 'earlier-first' | 'later-first',
  ) {
    const orga = await loginAs(`${prefix}-orga@example.com`);
    // Ein einziger Referenz-Zeitpunkt für Projekt + beide Slots: `future(h)` ruft
    // Date.now() bei jedem Aufruf neu auf, was bei einem exakten Vergleich (== statt
    // ~=) durch Millisekunden-Jitter zwischen den Calls fälschlich KEINE Kollision
    // erzeugen könnte. Hier wird alles deterministisch aus derselben `base` abgeleitet,
    // damit die verschobene Zeit bit-exakt die alte Zeit der anderen Reihe trifft.
    const base = Date.now() + 24 * 3600_000; // +1 Tag Puffer, damit alles in der Zukunft liegt
    const iso = (ms: number) => new Date(ms).toISOString();
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: orga },
      payload: { title: `${prefix}-Projekt`, startDate: iso(base), endDate: iso(base + 480 * 3600_000), visibility: 'PUBLIC' },
    });
    const pid = create.json().id;
    const earlierMs = base + 10 * 3600_000;
    const laterMs = base + (10 + deltaHours) * 3600_000;
    const [firstMs, secondMs] = bookOrder === 'earlier-first' ? [earlierMs, laterMs] : [laterMs, earlierMs];
    const first = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: orga },
      payload: { startTime: iso(firstMs) },
    });
    const second = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: orga },
      payload: { startTime: iso(secondMs) },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const slotA = bookOrder === 'earlier-first' ? first.json() : second.json(); // stets die zeitlich frühere
    const slotB = bookOrder === 'earlier-first' ? second.json() : first.json(); // stets die zeitlich spätere
    return { orga, pid, slotA, slotB, project: create.json() };
  }

  it('Vorwärts-Shift um genau den Abstand X zweier gebuchter Slots -> 200, beide Slots exakt verschoben', async () => {
    const deltaHours = 24;
    const { orga, pid, slotA, slotB, project } = await setupTwoBookedSlotsXApart('fix2-fwd', deltaHours, 'earlier-first');
    const deltaMs = deltaHours * 3600_000;
    const newStart = new Date(new Date(project.startDate).getTime() + deltaMs).toISOString();

    const shift = await app.inject({
      method: 'POST', url: `/projects/${pid}/shift`, cookies: { session: orga },
      payload: { newStartDate: newStart },
    });

    expect(shift.statusCode).toBe(200);
    const rowA = await db.prisma.prayerSlot.findUnique({ where: { id: slotA.id } });
    const rowB = await db.prisma.prayerSlot.findUnique({ where: { id: slotB.id } });
    expect(rowA!.startTime.getTime()).toBe(new Date(slotA.startTime).getTime() + deltaMs);
    expect(rowA!.endTime.getTime()).toBe(new Date(slotA.endTime).getTime() + deltaMs);
    expect(rowB!.startTime.getTime()).toBe(new Date(slotB.startTime).getTime() + deltaMs);
    expect(rowB!.endTime.getTime()).toBe(new Date(slotB.endTime).getTime() + deltaMs);
    expect(rowA!.status).toBe('BOOKED');
    expect(rowB!.status).toBe('BOOKED');
  });

  it('Rückwärts-Shift um genau -X -> 200, beide Slots exakt verschoben (kein Datenverlust)', async () => {
    const deltaHours = 24;
    const { orga, pid, slotA, slotB, project } = await setupTwoBookedSlotsXApart('fix2-bwd', deltaHours, 'later-first');
    const deltaMs = -deltaHours * 3600_000;
    const newStart = new Date(new Date(project.startDate).getTime() + deltaMs).toISOString();

    const shift = await app.inject({
      method: 'POST', url: `/projects/${pid}/shift`, cookies: { session: orga },
      payload: { newStartDate: newStart },
    });

    expect(shift.statusCode).toBe(200);
    const rowA = await db.prisma.prayerSlot.findUnique({ where: { id: slotA.id } });
    const rowB = await db.prisma.prayerSlot.findUnique({ where: { id: slotB.id } });
    expect(rowA!.startTime.getTime()).toBe(new Date(slotA.startTime).getTime() + deltaMs);
    expect(rowB!.startTime.getTime()).toBe(new Date(slotB.startTime).getTime() + deltaMs);
    expect(await db.prisma.prayerSlot.count({ where: { projectId: pid } })).toBe(2); // kein Datenverlust
  });
});

describe('wk-DELETE /projects/:id — Wache löschen (Ersteller-Lebenszyklus)', () => {
  it('403 für Nicht-Organisator', async () => {
    const orga = await loginAs('wk-del-orga@example.com');
    const mallory = await loginAs('wk-del-mallory@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: orga },
      payload: { title: 'wk-DelFremd', startDate: future(0), endDate: future(10), visibility: 'PUBLIC' },
    });
    const res = await app.inject({ method: 'DELETE', url: `/projects/${create.json().id}`, cookies: { session: mallory } });
    expect(res.statusCode).toBe(403);
  });

  it('löscht Projekt vollständig (keine verwaisten Slots/Requests/Memberships) und 404 danach', async () => {
    const orga = await loginAs('wk-del-cascade-orga@example.com');
    const stranger = await loginAs('wk-del-cascade-stranger@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: orga },
      payload: { title: 'wk-DelKaskade', startDate: future(0), endDate: future(10), visibility: 'PUBLIC' },
    });
    const pid = create.json().id;

    // Fremdbuchung (macht stranger zum Member) + eigene Anliegen-Nachricht (PrayerRequest).
    await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: stranger },
      payload: { startTime: future(2) },
    });
    await app.inject({
      method: 'POST', url: `/projects/${pid}/requests`, cookies: { session: orga },
      payload: { text: 'wk-Testanliegen für Löschung' },
    });

    const del = await app.inject({ method: 'DELETE', url: `/projects/${pid}`, cookies: { session: orga } });
    expect(del.statusCode).toBe(204);

    const getAfter = await app.inject({ method: 'GET', url: `/projects/${pid}` });
    expect(getAfter.statusCode).toBe(404);

    expect(await db.prisma.prayerSlot.count({ where: { projectId: pid } })).toBe(0);
    expect(await db.prisma.membership.count({ where: { projectId: pid } })).toBe(0);
    expect(await db.prisma.prayerRequest.count({ where: { projectId: pid } })).toBe(0);
  });

  it('sendet dedupliziert Abschieds-Mail an künftige Gebuchte, dann 404', async () => {
    const orga = await loginAs('wk-del-mail-orga@example.com');
    const dora = await loginAs('wk-del-mail-dora@example.com');
    const create = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: orga },
      payload: { title: 'wk-DelMail', startDate: future(0), endDate: future(10), visibility: 'PUBLIC' },
    });
    const pid = create.json().id;
    const d1 = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: dora },
      payload: { startTime: future(2) },
    });
    const d2 = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`, cookies: { session: dora },
      payload: { startTime: future(3) },
    });
    const guest = await app.inject({
      method: 'POST', url: `/projects/${pid}/slots`,
      payload: { startTime: future(4), guestName: 'wk-Gast Del', guestEmail: 'wk-gast-del@example.com' },
    });

    farewells.length = 0;
    const del = await app.inject({ method: 'DELETE', url: `/projects/${pid}`, cookies: { session: orga } });
    expect(del.statusCode).toBe(204);

    const doraFarewell = farewells.filter((f) => f.email === 'wk-del-mail-dora@example.com');
    expect(doraFarewell).toHaveLength(1); // dedupliziert
    expect(doraFarewell[0].m.slots.sort()).toEqual(
      [d1.json().startTime, d2.json().startTime].sort(),
    );

    const guestFarewell = farewells.filter((f) => f.email === 'wk-gast-del@example.com');
    expect(guestFarewell).toHaveLength(1);
    expect(guestFarewell[0].m.slots).toEqual([guest.json().startTime]);

    const getAfter = await app.inject({ method: 'GET', url: `/projects/${pid}` });
    expect(getAfter.statusCode).toBe(404);
  });
});
