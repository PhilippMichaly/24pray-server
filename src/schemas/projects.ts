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

/** Wirft einen 400er (Error mit statusCode, vom Error-Handler in app.ts durchgereicht). */
export function assertProjectSpan(start: Date, end: Date): void {
  let message: string | null = null;
  if (!(end.getTime() > start.getTime())) message = 'endDate muss nach startDate liegen';
  else if (end.getTime() - start.getTime() > MAX_PROJECT_DAYS * 86_400_000) {
    message = `Eine Gebetswache darf höchstens ${MAX_PROJECT_DAYS} Tage dauern`;
  }
  if (message) throw Object.assign(new Error(message), { statusCode: 400 });
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
