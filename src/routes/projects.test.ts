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
