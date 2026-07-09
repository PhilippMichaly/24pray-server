import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const feedbacks: { to: string; f: { message: string; replyTo?: string; page?: string } }[] = [];

beforeAll(async () => {
  db = await makeTestDb();
  app = await buildApp({
    prisma: db.prisma,
    env: parseEnv({ APP_URL: 'http://localhost:3000', FEEDBACK_TO: 'un9-owner@example.com' }),
    mailer: {
      async sendMagicLink() {},
      async sendFeedback(to, f) { feedbacks.push({ to, f }); },
    },
  });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.cleanup(); });

describe('Feedback-Endpoint (User-Zusatzpunkt)', () => {
  it('valides Feedback → 204, Mail an FEEDBACK_TO mit replyTo und page', async () => {
    const res = await app.inject({
      method: 'POST', url: '/feedback',
      payload: { message: 'un9: Der Kalender-Knopf tut nichts.', email: 'un9-user@example.com', page: '/projects/abc' },
    });
    expect(res.statusCode).toBe(204);
    expect(feedbacks.length).toBe(1);
    expect(feedbacks[0].to).toBe('un9-owner@example.com');
    expect(feedbacks[0].f.message).toContain('Kalender-Knopf');
    expect(feedbacks[0].f.replyTo).toBe('un9-user@example.com');
    expect(feedbacks[0].f.page).toBe('/projects/abc');
  });

  it('email/page optional; zu kurze message → 400', async () => {
    expect((await app.inject({ method: 'POST', url: '/feedback', payload: { message: 'un9 ohne alles, aber lang genug' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/feedback', payload: { message: 'kurz' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/feedback', payload: { message: 'lang genug aber', email: 'keinemail' } })).statusCode).toBe(400);
  });

  it('ohne FEEDBACK_TO: 404 (Endpoint faktisch aus)', async () => {
    const { buildApp: build } = await import('../app.js');
    const bare = await build({
      prisma: db.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000' }),
      mailer: { async sendMagicLink() {} },
    });
    await bare.ready();
    try {
      expect((await bare.inject({ method: 'POST', url: '/feedback', payload: { message: 'lang genug fuer valide' } })).statusCode).toBe(404);
    } finally { await bare.close(); }
  });
});
