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
});
