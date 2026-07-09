import { z } from 'zod';
import { MailLocale } from './auth.js';

export const NotificationChannel = z.enum(['EMAIL', 'TELEGRAM']);

export const BookSlotBody = z.object({
  startTime: z.string().datetime(),
  guestName: z.string().optional(),
  guestEmail: z.string().email().optional(),
  notifyChannel: NotificationChannel.default('EMAIL'),
  locale: MailLocale.default('de'),
  // Optionaler Beter-Standort (W3.5): nur Koordinaten, freiwillig
  locationLat: z.number().min(-90).max(90).optional(),
  locationLon: z.number().min(-180).max(180).optional(),
});
