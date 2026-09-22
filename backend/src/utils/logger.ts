import { pino, stdTimeFunctions } from 'pino';

export const logger = pino({
  enabled: process.env.LOG_SILENT !== 'true',
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'backend' },
  timestamp: stdTimeFunctions.isoTime,
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  redact: {
    // Niemals Zugangsdaten in die Logs schreiben.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'password',
      'accessToken',
      'refreshToken',
      '*.access_token',
      '*.refresh_token',
      '*.client_secret',
    ],
    censor: '[entfernt]',
  },
});

export type AppLogger = typeof logger;
