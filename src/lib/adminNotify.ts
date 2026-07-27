import type { Mailer, AdminNotice } from './mailer.js';
import type { Env } from '../env.js';

export type { AdminNotice };

/** Betreiber-Benachrichtigung „jemand hat etwas angelegt".
 *
 *  Bewusst SYNCHRON und ohne Rückgabewert: der Aufrufer soll nicht `await`en können. Eine
 *  Info-Mail an den Betreiber darf niemals die eigentliche Nutzer-Aktion (Wache anlegen,
 *  einloggen, Stunde buchen) verzögern oder scheitern lassen — gleiches Muster wie die
 *  bestehenden `.catch(console.error)`-Aufrufe in slots.ts/projects.ts, nur an einer Stelle.
 *
 *  Fail-closed wie FEEDBACK_TO: ohne ADMIN_NOTIFY_TO passiert gar nichts. */
export function notifyAdmin(
  deps: { mailer?: Mailer; env?: Env },
  notice: AdminNotice,
): void {
  const to = deps.env?.ADMIN_NOTIFY_TO;
  if (!to || !deps.mailer?.sendAdminNotice) return;
  deps.mailer
    .sendAdminNotice(to, notice)
    .catch((err) => console.error(`[mail] admin notice (${notice.kind}) failed:`, err));
}
