import { z } from 'zod';

export const MailLocale = z.enum(['de', 'en', 'es', 'he', 'ar']);
export const MagicLinkBody = z.object({ email: z.string().email(), locale: MailLocale.optional() });
export const VerifyBody = z.object({ token: z.string().min(10) });
export const VerifyCodeBody = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Code ist 6-stellig'),
});

export const SESSION_COOKIE = 'session';
