import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Env } from './env.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { registerAuth } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { slotRoutes } from './routes/slots.js';

export interface BuildAppDeps {
  prisma: PrismaClient;
  env: Env;
  mailer?: Mailer;
}

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const { prisma, env } = deps;
  const mailer = deps.mailer ?? createMailer({ smtpUrl: env.SMTP_URL, from: env.SMTP_FROM });

  const app = Fastify({ logger: false });

  await app.register(cors, { origin: env.APP_URL, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ message: err.errors[0]?.message ?? 'Ungültige Eingabe' });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ message: err.message ?? 'Serverfehler' });
  });

  registerAuth(app, prisma);
  app.get('/health', async () => ({ ok: true }));
  authRoutes(app, { prisma, mailer, env });
  projectRoutes(app, { prisma });
  slotRoutes(app, { prisma });

  return app;
}
