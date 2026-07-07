import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url(), // Magic-Link-Base UND immer CORS-erlaubte Origin (= Frontend-Host)
  // Zusätzliche CORS-Origins (Komma-Liste), entkoppelt von APP_URL (§6.5).
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  DATA_DIR: z.string().default('./data'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: boolish.default(false),
  SMTP_URL: z.string().optional().default(''),
  SMTP_FROM: z.string().default('24pray <no-reply@24pray.local>'),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, unknown> = process.env): Env {
  return EnvSchema.parse(source);
}

export const env = parseEnv();
