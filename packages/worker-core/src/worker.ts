import { Redis } from 'ioredis';
import { BackendApi } from './api-client.js';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { startHealthServer, type HealthState } from './health.js';
import { WorkerRegistry } from './heartbeat.js';
import { createLogger, type Logger } from './logger.js';
import { JobQueue } from './queue.js';
import { Storage } from './storage.js';
import {
  PermanentJobError,
  WaitingForGpuError,
  type JobRecord,
  type JobResult,
  type QueueName,
} from './types.js';

const POLL_INTERVAL_MS = 1000;
const MAINTENANCE_INTERVAL_MS = 15_000;
const LOCK_REFRESH_RATIO = 0.4;

export interface JobContext<TData> {
  job: JobRecord<TData>;
  data: TData;
  logger: Logger;
  api: BackendApi;
  storage: Storage;
  config: WorkerConfig;
  /** Wird ausgeloest bei Timeout oder beim Herunterfahren des Containers. */
  signal: AbortSignal;
  reportProgress(progress: number, message?: string): Promise<void>;
}

export type JobHandler<TData> = (ctx: JobContext<TData>) => Promise<JobResult>;

export interface WorkerOptions<TData> {
  /** Anzeigename im Health-Dashboard, z.B. "ffmpeg-worker". */
  name: string;
  queue: QueueName;
  handler: JobHandler<TData>;
  defaultConcurrency?: number;
  /**
   * Einmalige Initialisierung. Der Rueckgabewert landet als "capabilities" im
   * Health-Dashboard (z.B. GPU-Name, ffmpeg-Version).
   */
  onStart?(ctx: { logger: Logger; api: BackendApi; config: WorkerConfig }): Promise<Record<string, unknown>>;
  /** Zusaetzliche Zustandspruefung fuer den Docker-Healthcheck. */
  healthProbe?(): HealthState;
}

export interface RunningWorker {
  stop(): Promise<void>;
}

/**
 * Startet die Worker-Laufzeit: Queue-Polling, Sperr-Heartbeats, Timeouts,
 * Retries, Crash-Recovery, Health-Endpoint und sauberes Herunterfahren.
 *
 * Jeder Worker-Container ruft genau diese Funktion mit seinem Handler auf.
 */
