import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Mailer } from '../lib/mailer.js';
import type { Env } from '../env.js';
import { generateToken, generateLoginCode, hashToken } from '../lib/tokens.js';
import { MagicLinkBody, VerifyBody, VerifyCodeBody, SESSION_COOKIE } from '../schemas/auth.js';
import { requireUser } from '../plugins/auth.js';
import { notifyAdmin } from '../lib/adminNotify.js';

const MAGIC_TTL_MS = 15 * 60 * 1000;
// Grace-Fenster, in dem ein konsumierter Magic-Token idempotent erneut Erfolg liefert (§6.4).
const VERIFY_GRACE_MS = 30 * 1000;
// A6: Code-Fehlversuche pro Nutzer, summiert über ALLE nicht abgelaufenen Tokens (ein frischer
// Link setzt den Zähler nicht zurück). Bei 6 Ziffern sind 5 Versuche je 15 min ≈ 1:200 000.
export const MAX_CODE_ATTEMPTS = 5;
// N4: Mehr als 3 Links je Adresse im TTL-Fenster → still 204 ohne Mail (Mail-Bombing über fremde Adressen).
export const MAX_LINKS_PER_EMAIL = 3;

export function authRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; mailer: Mailer; env: Env }) {
  const { prisma, mailer, env } = deps;

  app.post('/auth/magic-link', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, locale } = MagicLinkBody.parse(req.body);
    const name = email.split('@')[0];
    // A11a: Die Sprache wird nur beim Anlegen gesetzt. Für Bestandsnutzer wandert sie mit dem
    // Token und greift erst beim Einlösen (createSession) — sonst könnte jeder per Eintippen
    // einer fremden Adresse deren Mail-Sprache umstellen.
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, locale: locale ?? 'de' },
    });
    // N4: Antwort für „zu viele Links" identisch zur Normalantwort ohne Opt-in (204, leer) —
    // auch im DEV_LOGIN_RESPONSE-Modus kein devLoginUrl, sonst wäre das Limit umgehbar.
    const recentLinks = await prisma.magicToken.count({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - MAGIC_TTL_MS) } },
    });
    if (recentLinks >= MAX_LINKS_PER_EMAIL) {
      return reply.code(204).send();
    }
    const raw = generateToken();
    const code = generateLoginCode(); // Alternative zum Link: Anmelden auf einem anderen Gerät
    await prisma.magicToken.create({
      data: {
        token: hashToken(raw),
        code: hashToken(code),
        userId: user.id,
        locale: locale ?? null,
        expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
      },
    });
    const url = `${env.APP_URL}/auth/verify?token=${raw}`;
    await mailer.sendMagicLink(email, url, code);
    // Testmodus nur per explizitem Opt-in (DEV_LOGIN_RESPONSE=true, lokal/E2E): Login-Link
    // direkt zurückgeben, damit ohne Postfach eingeloggt werden kann. Ein fehlendes SMTP_URL
    // allein schaltet das NICHT mehr frei (A7); env.ts verweigert den Start, wenn das Opt-in
    // mit COOKIE_SECURE oder https-APP_URL kombiniert wird.
    if (env.DEV_LOGIN_RESPONSE) {
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

    return createSession(reply, record.userId, record.locale);
  });

  // Gemeinsame Session-Erstellung für Link- und Code-Login. `locale` ist die beim Anfordern
  // gewünschte Sprache des eingelösten Tokens — erst hier, nach bewiesenem Postfach-Zugriff,
  // darf sie den User ändern (A11a).
  async function createSession(reply: import('fastify').FastifyReply, userId: string, locale: string | null) {
    const raw = generateToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86400_000);
    await prisma.session.create({ data: { token: hashToken(raw), userId, expiresAt } });

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (locale && locale !== u.locale) {
      await prisma.user.update({ where: { id: u.id }, data: { locale } });
      u.locale = locale;
    }

    // Betreiber-Benachrichtigung „neues Konto": bewusst HIER und nicht beim Magic-Link-Upsert.
    // Dort entsteht der User-Datensatz schon durch bloßes Eintippen einer fremden Adresse —
    // eine Mail an dieser Stelle wäre von außen auslösbar. Erst der eingelöste Login beweist,
    // dass jemand tatsächlich Zugriff auf das Postfach hat. Deckt Link- und Code-Login ab.
    if (!u.activatedAt) {
      await prisma.user.update({ where: { id: u.id }, data: { activatedAt: new Date() } });
      notifyAdmin(deps, { kind: 'user_activated', name: u.name, email: u.email, locale: u.locale });
    }

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
    // Ein Fehlertext für alle Fälle (unbekannte Adresse, kein Token, gesperrt, falscher Code) —
    // sonst ließe sich über die Antwort ablesen, ob eine Adresse existiert.
    const fail = () => reply.code(400).send({ message: 'Code ungültig oder abgelaufen' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return fail();
    const record = await prisma.magicToken.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() }, code: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return fail();
    // A6: Versuch atomar reservieren, BEVOR verglichen wird. Die Grenze gilt pro Nutzer über
    // alle nicht abgelaufenen Tokens (auch konsumierte und ältere — ein frischer Link setzt
    // nichts zurück). Summe und Inkrement stehen bewusst in EINEM UPDATE-Statement: SQLite
    // führt es unter der Schreibsperre aus, parallele Requests — auch über verschiedene Tokens
    // desselben Users — werden serialisiert und jeder sieht die Reservierungen der vorigen.
    // Ein getrenntes `aggregate` vor einem `updateMany` würde die Summe VOR der Reservierung
    // lesen und könnte bei N parallelen Requests N Vergleiche durchlassen.
    // DateTime liegt in SQLite als Epoch-Millisekunden (INTEGER), siehe projects.ts /shift.
    const reserved = await prisma.$executeRaw`
      UPDATE MagicToken SET codeAttempts = codeAttempts + 1
      WHERE id = ${record.id}
        AND (SELECT COALESCE(SUM(codeAttempts), 0) FROM MagicToken
             WHERE userId = ${user.id} AND expiresAt > ${Date.now()}) < ${MAX_CODE_ATTEMPTS}`;
    if (reserved === 0) return fail();
    if (record.code !== hashToken(code)) return fail();
    // Zähler bleibt stehen (Token wird ohnehin konsumiert und zählt bis zum Ablauf weiter mit).
    await prisma.magicToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return createSession(reply, record.userId, record.locale);
  });

  app.get('/auth/me', async (req) => requireUser(req));

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) await prisma.session.deleteMany({ where: { token: hashToken(raw) } });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
