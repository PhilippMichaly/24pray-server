import { describe, it, expect } from 'vitest';
import { unsubscribeSig, verifyUnsubscribeSig, unsubscribeUrl } from './unsubscribe.js';

describe('unsubscribe token (Backlog 1)', () => {
  const S = 'test-secret';

  it('Signatur ist stabil und case-insensitiv zur E-Mail', () => {
    const a = unsubscribeSig(S, 'p1', 'Maria@Example.com');
    const b = unsubscribeSig(S, 'p1', 'maria@example.com');
    expect(a).toBe(b);
    expect(verifyUnsubscribeSig(S, 'p1', 'maria@example.com', a)).toBe(true);
  });

  it('manipulierte Signatur / falsches Projekt / falscher Secret werden abgelehnt', () => {
    const sig = unsubscribeSig(S, 'p1', 'x@y.z');
    expect(verifyUnsubscribeSig(S, 'p2', 'x@y.z', sig)).toBe(false);
    expect(verifyUnsubscribeSig(S, 'p1', 'x@y.z', sig.slice(0, -2) + 'aa')).toBe(false);
    expect(verifyUnsubscribeSig('anders', 'p1', 'x@y.z', sig)).toBe(false);
    expect(verifyUnsubscribeSig(S, 'p1', 'x@y.z', 'kaputt')).toBe(false);
  });

  it('unsubscribeUrl baut den API-Pfad mit encodeter E-Mail', () => {
    const url = unsubscribeUrl('https://24pray.org', S, 'p1', 'a+b@example.com', 'en');
    expect(url).toContain('https://24pray.org/api/projects/p1/updates/unsubscribe?');
    expect(url).toContain('a%2Bb%40example.com');
    expect(url).toContain('locale=en');
  });
});
