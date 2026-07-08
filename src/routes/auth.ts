import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Mailer } from '../lib/mailer.js';
import type { Env } from '../env.js';
import { generateToken, generateLoginCode, hashToken } from '../lib/tokens.js';
import { MagicLinkBody, VerifyBody, VerifyCodeBody, SESSION_COOKIE } from '../schemas/auth.js';
import { requireUser } from '../plugins/auth.js';

const MAGIC_TTL_MS = 15 * 60 * 1000;
// Grace-Fenster, in dem ein konsumierter Magic-Token idempotent erneut Erfolg liefert (§6.4).
const VERIFY_GRACE_MS = 30 * 1000;

export function authRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; mailer: Mailer; env: Env }) {
  const { prisma, mailer, env } = deps;

  app.post('/auth/magic-link', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email } = MagicLinkBody.parse(req.body);
    const name = email.split('@')[0];
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name },
    });
    const raw = generateToken();
    const code = generateLoginCode(); // Alternative zum Link: Anmelden auf einem anderen Gerät
    await prisma.magicToken.create({
      data: {
        token: hashToken(raw),
        code: hashToken(code),
        userId: user.id,
        expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
      },
    });
    const url = `${env.APP_URL}/auth/verify?token=${raw}`;
    await mailer.sendMagicLink(email, url, code);
    // Testmodus (kein SMTP konfiguriert = kein echtes Deployment): Login-Link direkt
    // zurückgeben, damit ohne Postfach eingeloggt werden kann. In Produktion ist SMTP
    // gesetzt → Link wird NIE ausgeliefert (kein Bypass). Siehe README/§Testmodus.
    if (!env.SMTP_URL) {
      return reply.code(200).send({ devLoginUrl: url });
    }
    return reply.code(204).send();
  });

  app.post('/auth/verify', async (req, reply) => {
    const { token } = VerifyBody.parse(req.body);
    const record = await prisma.magicToken.findUnique({ where: { token: hashToken(token) } });
    if (!record || record.expiresAt < new Date()) {
      return reply.code(400).send({ message: 'Link ungültig oder abgelaufen' });
    }
    // Idempotenz (§6.4): React-StrictMode feuert /auth/verify doppelt. Ein bereits
    // konsumierter Token darf innerhalb eines kurzen Grace-Fensters erneut Erfolg liefern
    // (neue Session), danach ist es echter Reuse → 400.
    if (record.consumedAt) {
      if (record.consumedAt.getTime() < Date.now() - VERIFY_GRACE_MS) {
        return reply.code(400).send({ message: 'Link ungültig oder abgelaufen' });
      }
    } else {
      await prisma.magicToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    }

    return createSession(reply, record.userId);
  });

  // Gemeinsame Session-Erstellung für Link- und Code-Login.
  async function createSession(reply: import('fastify').FastifyReply, userId: string) {
    const raw = generateToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86400_000);
    await prisma.session.create({ data: { token: hashToken(raw), userId, expiresAt } });

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    reply.setCookie(SESSION_COOKIE, raw, {
      httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, path: '/', expires: expiresAt,
    });
    return {
      id: u.id, email: u.email, name: u.name, role: u.role,
      telegramChatId: u.telegramChatId, createdAt: u.createdAt.toISOString(),
    };
  }

  // Code-Login (6-stellig, aus der Mail): für die Anmeldung auf einem anderen Gerät.
  app.post('/auth/verify-code', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, code } = VerifyCodeBody.parse(req.body);
    const fail = () => reply.code(400).send({ message: 'Code ungültig oder abgelaufen' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return fail();
    const record = await prisma.magicToken.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() }, code: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.codeAttempts >= 5) return fail(); // Brute-Force-Bremse
    if (record.code !== hashToken(code)) {
      await prisma.magicToken.update({ where: { id: record.id }, data: { codeAttempts: { increment: 1 } } });
      return fail();
    }
    await prisma.magicToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return createSession(reply, record.userId);
  });

  app.get('/auth/me', async (req) => requireUser(req));

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) await prisma.session.deleteMany({ where: { token: hashToken(raw) } });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
