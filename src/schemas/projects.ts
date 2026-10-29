import { z } from 'zod';
import { MailLocale } from './auth.js';

/** Gruppen-Link: nur die echte Dienst-Domain, nur https (Anti-Phishing hinter Marken-Buttons). */
const GroupLink = (prefix: string, re: RegExp) =>
  z.string().regex(re, `Link muss mit ${prefix} beginnen`).nullable().optional();

export const MAX_PROJECT_DAYS = 366;

/** Zeitzone muss der Runtime (ICU) bekannt sein — sonst scheitern spätere Intl-Formatierungen. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Spannenprüfung als reine Funktion: Verstoß mit maschinenlesbarem Code, sonst null.
 *  Die Texte sind die bisherigen API-Meldungen, wortgleich (D-02). */
export function projectSpanViolation(
  start: Date,
  end: Date,
): { code: 'END_NOT_AFTER_START' | 'SPAN_TOO_LONG'; message: string } | null {
  if (!(end.getTime() > start.getTime())) {
    return { code: 'END_NOT_AFTER_START', message: 'endDate muss nach startDate liegen' };
  }
  if (end.getTime() - start.getTime() > MAX_PROJECT_DAYS * 86_400_000) {
    return { code: 'SPAN_TOO_LONG', message: `Eine Gebetswache darf höchstens ${MAX_PROJECT_DAYS} Tage dauern` };
  }
  return null;
}

/** Wirft einen 400er (Error mit statusCode, vom Error-Handler in app.ts durchgereicht).
 *  D-02: POST und PATCH ohne endDate — bewusst OHNE Code-Felder, Antwort bleibt byte-identisch. */
export function assertProjectSpan(start: Date, end: Date): void {
  const violation = projectSpanViolation(start, end);
  if (violation) throw Object.assign(new Error(violation.message), { statusCode: 400 });
}

/**
 * Prüfung beim Ändern des Endes (PATCH mit endDate, D-04/PD-05): zuerst die Spanne, dann die
 * Slot-Ausrichtung (Pitfall 5 — ein Ende vor dem Start soll „nicht nach Start“ melden, nicht
 * „nicht ausgerichtet“). Verstöße tragen `responseExtra.code`; bei fehlender Ausrichtung zusätzlich
 * `exampleEnd` = nächstes gültiges Ende. Reine ms-Arithmetik, damit keine Zeitumstellung stört.
 */
export function assertEndDateChange(start: Date, end: Date, slotDurationMinutes: number): void {
  const violation = projectSpanViolation(start, end);
  if (violation) {
    throw Object.assign(new Error(violation.message), {
      statusCode: 400,
      responseExtra: { code: violation.code },
    });
  }
  const slotMs = slotDurationMinutes * 60_000;
  const span = end.getTime() - start.getTime();
  if (span % slotMs !== 0) {
    throw Object.assign(new Error('Das Ende muss eine ganze Zahl von Zeitfenstern nach dem Start liegen'), {
      statusCode: 400,
      responseExtra: {
        code: 'END_NOT_ALIGNED',
        exampleEnd: new Date(start.getTime() + Math.ceil(span / slotMs) * slotMs).toISOString(),
      },
    });
  }
}

const Timezone = z.string().min(1).refine(isValidTimezone, 'Ungültige Zeitzone');

export const ProjectStatus = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
export const ProjectVisibility = z.enum(['PUBLIC', 'PRIVATE']);

const Title = z.string().trim()
  .min(1, 'Titel darf nicht leer sein')
  .max(120, 'Titel darf höchstens 120 Zeichen haben');
const Description = z.string().max(5000, 'Beschreibung darf höchstens 5000 Zeichen haben');

export const CreateProjectBody = z.object({
  title: Title,
  description: Description.optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  timezone: Timezone.default('Europe/Berlin'),
  language: MailLocale.default('de'),
  // Wählbare Aufteilung der Wache: Stunden (60) oder ganze Tage (1440) — kein Zwischenwert (24pray Tages-Wachen).
  slotDurationMinutes: z.union([z.literal(60), z.literal(1440)]).default(60),
  visibility: ProjectVisibility.default('PRIVATE'),
  maskNames: z.boolean().default(false),
  notifyOnBooking: z.boolean().default(true),
  linkWhatsapp: GroupLink('https://chat.whatsapp.com/', /^https:\/\/chat\.whatsapp\.com\/[\w-]+$/),
  linkTelegram: GroupLink('https://t.me/', /^https:\/\/t\.me\/[\w+\-/]+$/),
  linkSignal: GroupLink('https://signal.group/', /^https:\/\/signal\.group\/#?[\w#%+\-/]+$/),
  // Optionaler Standort (W3.4): alle drei zusammen oder gar nicht
  locationName: z.string().min(1).max(120).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLon: z.number().min(-180).max(180).optional(),
});

export const UpdateProjectBody = z.object({
  title: Title.optional(),
  locationName: z.string().min(1).max(120).nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLon: z.number().min(-180).max(180).nullable().optional(),
  description: Description.nullable().optional(),
  status: ProjectStatus.optional(),
  visibility: ProjectVisibility.optional(),
  maskNames: z.boolean().optional(),
  notifyOnBooking: z.boolean().optional(),
  linkWhatsapp: GroupLink('https://chat.whatsapp.com/', /^https:\/\/chat\.whatsapp\.com\/[\w-]+$/),
  linkTelegram: GroupLink('https://t.me/', /^https:\/\/t\.me\/[\w+\-/]+$/),
  linkSignal: GroupLink('https://signal.group/', /^https:\/\/signal\.group\/#?[\w#%+\-/]+$/),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  timezone: Timezone.optional(),
});

/** Wache verschieben (Ersteller-Lebenszyklus): neuer Projekt-Start, Delta wandert auf alles. */
export const ShiftProjectBody = z.object({
  newStartDate: z.string().datetime(),
});
