import type { PrismaClient } from '@prisma/client';
import type { Mailer } from './mailer.js';
import { googleCalendarUrl } from './calendar.js';
import { pushToUsers, type PushSender } from './push.js';

/** W3.2: Abgelaufene BOOKED-Slots → COMPLETED (Basis für die Statistik). */
export async function completeElapsedSlots(prisma: PrismaClient, now = new Date()): Promise<number> {
  const res = await prisma.prayerSlot.updateMany({
    where: { status: 'BOOKED', endTime: { lt: now } },
    data: { status: 'COMPLETED' },
  });
  return res.count;
}

/**
 * W3.2: Erinnerungen verschicken. Ein Slot wird erinnert, wenn er BOOKED ist,
 * innerhalb des Vorlauf-Fensters startet (User-Preference, default 60 min) und
 * noch nicht erinnert wurde. E-Mail zuerst; Telegram existiert nur im Modell.
 */
export async function sendDueReminders(
  prisma: PrismaClient,
  mailer: Mailer,
  now = new Date(),
  appUrl?: string, // für Kalender-Links in der Mail
  pushSender?: PushSender | null, // Zweitkanal Web-Push (Backlog 7), optional/nullable
): Promise<number> {
  const maxLead = 24 * 60; // Obergrenze, damit der Scan begrenzt bleibt
  const candidates = await prisma.prayerSlot.findMany({
    where: {
      status: 'BOOKED',
      remindedAt: null,
      startTime: { gt: now, lte: new Date(now.getTime() + maxLead * 60_000) },
    },
    include: { user: { include: { reminderPref: true } }, project: true },
  });

  let sent = 0;
  for (const slot of candidates) {
    const minutesBefore = slot.user?.reminderPref?.minutesBefore ?? 60;
    const dueFrom = new Date(slot.startTime.getTime() - minutesBefore * 60_000);
    if (now < dueFrom) continue; // noch nicht fällig

    const email = slot.user?.email ?? slot.guestEmail;
    if (!email) continue;
    const name = slot.user?.name ?? slot.guestName ?? '';

    try {
      const isAllDay = slot.project.slotDurationMinutes === 1440;
      const ev = {
        uid: slot.id,
        title: `Gebetsstunde — ${slot.project.title}`,
        startTime: slot.startTime,
        endTime: slot.endTime,
        url: appUrl ? `${appUrl}/projects/${slot.projectId}` : undefined,
        allDay: isAllDay,
        timezone: slot.project.timezone,
      };
      await mailer.sendReminder?.(email, {
        name,
        projectTitle: slot.project.title,
        startTime: slot.startTime.toISOString(),
        timezone: slot.project.timezone,
        isAllDay,
        ...(appUrl ? { icsUrl: `${appUrl}/api/slots/${slot.id}/ics`, googleUrl: googleCalendarUrl(ev) } : {}),
      });
      await prisma.prayerSlot.update({ where: { id: slot.id }, data: { remindedAt: now } });
      sent++;

      // Zweitkanal Web-Push (Backlog 7): nur User-Slots (Gäste haben keine Subscription).
      if (pushSender && slot.userId) {
        pushToUsers(prisma, pushSender, [slot.userId], {
          title: `24pray — ${slot.project.title}`,
          body: 'Deine Gebetsstunde beginnt bald.',
          url: appUrl ? `${appUrl}/projects/${slot.projectId}` : `/projects/${slot.projectId}`,
        }).catch((err) => console.error('[push] reminder push failed:', err));
      }
    } catch (err) {
      // Nicht markieren → nächster Tick versucht es erneut.
      console.error(`[jobs] reminder failed for slot ${slot.id}:`, err);
    }
  }
  return sent;
}

const MAGIC_TOKEN_GRACE_MS = 60 * 60_000; // 1h Kulanzfenster nach Ablauf (Punkt 11)

/**
 * Aufräum-Job (Punkt 11): löscht abgelaufene Sessions sofort und abgelaufene
 * MagicTokens erst nach einer Kulanzstunde (spätes Klicken auf einen fast
 * abgelaufenen Link soll nicht durch den Job selbst kaputtgehen).
 */
export async function cleanupExpired(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ sessions: number; magicTokens: number }> {
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const magicTokens = await prisma.magicToken.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - MAGIC_TOKEN_GRACE_MS) } },
  });
  return { sessions: sessions.count, magicTokens: magicTokens.count };
}

/** Startet alle Jobs im Intervall (server.ts). Gibt eine stop()-Funktion zurück. */
export function startJobs(
  deps: { prisma: PrismaClient; mailer: Mailer; appUrl?: string; pushSender?: PushSender | null },
  intervalMs = 60_000,
): () => void {
  let running = false; // Overlap-Guard: ein langsamer Tick (SMTP!) darf sich nicht stapeln
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await completeElapsedSlots(deps.prisma);
      await sendDueReminders(deps.prisma, deps.mailer, new Date(), deps.appUrl, deps.pushSender);
      await cleanupExpired(deps.prisma);
    } catch (err) {
      console.error('[jobs] tick failed:', err);
    } finally {
      running = false;
    }
  };
  void tick(); // sofort beim Start (Aufholen nach Downtime)
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
