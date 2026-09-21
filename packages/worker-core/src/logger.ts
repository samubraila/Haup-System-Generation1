import { pino, stdTimeFunctions } from 'pino';

/**
 * Strukturierte JSON-Logs. Jeder Worker setzt seinen Namen als Basisfeld,
 * damit das Log-Panel im Frontend nach Container filtern kann.
 */
export function createLogger(opts: { name: string; workerId: string; level?: string }) {
  return pino({
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    base: {
      service: opts.name,
      workerId: opts.workerId,
    },
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
