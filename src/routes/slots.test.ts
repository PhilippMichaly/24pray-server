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
});
