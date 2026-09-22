import { JobQueue, ALL_QUEUES, readWorkers, type QueueName, type WorkerHeartbeat } from '@acf/worker-core';
import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 500, 10_000),
});

redis.on('error', (err) => logger.error({ err: err.message }, 'Redis-Fehler'));
redis.on('ready', () => logger.info('Redis verbunden'));

export const jobQueue = new JobQueue(redis);

export async function listWorkers(): Promise<WorkerHeartbeat[]> {
  return readWorkers(redis);
}

export async function queueOverview() {
  return Promise.all(ALL_QUEUES.map((queue) => jobQueue.stats(queue)));
}

export async function maintainQueues(): Promise<{ promoted: number; reaped: string[]; deadLettered: string[] }> {
  let promoted = 0;
  const reaped: string[] = [];
  const deadLettered: string[] = [];

  for (const queue of ALL_QUEUES) {
    promoted += await jobQueue.promoteDelayed(queue);
    const recovered = await jobQueue.reapStalled(queue);
    reaped.push(...recovered);

    for (const queueJobId of recovered) {
      const job = await jobQueue.getJob(queueJobId);
      if (job?.status === 'FAILED') deadLettered.push(queueJobId);
    }
  }

  return { promoted, reaped, deadLettered };
}

export async function checkRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}

export { ALL_QUEUES };
export type { QueueName };
