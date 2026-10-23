import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 6-stelliger Login-Code (kryptographisch zufällig, führende Nullen möglich). */
export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Timing-sicherer Secret-Vergleich: beide Seiten werden gehasht (gleiche Länge), dann
 * `timingSafeEqual`. Leere Strings sind hier gleich — fehlende Secrets muss der Aufrufer
 * vorher abfangen.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Einzelwert eines Request-Headers; doppelt gesetzte Header (Array) gelten als fehlend. */
export function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Wie oft ein Header im Original-Request stand. Node reduziert manche Header (u. a.
 * Authorization) in `req.headers` stillschweigend auf das erste Vorkommen; Duplikate
 * sieht man nur in `rawHeaders` (abwechselnd Name, Wert).
 */
export function rawHeaderCount(rawHeaders: string[], name: string): number {
  const wanted = name.toLowerCase();
  let count = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === wanted) count++;
  }
  return count;
}
