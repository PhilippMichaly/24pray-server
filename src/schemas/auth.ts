import { z } from 'zod';

export const MagicLinkBody = z.object({ email: z.string().email() });
export const VerifyBody = z.object({ token: z.string().min(10) });

export const SESSION_COOKIE = 'session';
