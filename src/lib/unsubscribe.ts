import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-Signatur für den login-freien Abmelde-Link (Backlog 1).
 *  Bindet Projekt + E-Mail (lowercased) — der Link kann nur die eigene Adresse abmelden. */
export function unsubscribeSig(secret: string, projectId: string, email: string): string {
  return createHmac('sha256', secret).update(`${projectId}:${email.toLowerCase()}`).digest('base64url');
}

export function verifyUnsubscribeSig(secret: string, projectId: string, email: string, sig: string): boolean {
  const expected = Buffer.from(unsubscribeSig(secret, projectId, email));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Absolute Abmelde-URL für Mail-Footer — gleiche `${APP_URL}/api/…`-Konvention wie die ics-Links. */
export function unsubscribeUrl(appUrl: string, secret: string, projectId: string, email: string, locale: string): string {
  const q = new URLSearchParams({ email, sig: unsubscribeSig(secret, projectId, email), locale });
  return `${appUrl}/api/projects/${projectId}/updates/unsubscribe?${q.toString()}`;
}
