import { z } from 'zod';
import { emailSchema } from '../utils/validation.js';

/**
 * Konfiguration des Hauptsystems.
 *
 * Alles kommt aus Umgebungsvariablen -- es gibt bewusst keine Datei mit
 * Zugangsdaten im Repository. Fehlt ein Pflichtwert oder ist er unsicher,
 * startet das Backend nicht, statt mit einer unsicheren Voreinstellung zu laufen.
 */

const booleanish = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  TZ: z.string().default('Europe/Berlin'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET muss mindestens 32 Zeichen lang sein'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY muss genau 64 Hex-Zeichen (32 Byte) lang sein'),
  INTERNAL_API_KEY: z.string().min(16, 'INTERNAL_API_KEY muss mindestens 16 Zeichen lang sein'),

  COOKIE_SECURE: booleanish.default('false'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  ADMIN_EMAIL: emailSchema.default('admin@localhost'),
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD muss mindestens 12 Zeichen lang sein'),
  ADMIN_NAME: z.string().default('Administrator'),

  DATA_DIR: z.string().default('/data'),
  BACKUP_DIR: z.string().default('/backups'),
  BACKUP_INCLUDE_MEDIA: booleanish.default('false'),
  BACKUP_RETENTION: z.coerce.number().int().positive().default(7),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(512),
  ALLOWED_UPLOAD_MIME: z
    .string()
    .default('image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,video/mp4,text/plain,application/x-subrip'),

  VIDEO_GENERATOR_PROVIDER: z.enum(['ltx', 'wan', 'comfyui', 'placeholder']).default('placeholder'),
  GPU_MODE: z.enum(['auto', 'force', 'off']).default('auto'),
  REQUIRE_APPROVAL_DEFAULT: booleanish.default('true'),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  ANALYTICS_SYNC_ENABLED: booleanish.default('true'),
  ANALYTICS_SYNC_INTERVAL_MIN: z.coerce.number().int().positive().default(360),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  LOG_TO_DB: booleanish.default('true'),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // --- Social-Media-Zugangsdaten (optional; leer = "Not configured" im UI) ---
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  YOUTUBE_REDIRECT_URI: z.string().default('http://localhost:4000/api/social/youtube/callback'),
  TIKTOK_CLIENT_KEY: z.string().default(''),
  TIKTOK_CLIENT_SECRET: z.string().default(''),
  TIKTOK_REDIRECT_URI: z.string().default('http://localhost:4000/api/social/tiktok/callback'),
  INSTAGRAM_APP_ID: z.string().default(''),
  INSTAGRAM_APP_SECRET: z.string().default(''),
  INSTAGRAM_REDIRECT_URI: z.string().default('http://localhost:4000/api/social/instagram/callback'),
  FACEBOOK_APP_ID: z.string().default(''),
  FACEBOOK_APP_SECRET: z.string().default(''),
  FACEBOOK_REDIRECT_URI: z.string().default('http://localhost:4000/api/social/facebook/callback'),
});

export type AppConfig = z.infer<typeof schema> & {
  corsOrigins: string[];
  allowedUploadMime: string[];
  isProduction: boolean;
};

function build(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Konfigurationsfehler in den Umgebungsvariablen:\n${issues}\n\nBitte .env pruefen.`);
  }

  const env = parsed.data;

  // Die Platzhalter aus .env.example duerfen niemals produktiv laufen.
  const placeholders: Array<[string, string]> = [
    ['JWT_SECRET', env.JWT_SECRET],
    ['ENCRYPTION_KEY', env.ENCRYPTION_KEY],
    ['INTERNAL_API_KEY', env.INTERNAL_API_KEY],
    ['ADMIN_PASSWORD', env.ADMIN_PASSWORD],
  ];
  const unchanged = placeholders.filter(([, value]) => value.startsWith('CHANGE_ME')).map(([key]) => key);
  if (unchanged.length > 0 && env.NODE_ENV === 'production') {
    throw new Error(
      `Diese Werte stehen noch auf dem Platzhalter aus .env.example: ${unchanged.join(', ')}.\n` +
        'Bitte mit "node scripts/generate-secrets.mjs" erzeugen lassen und in .env eintragen.',
    );
  }

  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    allowedUploadMime: env.ALLOWED_UPLOAD_MIME.split(',').map((m) => m.trim()).filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
  };
}

export const config: AppConfig = build();
