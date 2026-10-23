import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseEnv } from '../env.js';
import { makeTestDb, type TestDb } from '../test/helpers.js';

let db: TestDb;
let app: FastifyInstance;
const captured: { email: string; url: string; code?: string }[] = [];

beforeAll(async () => {
  db = await makeTestDb();
  const env = parseEnv({ APP_URL: 'http://localhost:3000', DEV_LOGIN_RESPONSE: 'true' });
  app = await buildApp({
    prisma: db.prisma,
    env,
    mailer: { async sendMagicLink(email, url, code) { captured.push({ email, url, code }); } },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.cleanup();
});

function tokenFrom(url: string): string {
  return new URL(url).searchParams.get('token')!;
}

describe('auth flow', () => {
  it('full cycle: magic-link -> verify -> me -> logout', async () => {
    const ml = await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'a@example.com' } });
    // Opt-in DEV_LOGIN_RESPONSE (lokal/E2E): 200 + devLoginUrl statt 204 (Mail-los einloggbar).
    expect(ml.statusCode).toBe(200);
    expect(ml.json().devLoginUrl).toContain('/auth/verify?token=');
    expect(captured.at(-1)!.email).toBe('a@example.com');

    const token = tokenFrom(captured.at(-1)!.url);
    const verify = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().email).toBe('a@example.com');
    const cookie = verify.cookies.find((c) => c.name === 'session')!;
    expect(cookie.httpOnly).toBe(true);

    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: { session: cookie.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('a@example.com');

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { session: cookie.value } });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/auth/me', cookies: { session: cookie.value } });
    expect(after.statusCode).toBe(401);
  });

  it('liefert ohne DEV_LOGIN_RESPONSE keinen devLoginUrl, auch ohne SMTP', async () => {
    const quietApp = await buildApp({
      prisma: db.prisma,
      env: parseEnv({ APP_URL: 'http://localhost:3000' }),
      mailer: { async sendMagicLink() {} },
    });
    await quietApp.ready();
    try {
      const res = await quietApp.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'q@example.com' } });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
    } finally {
      await quietApp.close();
    }
  });

  it('me without cookie is 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('verify is idempotent within the grace window (StrictMode double-POST)', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'b@example.com' } });
    const token = tokenFrom(captured.at(-1)!.url);
    const first = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(first.statusCode).toBe(200);
    // Sofortiger zweiter POST (React-StrictMode) → weiterhin Erfolg, keine Sackgasse.
    const second = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(second.statusCode).toBe(200);
    expect(second.json().email).toBe('b@example.com');
  });

  it('Code-Login: Mail enthält 6-stelligen Code, /auth/verify-code loggt ein', async () => {
    const ml = await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'code@example.com' }, remoteAddress: '10.9.0.1' });
    expect(ml.statusCode).toBe(200);
    const code = captured.at(-1)!.code!;
    expect(code).toMatch(/^\d{6}$/);

    const v = await app.inject({
      method: 'POST', url: '/auth/verify-code',
      payload: { email: 'code@example.com', code }, remoteAddress: '10.9.0.2',
    });
    expect(v.statusCode).toBe(200);
    expect(v.json().email).toBe('code@example.com');
    expect(v.cookies.find((c) => c.name === 'session')).toBeTruthy();

    // Reuse desselben Codes → 400 (konsumiert)
    const reuse = await app.inject({
      method: 'POST', url: '/auth/verify-code',
      payload: { email: 'code@example.com', code }, remoteAddress: '10.9.0.3',
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('Code-Login: falscher Code 400, nach 5 Fehlversuchen gesperrt (auch mit richtigem Code)', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'brute@example.com' }, remoteAddress: '10.9.1.1' });
    const code = captured.at(-1)!.code!;
    for (let i = 0; i < 5; i++) {
      const bad = await app.inject({
        method: 'POST', url: '/auth/verify-code',
        payload: { email: 'brute@example.com', code: '000000' }, remoteAddress: `10.9.1.${2 + i}`,
      });
      expect(bad.statusCode).toBe(400);
    }
    const blocked = await app.inject({
      method: 'POST', url: '/auth/verify-code',
      payload: { email: 'brute@example.com', code }, remoteAddress: '10.9.1.10',
    });
    expect(blocked.statusCode).toBe(400);
  });

  it('verify rejects a consumed token after the grace window elapsed', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: 'c@example.com' } });
    const token = tokenFrom(captured.at(-1)!.url);
    const first = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(first.statusCode).toBe(200);
    // Konsum künstlich altern lassen (jenseits des 30s-Grace-Fensters).
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: 'c@example.com' } });
    await db.prisma.magicToken.updateMany({
      where: { userId: user.id },
      data: { consumedAt: new Date(Date.now() - 60_000) },
    });
    const late = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
    expect(late.statusCode).toBe(400);
  });
});

