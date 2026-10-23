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
const DAY_MS = 86400_000;
/** N4: Nie eingelöste Konten (nur Magic-Link angefordert) werden nach so vielen Tagen gelöscht. */
export const INACTIVE_USER_DAYS = 7;
/** N10: Gast-E-Mails werden so viele Tage nach Ende der Kette geleert. */
export const GUEST_EMAIL_RETENTION_DAYS = 90;

/**
 * Aufräum-Job (Punkt 11): löscht abgelaufene Sessions sofort und abgelaufene
 * MagicTokens erst nach einer Kulanzstunde (spätes Klicken auf einen fast
 * abgelaufenen Link soll nicht durch den Job selbst kaputtgehen).
 *
 * Datenschutz (N4/N10), idempotent:
 * - User ohne activatedAt (nie eingeloggt — entstehen schon durch bloßes Anfordern eines
 *   Magic-Links für eine beliebige Adresse), älter als INACTIVE_USER_DAYS und in KEINER
 *   Relation: weder Projekte, Slots, Memberships, Daueranmeldungen, Gebetsanliegen,
 *   Erinnerungs-Einstellung, Push-Subscriptions, noch Sessions oder (noch gültige bzw. in der
 *   Kulanz liegende) MagicTokens. Die abgelaufenen Tokens/Sessions sind zu diesem Zeitpunkt
 *   bereits durch die beiden Schritte davor gelöscht — `none: {}` schließt damit genau die
 *   User aus, deren Link noch einlösbar ist, und verhindert jeden FK-RESTRICT-Fehler.
 *   Bestandskonten von vor Migration 20260727120000 haben per Backfill activatedAt = createdAt.
 * - guestEmail (nur die Adresse, guestName bleibt für die Statistik) von Slots, deren Kette
 *   seit mehr als GUEST_EMAIL_RETENTION_DAYS beendet ist.
 */
export async function cleanupExpired(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ sessions: number; magicTokens: number; inactiveUsers: number; guestEmails: number }> {
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const magicTokens = await prisma.magicToken.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - MAGIC_TOKEN_GRACE_MS) } },
  });
  const inactiveUsers = await prisma.user.deleteMany({
    where: {
      activatedAt: null,
      createdAt: { lt: new Date(now.getTime() - INACTIVE_USER_DAYS * DAY_MS) },
      magicTokens: { none: {} },
      sessions: { none: {} },
      projects: { none: {} },
      slots: { none: {} },
      memberships: { none: {} },
      recurring: { none: {} },
      requests: { none: {} },
      reminderPref: { is: null },
      pushSubs: { none: {} },
    },
  });
  const guestEmails = await prisma.prayerSlot.updateMany({
    where: {
      guestEmail: { not: null },
      project: { endDate: { lt: new Date(now.getTime() - GUEST_EMAIL_RETENTION_DAYS * DAY_MS) } },
    },
    data: { guestEmail: null },
  });
  return {
    sessions: sessions.count,
    magicTokens: magicTokens.count,
    inactiveUsers: inactiveUsers.count,
    guestEmails: guestEmails.count,
  };
}

/**
 * Der Aufräum-Job läuft nicht jede Minute, sondern stündlich (erster Tick sofort): User-
 * und Slot-Filter haben keinen passenden Index (activatedAt/createdAt, guestEmail,
 * PrayerProject.endDate, PrayerSlot.userId), jeder Lauf scannt also. Abgelaufene Sessions
 * und Tokens werden ohnehin beim Einlösen auf expiresAt geprüft — die Verzögerung ist
 * funktional folgenlos.
 */
const CLEANUP_EVERY_TICKS = 60;

/** Startet alle Jobs im Intervall (server.ts). Gibt eine stop()-Funktion zurück. */
export function startJobs(
  deps: { prisma: PrismaClient; mailer: Mailer; appUrl?: string; pushSender?: PushSender | null },
  intervalMs = 60_000,
): () => void {
  let running = false; // Overlap-Guard: ein langsamer Tick (SMTP!) darf sich nicht stapeln
  let tickNo = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await completeElapsedSlots(deps.prisma);
      await sendDueReminders(deps.prisma, deps.mailer, new Date(), deps.appUrl, deps.pushSender);
      if (tickNo++ % CLEANUP_EVERY_TICKS === 0) {
        const c = await cleanupExpired(deps.prisma);
        if (c.inactiveUsers || c.guestEmails) {
          console.info(`[jobs] cleanup: ${c.inactiveUsers} unbestätigte Konten gelöscht, ${c.guestEmails} Gast-Adressen geleert`);
        }
      }
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
