import { describe, it, expect } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('applies defaults and requires APP_URL', () => {
    const env = parseEnv({ APP_URL: 'http://localhost:3000' });
    expect(env.PORT).toBe(3001);
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.SESSION_TTL_DAYS).toBe(30);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('throws when APP_URL is missing', () => {
    expect(() => parseEnv({})).toThrow();
  });

  it('coerces numeric and boolean strings', () => {
    const env = parseEnv({ APP_URL: 'http://x', PORT: '4000', COOKIE_SECURE: 'true' });
    expect(env.PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  describe('Härtung (A7/A8/N9)', () => {
    const base = { APP_URL: 'http://localhost:3000' };

    it('verlangt UNSUBSCRIBE_SECRET >= 32 Zeichen, sobald SMTP_URL gesetzt ist', () => {
      expect(() => parseEnv({ ...base, SMTP_URL: 'smtp://x' })).toThrow();
      expect(() => parseEnv({ ...base, SMTP_URL: 'smtp://x', UNSUBSCRIBE_SECRET: '' })).toThrow();
      expect(() => parseEnv({ ...base, SMTP_URL: 'smtp://x', UNSUBSCRIBE_SECRET: 'a'.repeat(32) })).not.toThrow();
    });

    it('ohne SMTP bleibt der Dev-Default erlaubt', () => {
      expect(parseEnv(base).UNSUBSCRIBE_SECRET).toBe('dev-unsubscribe-secret');
    });

    it('DEV_LOGIN_RESPONSE mit COOKIE_SECURE oder https-APP_URL ist ein Startfehler', () => {
      expect(() => parseEnv({ ...base, DEV_LOGIN_RESPONSE: 'true', COOKIE_SECURE: 'true' })).toThrow();
      expect(() => parseEnv({ APP_URL: 'https://24pray.org', DEV_LOGIN_RESPONSE: 'true' })).toThrow();
    });

    it('DEV_LOGIN_RESPONSE ist per Default aus und lokal per Opt-in erlaubt', () => {
      expect(parseEnv(base).DEV_LOGIN_RESPONSE).toBe(false);
      expect(parseEnv({ ...base, DEV_LOGIN_RESPONSE: 'true' }).DEV_LOGIN_RESPONSE).toBe(true);
    });

    it('HOST ist per Default Loopback', () => {
      expect(parseEnv(base).HOST).toBe('127.0.0.1');
    });
  });
});
