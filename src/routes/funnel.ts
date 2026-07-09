import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../env.js';

// Öffentlich meldbare Schritte — 'booking' fehlt bewusst: Conversion zählt NUR der Server
// im Buchungs-Handler, sonst wäre der Trichter von außen aufblasbar.
const HitBody = z.object({ step: z.enum(['landing', 'list', 'watch']) });
const FunnelQuery = z.object({ token: z.string().optional() });

const DAYS = 30;
export type FunnelStep = 'landing' | 'list' | 'watch' | 'booking';

/** Tageszähler hochzählen — bewusst OHNE jeden Personen-/Request-Bezug (Backlog 8). */
export async function bumpFunnel(prisma: PrismaClient, step: FunnelStep): Promise<void> {
  const date = new Date().toISOString().slice(0, 10); // UTC-Tag
  await prisma.funnelCount.upsert({
    where: { date_step: { date, step } },
    update: { count: { increment: 1 } },
    create: { date, step, count: 1 },
  });
}

export function funnelRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; env?: Env }) {
  const { prisma, env } = deps;

  app.post('/funnel/hit', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { step } = HitBody.parse(req.body);
    // Der Hit-Endpoint IST der Zähler — hier wird direkt awaited (kein anderer Zweck,
    // den es zu beschleunigen gäbe). Fire-and-forget gilt für den Booking-Zähler in
    // slots.ts, wo das Zählen niemals die eigentliche Buchung verlangsamen darf.
    await bumpFunnel(prisma, step);
    return reply.code(204).send();
  });

  app.get('/stats/funnel', async (req, reply) => {
    const { token } = FunnelQuery.parse(req.query);
    // Ohne konfiguriertes Token existiert der Endpoint nach außen nicht (404, nie 401/403 —
    // kein Orakel, ob es hier etwas zu holen gibt).
    if (!env?.FUNNEL_TOKEN || !token || token !== env.FUNNEL_TOKEN) {
      return reply.code(404).send({ message: 'Nicht gefunden' });
    }
    const cutoff = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
    const rows = await prisma.funnelCount.findMany({
      where: { date: { gte: cutoff } },
      orderBy: { date: 'desc' },
    });
    const byDate = new Map<string, { date: string; landing: number; list: number; watch: number; booking: number }>();
    for (const r of rows) {
      const d = byDate.get(r.date) ?? { date: r.date, landing: 0, list: 0, watch: 0, booking: 0 };
      (d as Record<string, number | string>)[r.step] = r.count;
      byDate.set(r.date, d);
    }
    return { days: [...byDate.values()] };
  });
}