describe('Backlog 1 — Locale-Erfassung beim Login', () => {
  it('magic-link persistiert locale am User; erneuter eingelöster Login aktualisiert sie', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-locale@example.com', locale: 'he' }, remoteAddress: '10.9.0.1' });
    let u = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un1-locale@example.com' } });
    expect(u.locale).toBe('he');
    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-locale@example.com', locale: 'en' }, remoteAddress: '10.9.0.2' });
    // A11a: Die neue Sprache greift erst, wenn der Link eingelöst wird (siehe Block unten).
    const verify = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token: tokenFrom(captured.at(-1)!.url) } });
    expect(verify.statusCode).toBe(200);
    u = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un1-locale@example.com' } });
    expect(u.locale).toBe('en');
  });

  it('ohne locale bleibt der Default de', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-default@example.com' }, remoteAddress: '10.9.0.3' });
    const u = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un1-default@example.com' } });
    expect(u.locale).toBe('de');
  });

  it('locale-loser Login überschreibt eine bestehende abweichende User-Locale NICHT', async () => {
    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-keep@example.com', locale: 'he' }, remoteAddress: '10.9.0.4' });
    let u = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un1-keep@example.com' } });
    expect(u.locale).toBe('he');

    await app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'un1-keep@example.com' }, remoteAddress: '10.9.0.5' });
    u = await db.prisma.user.findUniqueOrThrow({ where: { email: 'un1-keep@example.com' } });
    expect(u.locale).toBe('he');
  });
});

