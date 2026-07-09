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
  STATS_CACHE_TTL_MS: z.coerce.number().int().min(0).default(30_000), // /stats/public-Cache (Lasttest-Fix); 0 = aus
  COOKIE_SECURE: boolish.default(false),
  SMTP_URL: z.string().optional().default(''),
  SMTP_FROM: z.string().default('24pray <no-reply@24pray.local>'),
  // Signiert die Abmelde-Links der Update-Mails (Backlog 1). In Produktion setzen!
  UNSUBSCRIBE_SECRET: z.string().default('dev-unsubscribe-secret'),
  // Lese-Token für GET /stats/funnel (Backlog 8). Leer = Lese-Endpoint antwortet 404.
  FUNNEL_TOKEN: z.string().default(''),
  // Empfänger der Nutzer-Feedback-Mails (User-Zusatzpunkt). Leer = /feedback antwortet 404.
  FEEDBACK_TO: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, unknown> = process.env): Env {
  return EnvSchema.parse(source);
}

export const env = parseEnv();
