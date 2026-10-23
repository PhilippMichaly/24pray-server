import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  // Bind-Adresse. Default Loopback: in Prod steht nginx davor, die API darf nicht direkt
  // von außen erreichbar sein (N9). Container setzen HOST=0.0.0.0 (siehe Dockerfile).
  HOST: z.string().default('127.0.0.1'),
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
  // Opt-in für lokal/E2E: /auth/magic-link liefert den Login-Link als {devLoginUrl} in der
  // Response (Login ohne Postfach). NIE in Produktion — mit COOKIE_SECURE oder https-APP_URL
  // ist es ein Startfehler (A7).
  DEV_LOGIN_RESPONSE: boolish.default(false),
  SMTP_FROM: z.string().default('24pray <no-reply@24pray.local>'),
  // Signiert die Abmelde-Links der Update-Mails (Backlog 1). Mit SMTP_URL Pflicht (>= 32 Zeichen,
  // openssl rand -hex 32); der Dev-Default greift nur ohne SMTP (A8), siehe superRefine unten.
  UNSUBSCRIBE_SECRET: z.string().optional(),
  // Lese-Token für GET /stats/funnel (Backlog 8). Leer = Lese-Endpoint antwortet 404.
  FUNNEL_TOKEN: z.string().default(''),
  // Empfänger der Nutzer-Feedback-Mails (User-Zusatzpunkt). Leer = /feedback antwortet 404.
  FEEDBACK_TO: z.string().default(''),
  // Empfänger der Betreiber-Benachrichtigungen (neue Wache / neues Konto / Buchung).
  // Leer = Feature komplett aus, kein Versand. Wie FEEDBACK_TO: Adresse gehört nur nach
  // /etc/24pray-api.env, nie ins öffentliche Repo.
  ADMIN_NOTIFY_TO: z.string().default(''),
  // Web-Push VAPID (Backlog 7). Alle drei leer = Push-Feature aus (Routen 404, Hooks no-op).
  // Erzeugen: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default(''), // z. B. mailto:no-reply@24pray.org
})
  .superRefine((e, ctx) => {
    if (e.SMTP_URL && (e.UNSUBSCRIBE_SECRET ?? '').length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['UNSUBSCRIBE_SECRET'],
        message: 'UNSUBSCRIBE_SECRET muss mit SMTP_URL gesetzt sein (mind. 32 Zeichen, openssl rand -hex 32)',
      });
    }
    if (e.DEV_LOGIN_RESPONSE && (e.COOKIE_SECURE || e.APP_URL.startsWith('https://'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_LOGIN_RESPONSE'],
        message: 'DEV_LOGIN_RESPONSE ist nur lokal erlaubt (nicht mit COOKIE_SECURE oder https-APP_URL)',
      });
    }
  })
  .transform((e) => ({ ...e, UNSUBSCRIBE_SECRET: e.UNSUBSCRIBE_SECRET || 'dev-unsubscribe-secret' }));

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, unknown> = process.env): Env {
  return EnvSchema.parse(source);
}

export const env = parseEnv();
