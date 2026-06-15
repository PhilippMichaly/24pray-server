import { z } from 'zod';

export const NotificationChannel = z.enum(['EMAIL', 'TELEGRAM']);

export const BookSlotBody = z.object({
  startTime: z.string().datetime(),
  guestName: z.string().optional(),
  guestEmail: z.string().email().optional(),
  notifyChannel: NotificationChannel.default('EMAIL'),
});
