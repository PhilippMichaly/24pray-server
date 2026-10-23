import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, safeEqual } from './tokens.js';

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
});
