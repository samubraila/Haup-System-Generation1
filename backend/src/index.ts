import { createApp } from './app.js';
import { config } from './config/index.js';
import { closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { seedAdminUser } from './db/seed.js';
import { redis } from './queue/index.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { ensureStorageLayout } from './services/storage.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info({ env: config.NODE_ENV, port: config.BACKEND_PORT }, 'AI Content Factory Backend startet');

  await ensureStorageLayout();
  await runMigrations();
  await seedAdminUser();

  const app = createApp();
  const server = app.listen(config.BACKEND_PORT, '0.0.0.0', () => {
    logger.info({ port: config.BACKEND_PORT }, 'API bereit');
  });

  server.headersTimeout = 120_000;
  server.requestTimeout = 0;

  startScheduler();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Backend faehrt herunter');

    stopScheduler();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await redis.quit().catch(() => redis.disconnect());
    await closePool().catch(() => undefined);

    logger.info('Backend gestoppt');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unbehandelte Promise-Ablehnung');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'Unbehandelte Ausnahme');
    void shutdown('uncaughtException');
  });
}

main().catch((err: Error) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Start fehlgeschlagen');
  process.exit(1);
});