export async function runWorker<TData = Record<string, unknown>>(
  opts: WorkerOptions<TData>,
): Promise<RunningWorker> {
  const config = loadWorkerConfig({ name: opts.name, concurrency: opts.defaultConcurrency });
  const logger = createLogger({ name: config.workerName, workerId: config.workerId, level: config.logLevel });

  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
  redis.on('error', (err) => logger.error({ err: err.message }, 'Redis-Fehler'));

  const queue = new JobQueue(redis);
  const api = new BackendApi({
    baseUrl: config.backendUrl,
    apiKey: config.internalApiKey,
    workerId: config.workerId,
    logger,
  });
  const storage = new Storage(config.dataDir, config.storageMode, api);
  const registry = new WorkerRegistry(redis, {
    id: config.workerId,
    name: config.workerName,
    queue: opts.queue,
    version: config.version,
    host: config.host,
    concurrency: config.concurrency,
  });

  let capabilities: Record<string, unknown> = {};
  let startupError: string | null = null;
  if (opts.onStart) {
    try {
      capabilities = await opts.onStart({ logger, api, config });
      registry.setCapabilities(capabilities);
    } catch (err) {
      startupError = (err as Error).message;
      registry.setStatus('degraded', startupError);
      logger.error({ err: startupError }, 'Initialisierung fehlgeschlagen, Worker laeuft eingeschraenkt weiter');
    }
  }

  let shuttingDown = false;
  let active = 0;
  let processed = 0;
  let failed = 0;
  let lastPollOk = Date.now();

  const health = startHealthServer(config.healthPort, () => {
    const custom = opts.healthProbe?.();
    const redisOk = redis.status === 'ready' || redis.status === 'connecting';
    const base: HealthState = {
      ok: redisOk && (custom?.ok ?? true),
      detail: {
        worker: config.workerName,
        workerId: config.workerId,
        queue: opts.queue,
        redis: redis.status,
        active,
        processed,
        failed,
        startupError,
        capabilities,
        lastPollAgoMs: Date.now() - lastPollOk,
        ...(custom?.detail ?? {}),
      },
    };
    return base;
  });

  registry.start();
  logger.info(
    { queue: opts.queue, concurrency: config.concurrency, storageMode: config.storageMode },
    'Worker gestartet',
  );

  async function runJob(job: JobRecord<TData>): Promise<void> {
    active += 1;
    registry.setCurrentJob(job.id);
    const jobLogger = logger.child({ jobId: job.id, jobName: job.name, refId: job.refId });
    const controller = new AbortController();

    const refreshMs = Math.max(5000, config.lockTtlSec * 1000 * LOCK_REFRESH_RATIO);
    let currentProgress = 0;
    const lockTimer = setInterval(() => {
      queue.heartbeat(job.id, config.workerId, config.lockTtlSec, currentProgress).catch(() => undefined);
    }, refreshMs);

    const timeoutTimer = setTimeout(() => controller.abort(), config.jobTimeoutMs);

    const ctx: JobContext<TData> = {
      job,
      data: job.data,
      logger: jobLogger,
      api,
      storage,
      config,
      signal: controller.signal,
      async reportProgress(progress, message) {
        currentProgress = progress;
        await queue.heartbeat(job.id, config.workerId, config.lockTtlSec, progress).catch(() => undefined);
        if (job.refId) await api.reportProgress(job.refId, progress, message);
      },
    };

    let queueSettled = false;

    const report = async (what: string, action: () => Promise<void>): Promise<void> => {
      try {
        await action();
      } catch (err) {
        jobLogger.error(
          { err: (err as Error).message, report: what },
          'Ergebnis konnte nicht an das Backend gemeldet werden',
        );
      }
    };

    try {
      if (job.refId) {
        await report('started', () => api.reportStarted(job.refId!, { worker: config.workerName, attempt: job.attempts }));
      }
      jobLogger.info({ attempt: job.attempts, maxAttempts: job.maxAttempts }, 'Job gestartet');

      const result = await opts.handler(ctx);

      await queue.complete(opts.queue, job.id);
      queueSettled = true;
      if (job.refId) await report('completed', () => api.reportCompleted(job.refId!, result ?? {}));
      processed += 1;
      jobLogger.info('Job erfolgreich abgeschlossen');
    } catch (err) {
      const error = err as Error;

      if (queueSettled) {
        jobLogger.error(
          { err: error.message },
          'Fehler nach erfolgreichem Abschluss: der Job wird nicht erneut eingereiht',
        );
        return;
      }

      if (error instanceof WaitingForGpuError) {
        await queue.park(opts.queue, job.id, 'WAITING_FOR_GPU', error.message, error.retryInMs);
        queueSettled = true;
        if (job.refId) await report('status', () => api.reportStatus(job.refId!, 'WAITING_FOR_GPU', error.message));
        registry.setStatus('degraded', error.message);
        jobLogger.warn({ retryInMs: error.retryInMs }, 'Job wartet auf GPU');
        return;
      }

      const aborted = controller.signal.aborted;
      const message = aborted ? `Zeitueberschreitung nach ${config.jobTimeoutMs} ms` : error.message;
      const permanent = error instanceof PermanentJobError;
      const backoffMs = Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, job.attempts - 1));

      const outcome = await queue.fail(opts.queue, job.id, message, { backoffMs, permanent });
      queueSettled = true;
      const willRetry = outcome === 'RETRY';
      if (job.refId) await report('failed', () => api.reportFailed(job.refId!, message, willRetry));
      failed += 1;
      jobLogger.error({ err: message, willRetry, permanent }, 'Job fehlgeschlagen');
    } finally {
      clearInterval(lockTimer);
      clearTimeout(timeoutTimer);
      active -= 1;
      registry.setCurrentJob(null);
      if (startupError === null && registry.snapshot().status === 'degraded' && active === 0) {
        registry.setStatus('idle');
      }
    }
  }

  // --- Poll-Schleife --------------------------------------------------------
  const inFlight = new Set<Promise<void>>();

  async function pollOnce(): Promise<void> {
    while (!shuttingDown && inFlight.size < config.concurrency) {
      const job = (await queue.reserve(opts.queue, config.workerId, config.lockTtlSec)) as JobRecord<TData> | null;
      lastPollOk = Date.now();
      if (!job) return;
      const promise = runJob(job)
        .catch((err) => logger.error({ err: (err as Error).message, jobId: job.id }, 'Job-Ausfuehrung abgebrochen'))
        .finally(() => inFlight.delete(promise));
      inFlight.add(promise);
    }
  }

  const pollTimer = setInterval(() => {
    pollOnce().catch((err) => logger.error({ err: (err as Error).message }, 'Poll-Fehler'));
  }, POLL_INTERVAL_MS);

  // Jeder Worker haelt seine eigene Queue instand: faellige Delayed-Jobs
  // aktivieren und Jobs abgestuerzter Worker wiederherstellen.
  const maintenanceTimer = setInterval(() => {
    void (async () => {
      try {
        const promoted = await queue.promoteDelayed(opts.queue);
        const reaped = await queue.reapStalled(opts.queue);
        if (reaped.length > 0) {
          logger.warn({ jobIds: reaped }, 'Jobs abgestuerzter Worker wiederhergestellt');
          await api.log('warn', 'Haengengebliebene Jobs wiederhergestellt', {
            queue: opts.queue,
            jobIds: reaped,
          });
        }
        if (promoted > 0) logger.debug({ promoted }, 'Delayed-Jobs aktiviert');
      } catch (err) {
        logger.debug({ err: (err as Error).message }, 'Wartungslauf fehlgeschlagen');
      }
    })();
  }, MAINTENANCE_INTERVAL_MS);

  async function stop(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ inFlight: inFlight.size }, 'Worker faehrt herunter, warte auf laufende Jobs');
    clearInterval(pollTimer);
    clearInterval(maintenanceTimer);
    // Laufende Jobs zu Ende bringen, damit sie nicht als "stalled" gelten.
    await Promise.allSettled([...inFlight]);
    await registry.stop();
    health.close();
    await redis.quit().catch(() => redis.disconnect());
    logger.info('Worker gestoppt');
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void stop().then(() => process.exit(0));
    });
  }

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unbehandelte Promise-Ablehnung im Worker');
  });

  return { stop };
}
