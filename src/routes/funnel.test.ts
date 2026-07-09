import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string }[] = [];

let loginSeq = 0;
async function loginAs(email: string): Promise<string> {
  const remoteAddress = `10.2.0.${++loginSeq}`;
  await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email }, remoteAddress });
  const token = new URL(captured.at(-1)!.url).searchParams.get('token')!;
  const verify = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token }, remoteAddress });
  return verify.cookies.find((c) => c.name === 'session')!.value;
}

beforeAll(async () => {
  db = await makeTestDb();
  app = await buildApp({
    prisma: db.prisma,
    env: parseEnv({ APP_URL: 'http://localhost:3000', FUNNEL_TOKEN: 'un8-secret' }),
    mailer: {
      async sendMagicLink(email, url) { captured.push({ email, url }); },
    },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

const at = (h: number) => new Date(Date.UTC(2026, 5, 20, h, 0, 0)).toISOString();

describe('Backlog 8 — Funnel-Zähler', () => {
  it('POST /funnel/hit zählt pro Tag+Step hoch, 204, speichert NUR date/step/count', async () => {
    for (const step of ['landing', 'landing', 'list', 'watch'] as const) {
      const res = await app.inject({ method: 'POST', url: '/funnel/hit', payload: { step } });
      expect(res.statusCode).toBe(204);
    }
    const rows = await db.prisma.funnelCount.findMany();
    const byStep = new Map(rows.map((r) => [r.step, r.count]));
    expect(byStep.get('landing')).toBe(2);
    expect(byStep.get('list')).toBe(1);
    expect(byStep.get('watch')).toBe(1);
    // Datenschutz-Kern: das Modell HAT keine weiteren Spalten (id/date/step/count)
    expect(Object.keys(rows[0]).sort()).toEqual(['count', 'date', 'id', 'step']);
  });

  it('ungültiger step → 400; booking ist NICHT über den öffentlichen Hit-Endpoint zählbar', async () => {
    expect((await app.inject({ method: 'POST', url: '/funnel/hit', payload: { step: 'booking' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/funnel/hit', payload: { step: 'x' } })).statusCode).toBe(400);
  });

  it('Buchung zählt booking serverseitig', async () => {
    const owner = await loginAs('un8-owner@example.com');
    const res = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'un8 Funnel', startDate: at(0), endDate: at(6), visibility: 'PUBLIC' },
    });
    const id = res.json().id;
    await app.inject({ method: 'POST', url: `/projects/${id}/slots`, payload: { startTime: at(1), guestName: 'un8-Gast' } });
    await vi.waitFor(async () => {
      const row = await db.prisma.funnelCount.findFirst({ where: { step: 'booking' } });
      expect(row?.count ?? 0).toBeGreaterThanOrEqual(1);
    });
  });

  it('GET /stats/funnel: 404 ohne/mit falschem Token, Daten mit richtigem Token', async () => {
    expect((await app.inject({ method: 'GET', url: '/stats/funnel' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/stats/funnel?token=falsch' })).statusCode).toBe(404);
    const ok = await app.inject({ method: 'GET', url: '/stats/funnel?token=un8-secret' });
    expect(ok.statusCode).toBe(200);
    const today = ok.json().days.find((d: { date: string }) => d.date === new Date().toISOString().slice(0, 10));
    expect(today.landing).toBeGreaterThanOrEqual(2);
    expect(today.booking).toBeGreaterThanOrEqual(1);
  });

  it('GET /stats/funnel: 404 wenn FUNNEL_TOKEN leer (Endpoint faktisch aus)', async () => {
    const { buildApp: build } = await import('../app.js');
    const bare = await build({
      prisma: db.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000' }),
      mailer: { async sendMagicLink() {} },
    });
    await bare.ready();
    try {
      expect((await bare.inject({ method: 'GET', url: '/stats/funnel?token=' })).statusCode).toBe(404);
      expect((await bare.inject({ method: 'GET', url: '/stats/funnel?token=un8-secret' })).statusCode).toBe(404);
    } finally { await bare.close(); }
  });
});