describe('A6/N4/A11a — Code-Brute-Force pro Nutzer, Link-Limit pro Adresse, Locale erst nach Login', () => {
  // Jeder Request hinter dem vertrauenswürdigen Proxy mit eigener Client-IP, damit die
  // IP-Rate-Limits (magic-link 5/min, verify-code 10/min) hier nicht mitspielen — geprüft
  // wird ausschließlich die Grenze pro Nutzer bzw. pro Adresse.
  let ipSeq = 0;
  const viaProxy = (ip: string) => ({ remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } });
  const requestLink = (email: string, locale?: string) => app.inject({
    method: 'POST', url: '/auth/magic-link', payload: locale ? { email, locale } : { email },
    ...viaProxy(`10.3.1.${++ipSeq}`),
  });
  const tryCode = (email: string, code: string) => app.inject({
    method: 'POST', url: '/auth/verify-code', payload: { email, code }, ...viaProxy(`10.3.2.${++ipSeq}`),
  });
  const attemptsSum = async (email: string) => {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    const agg = await db.prisma.magicToken.aggregate({ where: { userId: user.id }, _sum: { codeAttempts: true } });
    return agg._sum.codeAttempts ?? 0;
  };

  it('Code-Versuche zählen pro Nutzer über alle Tokens', async () => {
    const email = 'a6-sum@example.com';
    // 3 Links, 5 Fehlversuche verteilt über die Tokens (ein frischer Link setzt den Zähler nicht zurück).
    await requestLink(email);
    expect((await tryCode(email, '000000')).statusCode).toBe(400);
    expect((await tryCode(email, '000000')).statusCode).toBe(400);
    await requestLink(email);
    expect((await tryCode(email, '000000')).statusCode).toBe(400);
    expect((await tryCode(email, '000000')).statusCode).toBe(400);
    await requestLink(email);
    const code = captured.at(-1)!.code!;
    expect((await tryCode(email, '000000')).statusCode).toBe(400);
    // 6. Versuch mit dem RICHTIGEN Code des neuesten Tokens → trotzdem 400 (Summe 5 erreicht).
    const blocked = await tryCode(email, code);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toEqual({ message: 'Code ungültig oder abgelaufen' });
    expect(await attemptsSum(email)).toBe(5);

    // Fenster = MAGIC_TTL_MS: Sind die belasteten Tokens abgelaufen, zählen sie nicht mehr.
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    const past = new Date(Date.now() - 16 * 60_000);
    await db.prisma.magicToken.updateMany({ where: { userId: user.id }, data: { expiresAt: past, createdAt: past } });
    await requestLink(email);
    expect((await tryCode(email, captured.at(-1)!.code!)).statusCode).toBe(200);
  });

  it('parallele Fehlversuche überschreiten das Limit nicht', async () => {
    const email = 'a6-race@example.com';
    await requestLink(email);
    const code = captured.at(-1)!.code!;
    const results = await Promise.all(Array.from({ length: 10 }, () => tryCode(email, '000000')));
    for (const r of results) expect(r.statusCode).toBe(400);
    expect(await attemptsSum(email)).toBeLessThanOrEqual(5);
    expect((await tryCode(email, code)).statusCode).toBe(400);
  });

  it('parallele Fehlversuche nach frischem Link zählen die älteren Tokens mit', async () => {
    // Race über verschiedene Tokens desselben Users: Summe darf nicht VOR der Reservierung
    // gelesen werden, sonst ließen 10 parallele Requests auf dem neuen Token 5 weitere
    // Vergleiche zu (3 + 5 = 8 statt 5).
    const email = 'a6-race2@example.com';
    await requestLink(email);
    for (let i = 0; i < 3; i++) expect((await tryCode(email, '000000')).statusCode).toBe(400);
    await requestLink(email);
    const code = captured.at(-1)!.code!;
    const results = await Promise.all(Array.from({ length: 10 }, () => tryCode(email, '000000')));
    for (const r of results) expect(r.statusCode).toBe(400);
    expect(await attemptsSum(email)).toBe(5);
    expect((await tryCode(email, code)).statusCode).toBe(400);
  });

  it('mehr als 3 Links pro Adresse in 15 min: still 204, keine Mail', async () => {
    const email = 'n4-links@example.com';
    for (let i = 0; i < 3; i++) {
      const ok = await requestLink(email);
      expect(ok.statusCode).toBe(200); // Opt-in DEV_LOGIN_RESPONSE in diesem Setup
      expect(captured.at(-1)!.email).toBe(email);
    }
    const before = captured.length;
    const fourth = await requestLink(email);
    expect(fourth.statusCode).toBe(204);
    expect(fourth.body).toBe(''); // auch im Opt-in-Modus kein devLoginUrl (sonst Umgehung)
    expect(captured.length).toBe(before);
  });

  it('older magic link still verifies', async () => {
    const email = 'n4-older@example.com';
    await requestLink(email);
    const first = tokenFrom(captured.at(-1)!.url);
    await requestLink(email);
    const res = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token: first } });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe(email);
  });

  it('Magic-Link ändert die Locale erst nach erfolgreichem Login', async () => {
    const email = 'a11a-locale@example.com';
    await db.prisma.user.create({ data: { email, name: 'a11a', locale: 'de' } });
    await requestLink(email, 'en');
    let u = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.locale).toBe('de'); // bloßes Anfordern (von jedem auslösbar) ändert nichts
    const verify = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token: tokenFrom(captured.at(-1)!.url) } });
    expect(verify.statusCode).toBe(200);
    u = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.locale).toBe('en');
  });

  it('Code-Login übernimmt die Locale des eingelösten Tokens', async () => {
    const email = 'a11a-code@example.com';
    await db.prisma.user.create({ data: { email, name: 'a11a-code', locale: 'de' } });
    await requestLink(email, 'es');
    expect((await db.prisma.user.findUniqueOrThrow({ where: { email } })).locale).toBe('de');
    expect((await tryCode(email, captured.at(-1)!.code!)).statusCode).toBe(200);
    expect((await db.prisma.user.findUniqueOrThrow({ where: { email } })).locale).toBe('es');
  });
});

describe('A1 — Rate-Limit pro Client hinter dem Proxy (trustProxy)', () => {
  it('rate limit gilt pro X-Forwarded-For-Client hinter dem Proxy', async () => {
    const hit = (ip: string) => app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: `rl-${ip}@example.com` }, remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < 5; i++) expect((await hit('203.0.113.1')).statusCode).not.toBe(429);
    expect((await hit('203.0.113.1')).statusCode).toBe(429);
    expect((await hit('203.0.113.2')).statusCode).not.toBe(429);
  });

  it('X-Forwarded-For von einem Nicht-Proxy wird ignoriert', async () => {
    const hit = (xff: string) => app.inject({ method: 'POST', url: '/auth/magic-link',
      payload: { email: 'spoof@example.com' }, remoteAddress: '198.51.100.7', headers: { 'x-forwarded-for': xff } });
    for (let i = 0; i < 5; i++) await hit(`10.0.0.${i}`);
    expect((await hit('10.0.0.99')).statusCode).toBe(429);
  });
});
