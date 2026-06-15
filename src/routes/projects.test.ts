import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string }[] = [];

async function loginAs(email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email } });
  const token = new URL(captured.at(-1)!.url).searchParams.get('token')!;
  const verify = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
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
