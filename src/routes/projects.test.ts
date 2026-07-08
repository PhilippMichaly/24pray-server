import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string }[] = [];

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
    mailer: { async sendMagicLink(email, url) { captured.push({ email, url }); } },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

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
