import { z } from 'zod';

/** Gruppen-Link: nur die echte Dienst-Domain, nur https (Anti-Phishing hinter Marken-Buttons). */
const GroupLink = (prefix: string, re: RegExp) =>
  z.string().regex(re, `Link muss mit ${prefix} beginnen`).nullable().optional();

export const ProjectStatus = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
export const ProjectVisibility = z.enum(['PUBLIC', 'PRIVATE']);

export const CreateProjectBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  timezone: z.string().min(1).default('Europe/Berlin'),
  slotDurationMinutes: z.number().int().positive().max(1440).default(60),
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
  title: z.string().min(1).optional(),
  locationName: z.string().min(1).max(120).nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLon: z.number().min(-180).max(180).nullable().optional(),
  description: z.string().nullable().optional(),
  status: ProjectStatus.optional(),
  visibility: ProjectVisibility.optional(),
  maskNames: z.boolean().optional(),
  notifyOnBooking: z.boolean().optional(),
  linkWhatsapp: GroupLink('https://chat.whatsapp.com/', /^https:\/\/chat\.whatsapp\.com\/[\w-]+$/),
  linkTelegram: GroupLink('https://t.me/', /^https:\/\/t\.me\/[\w+\-/]+$/),
  linkSignal: GroupLink('https://signal.group/', /^https:\/\/signal\.group\/#?[\w#%+\-/]+$/),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  timezone: z.string().min(1).optional(),
});
