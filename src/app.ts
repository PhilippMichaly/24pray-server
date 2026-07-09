import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Env } from './env.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { createPushSender, type PushSender } from './lib/push.js';
import { registerAuth } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { slotRoutes } from './routes/slots.js';
import { communityRoutes } from './routes/community.js';
import { meRoutes } from './routes/me.js';
import { funnelRoutes } from './routes/funnel.js';
import { feedbackRoutes } from './routes/feedback.js';
import { pushRoutes } from './routes/push.js';

export interface BuildAppDeps {
  prisma: PrismaClient;
  env: Env;
  mailer?: Mailer;
  // Backlog 7: injizierbar für Tests (Fakes) / explizit null zum Ausschalten trotz VAPID-Env.
  pushSender?: PushSender | null;
}

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const { prisma, env } = deps;
  const mailer = deps.mailer ?? createMailer({ smtpUrl: env.SMTP_URL, from: env.SMTP_FROM });
  const pushSender = deps.pushSender !== undefined ? deps.pushSender : createPushSender(env);

  // Lasttest-Fix: WAL entkoppelt Reader von Writern (persistiert in der DB-Datei).
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  } catch {
    /* z.B. read-only FS — App soll trotzdem starten */
  }

  const app = Fastify({ logger: false });

  // APP_URL immer erlaubt; CORS_ORIGINS fügt weitere Frontend-Origins hinzu (§6.5).
  const corsOrigins = [env.APP_URL, ...env.CORS_ORIGINS];
  await app.register(cors, { origin: corsOrigins, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ message: err.errors[0]?.message ?? 'Ungültige Eingabe' });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    // fix2 (HOCH, End-User-Test v2 Befund 2): 4xx (Zod + httpError-Messages aus den Routen)
    // bleiben unverändert — die sind bewusste, harmlose Nutzer-Meldungen. Ab 500 aufwärts ist
    // err.message ein interner Detail (SQL/Constraint/Stacktrace-Fragmente) und darf NICHT an
    // den Client gehen; stattdessen serverseitig loggen (logger:false loggt sonst gar nichts —
    // ein 500er würde sonst spurlos verschwinden) und einen neutralen Text zurückgeben.
    if (status >= 500) {
      console.error('[api]', req.method, req.url, err);
      return reply.code(status).send({ message: 'Serverfehler' });
    }
    return reply.code(status).send({ message: err.message ?? 'Serverfehler' });
  });

  registerAuth(app, prisma);
  app.get('/health', async () => ({ ok: true }));
  authRoutes(app, { prisma, mailer, env });
  projectRoutes(app, { prisma, mailer, env });
  slotRoutes(app, { prisma, mailer, env });
  communityRoutes(app, { prisma, mailer, env });
  meRoutes(app, { prisma });
  funnelRoutes(app, { prisma, env });
  feedbackRoutes(app, { mailer, env });
  pushRoutes(app, { prisma, env });

  return app;
}
