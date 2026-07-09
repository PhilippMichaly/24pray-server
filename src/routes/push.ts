import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireUser } from '../plugins/auth.js';
import type { Env } from '../env.js';

const SubscribeBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(100) }),
});
const UnsubscribeBody = z.object({ endpoint: z.string().url().max(1000) });

export function pushRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; env?: Env }) {
  const { prisma, env } = deps;
  const enabled = () => Boolean(env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY);

  app.get('/push/vapid-key', async (req, reply) => {
    if (!enabled()) return reply.code(404).send({ message: 'Nicht gefunden' });
    return { key: env!.VAPID_PUBLIC_KEY };
  });

  app.post('/me/push-subscriptions', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!enabled()) return reply.code(404).send({ message: 'Nicht gefunden' });
    const user = requireUser(req);
    const body = SubscribeBody.parse(req.body);
    // Upsert per endpoint: Gerät kann den Besitzer wechseln (neuer Login im selben Browser)
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { p256dh: body.keys.p256dh, auth: body.keys.auth, userId: user.id },
      create: { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userId: user.id },
    });
    return reply.code(204).send();
  });

  app.delete('/me/push-subscriptions', async (req, reply) => {
    if (!enabled()) return reply.code(404).send({ message: 'Nicht gefunden' });
    const user = requireUser(req);
    const { endpoint } = UnsubscribeBody.parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    return reply.code(204).send();
  });
}
