import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, rawHeaderCount, safeEqual } from './tokens.js';

describe('tokens', () => {
  it('generates a long random url-safe token', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(generateToken()).not.toBe(t);
  });

  it('hashes deterministically and differently from input', () => {
    const t = generateToken();
    const h = hashToken(t);
    expect(h).toBe(hashToken(t));
    expect(h).not.toBe(t);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('safeEqual', () => {
  it('vergleicht Strings timing-sicher, auch bei ungleicher Länge ohne Throw', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'b')).toBe(false);
    expect(safeEqual('a', 'aa')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });

  it('rawHeaderCount zählt Header-Vorkommen in rawHeaders (Name case-insensitiv)', () => {
    const raw = ['Authorization', 'Bearer a', 'host', 'x', 'authorization', 'Bearer b'];
    expect(rawHeaderCount(raw, 'authorization')).toBe(2);
    expect(rawHeaderCount(raw, 'host')).toBe(1);
    expect(rawHeaderCount(raw, 'cookie')).toBe(0);
    // Werte zählen nicht als Namen
    expect(rawHeaderCount(['x-a', 'authorization'], 'authorization')).toBe(0);
  });
});
