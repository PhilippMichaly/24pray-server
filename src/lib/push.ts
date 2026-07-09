import webpush from 'web-push';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../env.js';

export interface PushPayload { title: string; body: string; url: string }
export interface PushSubscriptionRecord { endpoint: string; p256dh: string; auth: string }
export type PushSender = (sub: PushSubscriptionRecord, payload: PushPayload) => Promise<void>;

/** Echter web-push-Sender — null, wenn VAPID nicht konfiguriert (fail-closed). */
export function createPushSender(env: Env): PushSender | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const subject = env.VAPID_SUBJECT || 'mailto:no-reply@24pray.org';
  return async (sub, payload) => {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { vapidDetails: { subject, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } },
    );
  };
}

/** An alle Geräte der genannten User senden; abgelaufene Subscriptions (404/410) aufräumen.
 *  Fehler einzelner Endpunkte stoppen nie die übrigen. */
export async function pushToUsers(
  prisma: PrismaClient,
  sender: PushSender,
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  await Promise.all(subs.map(async (s) => {
    try {
      await sender({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      } else {
        console.error(`[push] send failed for ${s.endpoint}:`, err);
      }
    }
  }));
}
