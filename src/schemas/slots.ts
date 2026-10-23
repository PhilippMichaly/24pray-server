import { z } from 'zod';
import { MailLocale } from './auth.js';

export const NotificationChannel = z.enum(['EMAIL', 'TELEGRAM']);

export const BookSlotBody = z.object({
  startTime: z.string().datetime(),
  guestName: z.string().trim()
    .min(1, 'Name darf nicht leer sein')
    .max(80, 'Name darf höchstens 80 Zeichen haben')
    .optional(),
  guestEmail: z.string().email().optional(),
  notifyChannel: NotificationChannel.default('EMAIL'),
  locale: MailLocale.default('de'),
  // Optionaler Beter-Standort (W3.5): nur Koordinaten, freiwillig
  locationLat: z.number().min(-90).max(90).optional(),
  locationLon: z.number().min(-180).max(180).optional(),
  // Einladungstoken für PRIVATE-Wachen (alternativ als Query ?invite=).
  invite: z.string().optional(),
});
