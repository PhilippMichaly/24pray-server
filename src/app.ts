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
  // Nur für Tests (Ruling R1): schaltet die Pro-IP-Limits auf schreibenden Routen (Buchen,
  // Projekt anlegen) ab, weil inject alle Requests von 127.0.0.1 schickt. Bewusst kein Env-Schalter.
  disableWriteRateLimits?: boolean;
}

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const { prisma, env, disableWriteRateLimits } = deps;
  const mailer = deps.mailer ?? createMailer({ smtpUrl: env.SMTP_URL, from: env.SMTP_FROM });
  const pushSender = deps.pushSender !== undefined ? deps.pushSender : createPushSender(env);

  // Lasttest-Fix: WAL entkoppelt Reader von Writern (persistiert in der DB-Datei).
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  } catch {
    /* z.B. read-only FS — App soll trotzdem starten */
  }

  // A1: Hinter nginx (127.0.0.1) liefert erst trustProxy die echte Client-IP aus X-Forwarded-For;
  // nur Loopback ist vertrauenswürdig, X-Forwarded-For anderer Absender wird ignoriert.
  const app = Fastify({ logger: false, trustProxy: ['127.0.0.1', '::1'] });

  // APP_URL immer erlaubt; CORS_ORIGINS fügt weitere Frontend-Origins hinzu (§6.5).
  const corsOrigins = [env.APP_URL, ...env.CORS_ORIGINS];
  await app.register(cors, { origin: corsOrigins, credentials: true });
  await app.register(cookie);
  // Important 3: Deutsche 429-Meldung für alle Routen. @fastify/rate-limit wirft den Rückgabewert
  // des Builders; der eigene Error-Handler liest statusCode daraus (fehlt er, würde daraus ein 500).
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      statusCode: 429,
      message: 'Zu viele Anfragen – bitte in einer Minute noch einmal versuchen.',
    }),
  });

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
    // Fastify 5 typisiert den Fehler als unknown (geworfen werden kann alles) — Message nur von Error-Objekten.
    const message = err instanceof Error ? err.message : undefined;
    return reply.code(status).send({ message: message ?? 'Serverfehler' });
  });

  registerAuth(app, prisma);
  app.get('/health', async () => ({ ok: true }));
  authRoutes(app, { prisma, mailer, env });
  projectRoutes(app, { prisma, mailer, env, disableWriteRateLimits });
  slotRoutes(app, { prisma, mailer, env, disableWriteRateLimits });
  communityRoutes(app, { prisma, mailer, env, pushSender });
  meRoutes(app, { prisma });
  funnelRoutes(app, { prisma, env });
  feedbackRoutes(app, { mailer, env });
  pushRoutes(app, { prisma, env });

  return app;
}
