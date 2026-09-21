import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { events } from '../utils/events.js';
import { logger } from '../utils/logger.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export async function writeLog(
  level: LogLevel,
  source: string,
  message: string,
  context: Record<string, unknown> = {},
  userId: string | null = null,
): Promise<void> {
  logger[level]({ source, ...context }, message);

  events.publish({ type: 'log', level, source, message });

  if (!config.LOG_TO_DB) return;

  try {
    await query(
      'INSERT INTO logs (level, source, message, context, user_id) VALUES ($1, $2, $3, $4, $5)',
      [level, source.slice(0, 120), message.slice(0, 4000), JSON.stringify(context), userId],
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Log konnte nicht gespeichert werden');
  }
}

export async function purgeOldLogs(): Promise<number> {
  const result = await query(
    `DELETE FROM logs WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(config.LOG_RETENTION_DAYS)],
  );
  return result.rowCount ?? 0;
}
