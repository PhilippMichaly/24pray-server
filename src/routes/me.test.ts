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
    env: parseEnv({ APP_URL: 'http://localhost:3000' }),
    mailer: { async sendMagicLink(email, url) { captured.push({ email, url }); } },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

const at = (h: number) => new Date(Date.UTC(2026, 5, 20, h, 0, 0)).toISOString();

describe('PATCH /me — wb-Anzeigenamen ändern', () => {
  it('aktualisiert den Anzeigenamen (getrimmt)', async () => {
    const alice = await loginAs('wb-me-name@example.com');
    const res = await app.inject({
      method: 'PATCH', url: '/me', cookies: { session: alice },
      payload: { name: '  Neuer Name  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Neuer Name');

    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: { session: alice } });
    expect(me.json().name).toBe('Neuer Name');
  });

  it('lehnt zu kurze Namen ab (400)', async () => {
    const alice = await loginAs('wb-me-short@example.com');
    const res = await app.inject({
      method: 'PATCH', url: '/me', cookies: { session: alice },
      payload: { name: 'A' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('erfordert Login', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/me', payload: { name: 'X Y' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /me — wb-Konto löschen', () => {
  it('löscht eigene organisierte Projekte komplett; anonymisiert vergangene und gibt zukünftige Buchungen in fremden Ketten frei', async () => {
    const owner = await loginAs('wb-me-del-owner@example.com');
    const stranger = await loginAs('wb-me-del-stranger@example.com');

    // Eigenes Projekt mit fremder Buchung — muss komplett verschwinden.
    const own = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: owner },
      payload: { title: 'wb-EigeneKette', startDate: at(0), endDate: at(10), visibility: 'PUBLIC' },
    });
    const ownId = own.json().id;
    await app.inject({
      method: 'POST', url: `/projects/${ownId}/slots`, cookies: { session: stranger },
      payload: { startTime: at(2) },
    });

    // Fremdes Projekt, in dem `owner` selbst bucht: eine noch offene (BOOKED) und eine
    // bereits gehaltene (COMPLETED) Buchung.
    const foreign = await app.inject({
      method: 'POST', url: '/projects', cookies: { session: stranger },
      payload: { title: 'wb-FremdeKette', startDate: at(0), endDate: at(10), visibility: 'PUBLIC' },
    });
    const foreignId = foreign.json().id;
    const futureBook = await app.inject({
      method: 'POST', url: `/projects/${foreignId}/slots`, cookies: { session: owner },
      payload: { startTime: at(9) },
    });
    const pastBook = await app.inject({
      method: 'POST', url: `/projects/${foreignId}/slots`, cookies: { session: owner },
      payload: { startTime: at(3) },
    });
    await db.prisma.prayerSlot.update({ where: { id: pastBook.json().id }, data: { status: 'COMPLETED' } });

    const del = await app.inject({ method: 'DELETE', url: '/me', cookies: { session: owner } });
    expect(del.statusCode).toBe(204);

    // Session ist ungültig geworden.
    const meAfter = await app.inject({ method: 'GET', url: '/auth/me', cookies: { session: owner } });
    expect(meAfter.statusCode).toBe(401);

    // Eigenes Projekt ist komplett weg (auch die fremde Buchung darin).
    const ownGone = await app.inject({ method: 'GET', url: `/projects/${ownId}` });
    expect(ownGone.statusCode).toBe(404);

    // Zukunfts-Buchung (noch BOOKED) in fremder Kette: Stunde wieder frei.
    const foreignGrid = await app.inject({ method: 'GET', url: `/projects/${foreignId}/slots` });
    const freedSlot = foreignGrid.json().find((s: { startTime: string }) => s.startTime === at(9));
    expect(freedSlot.status).toBe('FREE');
    expect(futureBook.statusCode).toBe(200);

    // Vergangenheits-Buchung (COMPLETED): anonymisiert, Statistik der fremden Kette bleibt korrekt.
    const stats = await app.inject({ method: 'GET', url: `/projects/${foreignId}/stats` });
    expect(stats.json().completedHours).toBe(1);

    const pastSlotRow = await db.prisma.prayerSlot.findUnique({ where: { id: pastBook.json().id } });
    expect(pastSlotRow!.userId).toBeNull();
    expect(pastSlotRow!.guestName).toBe('(gelöscht)');
  });

  it('erfordert Login', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/me' });
    expect(res.statusCode).toBe(401);
  });
});
