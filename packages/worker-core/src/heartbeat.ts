import type { Redis } from 'ioredis';
import { keys } from './queue.js';
import type { QueueName, WorkerHeartbeat } from './types.js';

/** Nach dieser Zeit ohne Lebenszeichen gilt ein Worker als offline. */
export const HEARTBEAT_TTL_SEC = 30;
export const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Registriert einen Worker in Redis, damit das Health-Dashboard ihn sieht --
 * auch wenn der Worker auf einem anderen Rechner laeuft (GPU-PC im Netzwerk).
 */
export class WorkerRegistry {
  private timer: NodeJS.Timeout | null = null;
  private state: WorkerHeartbeat;

  constructor(
    private readonly redis: Redis,
    init: {
      id: string;
      name: string;
      queue: QueueName | null;
      version: string;
      host: string;
      concurrency: number;
    },
  ) {
    this.state = {
      ...init,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      status: 'idle',
      currentJobId: null,
      capabilities: {},
      reason: null,
    };
  }

  setCapabilities(capabilities: Record<string, unknown>): void {
    this.state.capabilities = capabilities;
  }

  setStatus(status: WorkerHeartbeat['status'], reason: string | null = null): void {
    this.state.status = status;
    this.state.reason = reason;
  }

  setCurrentJob(jobId: string | null): void {
    this.state.currentJobId = jobId;
    this.state.status = jobId ? 'busy' : this.state.status === 'degraded' ? 'degraded' : 'idle';
  }

  snapshot(): WorkerHeartbeat {
    return { ...this.state, lastSeen: Date.now() };
  }

  async publish(): Promise<void> {
    this.state.lastSeen = Date.now();
    const pipeline = this.redis.multi();
    pipeline.set(keys.worker(this.state.id), JSON.stringify(this.state), 'EX', HEARTBEAT_TTL_SEC);
    pipeline.sadd(keys.workerSet(), this.state.id);
    await pipeline.exec();
  }

  start(): void {
    if (this.timer) return;
    void this.publish();
    this.timer = setInterval(() => {
      this.publish().catch(() => {
        /* Redis kurzzeitig weg -- naechster Tick versucht es erneut. */
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Sauber abmelden, damit das Dashboard sofort "offline" zeigt.
    await this.redis.del(keys.worker(this.state.id)).catch(() => undefined);
    await this.redis.srem(keys.workerSet(), this.state.id).catch(() => undefined);
  }
}

/** Liest alle aktuell lebenden Worker (vom Backend fuer das Dashboard genutzt). */
export async function readWorkers(redis: Redis): Promise<WorkerHeartbeat[]> {
  const ids = await redis.smembers(keys.workerSet());
  if (ids.length === 0) return [];
  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(keys.worker(id));
  const results = (await pipeline.exec()) ?? [];

  const alive: WorkerHeartbeat[] = [];
  const stale: string[] = [];
  results.forEach(([, value], index) => {
    const id = ids[index]!;
    if (typeof value !== 'string') {
      stale.push(id);
      return;
    }
    try {
      alive.push(JSON.parse(value) as WorkerHeartbeat);
    } catch {
      stale.push(id);
    }
  });

  if (stale.length > 0) await redis.srem(keys.workerSet(), ...stale).catch(() => undefined);
  return alive;
}
