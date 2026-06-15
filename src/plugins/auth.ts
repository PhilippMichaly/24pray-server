import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { hashToken } from '../lib/tokens.js';
import { SESSION_COOKIE } from '../schemas/auth.js';

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  telegramChatId: string | null;
  createdAt: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthedUser | null;
  }
}

export function registerAuth(app: FastifyInstance, prisma: PrismaClient) {
  app.decorateRequest('user', null);

  app.addHook('preHandler', async (req: FastifyRequest) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const session = await prisma.session.findUnique({
      where: { token: hashToken(raw) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) return;
    const u = session.user;
    req.user = {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      telegramChatId: u.telegramChatId,
      createdAt: u.createdAt.toISOString(),
    };
  });
}

export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) {
    const err = new Error('Nicht angemeldet') as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }
  return req.user;
}
