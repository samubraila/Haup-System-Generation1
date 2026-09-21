import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { JobRecord, JobStatus, QueueName } from './types.js';

export const KEY_PREFIX = 'acf';

export const keys = {
  waiting: (q: string) => `${KEY_PREFIX}:q:${q}:waiting`,
  active: (q: string) => `${KEY_PREFIX}:q:${q}:active`,
  delayed: (q: string) => `${KEY_PREFIX}:q:${q}:delayed`,
  failed: (q: string) => `${KEY_PREFIX}:q:${q}:failed`,
  job: (id: string) => `${KEY_PREFIX}:job:${id}`,
  lock: (id: string) => `${KEY_PREFIX}:lock:${id}`,
  jobPrefix: () => `${KEY_PREFIX}:job:`,
  lockPrefix: () => `${KEY_PREFIX}:lock:`,
  workerSet: () => `${KEY_PREFIX}:workers`,
  worker: (id: string) => `${KEY_PREFIX}:worker:${id}`,
};

/** Aufbewahrung der Redis-Job-Hashes. Die Wahrheit liegt in PostgreSQL. */
const TTL_COMPLETED_SEC = 24 * 60 * 60;
const TTL_FAILED_SEC = 7 * 24 * 60 * 60;

/** Prioritaet 0 (niedrig) .. 9 (hoch); niedrigerer Score wird zuerst gezogen. */
function scoreFor(priority: number, createdAt: number): number {
  const clamped = Math.min(9, Math.max(0, Math.trunc(priority)));
  return (9 - clamped) * 1e13 + createdAt;
}

// ---------------------------------------------------------------------------
// Lua-Skripte: jede Zustandsaenderung ist atomar, damit ein Container-Neustart
// mitten in einer Operation keinen Job verlieren kann.
// ---------------------------------------------------------------------------

/** Holt den naechsten Job, sperrt ihn und legt ihn in die Active-Liste. */
const LUA_RESERVE = `
local popped = redis.call('ZPOPMIN', KEYS[1], 1)
if #popped == 0 then return nil end
local jobId = popped[1]
local jobKey = ARGV[4] .. jobId
if redis.call('EXISTS', jobKey) == 0 then
  -- Verwaister Eintrag (Hash bereits abgelaufen): stillschweigend verwerfen.
  return nil
end
redis.call('LPUSH', KEYS[2], jobId)
redis.call('SET', ARGV[5] .. jobId, ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('HSET', jobKey,
  'status', 'RUNNING',
  'lockedBy', ARGV[1],
  'startedAt', ARGV[3],
  'updatedAt', ARGV[3],
  'error', '')
redis.call('HINCRBY', jobKey, 'attempts', 1)
redis.call('PERSIST', jobKey)
return redis.call('HGETALL', jobKey)
`;

/** Markiert einen Job als erfolgreich abgeschlossen. */
const LUA_COMPLETE = `
redis.call('LREM', KEYS[2], 1, ARGV[1])
redis.call('DEL', ARGV[4] .. ARGV[1])
local jobKey = ARGV[3] .. ARGV[1]
redis.call('HSET', jobKey, 'status', 'COMPLETED', 'progress', '100', 'updatedAt', ARGV[2], 'lockedBy', '')
redis.call('EXPIRE', jobKey, tonumber(ARGV[5]))
return 1
`;

/**
 * Meldet einen Fehlversuch. Solange noch Versuche offen sind, wandert der Job
 * mit Backoff zurueck in die Delayed-Menge, sonst in die Dead-Letter-Liste.
 */
const LUA_FAIL = `
local jobId = ARGV[1]
local now = tonumber(ARGV[2])
local jobKey = ARGV[3] .. jobId
redis.call('LREM', KEYS[2], 1, jobId)
redis.call('DEL', ARGV[4] .. jobId)
if redis.call('EXISTS', jobKey) == 0 then return 'GONE' end
local attempts = tonumber(redis.call('HGET', jobKey, 'attempts') or '0')
local maxAttempts = tonumber(redis.call('HGET', jobKey, 'maxAttempts') or '1')
local permanent = ARGV[7] == '1'
if permanent or attempts >= maxAttempts then
  redis.call('HSET', jobKey, 'status', 'FAILED', 'error', ARGV[5], 'updatedAt', ARGV[2], 'lockedBy', '')
  redis.call('LPUSH', KEYS[3], jobId)
  redis.call('LTRIM', KEYS[3], 0, 499)
  redis.call('EXPIRE', jobKey, tonumber(ARGV[8]))
  return 'FAILED'
end
redis.call('HSET', jobKey, 'status', 'PENDING', 'error', ARGV[5], 'updatedAt', ARGV[2], 'lockedBy', '')
redis.call('ZADD', KEYS[4], now + tonumber(ARGV[6]), jobId)
return 'RETRY'
`;

/**
 * Legt den Job zurueck in die Warteschleife, ohne einen Versuch zu verbrauchen.
 * Wird fuer WAITING_FOR_GPU genutzt: der Job geht nie verloren und gilt nicht
 * als Fehler, er wartet nur auf passende Hardware.
 */
const LUA_PARK = `
local jobId = ARGV[1]
local jobKey = ARGV[3] .. jobId
redis.call('LREM', KEYS[2], 1, jobId)
redis.call('DEL', ARGV[4] .. jobId)
if redis.call('EXISTS', jobKey) == 0 then return 'GONE' end
redis.call('HINCRBY', jobKey, 'attempts', -1)
redis.call('HSET', jobKey, 'status', ARGV[6], 'error', ARGV[5], 'updatedAt', ARGV[2], 'lockedBy', '')
redis.call('ZADD', KEYS[4], tonumber(ARGV[2]) + tonumber(ARGV[7]), jobId)
return 'PARKED'
`;

/** Verschiebt faellige Delayed-Jobs zurueck in die Waiting-Menge. */
const LUA_PROMOTE = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 200)
local moved = 0
for _, jobId in ipairs(due) do
  if redis.call('ZREM', KEYS[1], jobId) == 1 then
    local jobKey = ARGV[2] .. jobId
    if redis.call('EXISTS', jobKey) == 1 then
      local priority = tonumber(redis.call('HGET', jobKey, 'priority') or '0')
      local createdAt = tonumber(redis.call('HGET', jobKey, 'createdAt') or ARGV[1])
      local score = string.format('%.0f', (9 - priority) * 1e13 + createdAt)
      redis.call('ZADD', KEYS[2], score, jobId)
      redis.call('HSET', jobKey, 'status', 'PENDING', 'updatedAt', ARGV[1])
      moved = moved + 1
    end
  end
end
return moved
`;

/**
 * Sucht Jobs, deren Worker abgestuerzt ist (Lock abgelaufen) und stellt sie
 * wieder her. Ohne diesen Schritt wuerde ein "docker restart" Jobs verlieren.
 */
const LUA_REAP = `
local ids = redis.call('LRANGE', KEYS[2], 0, -1)
local requeued = {}
for _, jobId in ipairs(ids) do
  if redis.call('EXISTS', ARGV[3] .. jobId) == 0 then
    redis.call('LREM', KEYS[2], 1, jobId)
    local jobKey = ARGV[2] .. jobId
    if redis.call('EXISTS', jobKey) == 1 then
      local attempts = tonumber(redis.call('HGET', jobKey, 'attempts') or '0')
      local maxAttempts = tonumber(redis.call('HGET', jobKey, 'maxAttempts') or '1')
      if attempts >= maxAttempts then
        redis.call('HSET', jobKey, 'status', 'FAILED', 'error', 'Worker abgestuerzt, keine Versuche mehr uebrig', 'updatedAt', ARGV[1])
        redis.call('LPUSH', KEYS[3], jobId)
        redis.call('EXPIRE', jobKey, tonumber(ARGV[4]))
      else
        local priority = tonumber(redis.call('HGET', jobKey, 'priority') or '0')
        local createdAt = tonumber(redis.call('HGET', jobKey, 'createdAt') or ARGV[1])
        redis.call('HSET', jobKey, 'status', 'PENDING', 'error', 'Worker abgestuerzt, Job wiederhergestellt', 'updatedAt', ARGV[1], 'lockedBy', '')
        redis.call('ZADD', KEYS[1], string.format('%.0f', (9 - priority) * 1e13 + createdAt), jobId)
      end
      table.insert(requeued, jobId)
    end
  end
end
return requeued
`;

function parseHash(flat: string[] | null): Record<string, string> | null {
  if (!flat || flat.length === 0) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) {
    const k = flat[i];
    const v = flat[i + 1];
    if (k !== undefined) out[k] = v ?? '';
  }
  return out;
}

function toRecord(hash: Record<string, string> | null): JobRecord | null {
  if (!hash || !hash.id) return null;
  let data: unknown = {};
  try {
    data = JSON.parse(hash.data ?? '{}');
  } catch {
    data = {};
  }
  return {
    id: hash.id,
    queue: hash.queue as QueueName,
    name: hash.name ?? '',
    data,
    attempts: Number(hash.attempts ?? '0'),
    maxAttempts: Number(hash.maxAttempts ?? '1'),
    status: (hash.status ?? 'PENDING') as JobStatus,
    progress: Number(hash.progress ?? '0'),
    refId: hash.refId ? hash.refId : null,
    priority: Number(hash.priority ?? '0'),
    createdAt: Number(hash.createdAt ?? '0'),
    updatedAt: Number(hash.updatedAt ?? '0'),
    startedAt: hash.startedAt ? Number(hash.startedAt) : null,
    lockedBy: hash.lockedBy ? hash.lockedBy : null,
    error: hash.error ? hash.error : null,
  };
}

export interface EnqueueOptions {
  queue: QueueName;
  name: string;
  data: unknown;
  /** Verknuepfung zum DB-Datensatz (video_jobs.id bzw. publishing_jobs.id). */
  refId?: string | null;
  priority?: number;
  maxAttempts?: number;
  delayMs?: number;
  /** Eigene Job-ID vorgeben (fuer idempotentes Einreihen). */
  jobId?: string;
}

export interface QueueStats {
  queue: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

/**
 * Sprachneutrale Redis-Queue. Die Python-Worker sprechen exakt dasselbe
 * Protokoll (workers/_shared/acfworker/queue.py).
 */
export class JobQueue {
  readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
    redis.defineCommand('acfReserve', { numberOfKeys: 2, lua: LUA_RESERVE });
    redis.defineCommand('acfComplete', { numberOfKeys: 2, lua: LUA_COMPLETE });
    redis.defineCommand('acfFail', { numberOfKeys: 4, lua: LUA_FAIL });
    redis.defineCommand('acfPark', { numberOfKeys: 4, lua: LUA_PARK });
    redis.defineCommand('acfPromote', { numberOfKeys: 2, lua: LUA_PROMOTE });
    redis.defineCommand('acfReap', { numberOfKeys: 3, lua: LUA_REAP });
  }

  private get script(): Record<string, (...args: unknown[]) => Promise<unknown>> {
    return this.redis as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  }

  async enqueue(opts: EnqueueOptions): Promise<JobRecord> {
    const now = Date.now();
    const id = opts.jobId ?? randomUUID();
    const priority = opts.priority ?? 0;
    const record = {
      id,
      queue: opts.queue,
      name: opts.name,
      data: JSON.stringify(opts.data ?? {}),
      attempts: '0',
      maxAttempts: String(opts.maxAttempts ?? 3),
      status: 'PENDING',
      progress: '0',
      refId: opts.refId ?? '',
      priority: String(priority),
      createdAt: String(now),
      updatedAt: String(now),
      startedAt: '',
      lockedBy: '',
      error: '',
    };

    const pipeline = this.redis.multi();
    pipeline.hset(keys.job(id), record);
    if (opts.delayMs && opts.delayMs > 0) {
      pipeline.zadd(keys.delayed(opts.queue), String(now + opts.delayMs), id);
    } else {
      pipeline.zadd(keys.waiting(opts.queue), String(scoreFor(priority, now)), id);
    }
    await pipeline.exec();

    return toRecord(record as unknown as Record<string, string>)!;
  }

  /** Holt den naechsten Job oder null. Wird vom Worker gepollt. */
  async reserve(queue: QueueName, workerId: string, lockTtlSec: number): Promise<JobRecord | null> {
    const raw = (await this.script.acfReserve!(
      keys.waiting(queue),
      keys.active(queue),
      workerId,
      String(lockTtlSec),
      String(Date.now()),
      keys.jobPrefix(),
      keys.lockPrefix(),
    )) as string[] | null;
    return toRecord(parseHash(raw));
  }

  /** Verlaengert die Sperre und schreibt den Fortschritt (0..100). */
  async heartbeat(jobId: string, workerId: string, lockTtlSec: number, progress?: number): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.set(keys.lock(jobId), workerId, 'EX', lockTtlSec);
    if (typeof progress === 'number') {
      pipeline.hset(keys.job(jobId), 'progress', String(Math.round(progress)), 'updatedAt', String(Date.now()));
    }
    await pipeline.exec();
  }

  async complete(queue: QueueName, jobId: string): Promise<void> {
    await this.script.acfComplete!(
      keys.job(jobId),
      keys.active(queue),
      jobId,
      String(Date.now()),
      keys.jobPrefix(),
      keys.lockPrefix(),
      String(TTL_COMPLETED_SEC),
    );
  }

  async fail(
    queue: QueueName,
    jobId: string,
    error: string,
    opts: { backoffMs?: number; permanent?: boolean } = {},
  ): Promise<'RETRY' | 'FAILED' | 'GONE'> {
    const result = (await this.script.acfFail!(
      keys.job(jobId),
      keys.active(queue),
      keys.failed(queue),
      keys.delayed(queue),
      jobId,
      String(Date.now()),
      keys.jobPrefix(),
      keys.lockPrefix(),
      error.slice(0, 2000),
      String(opts.backoffMs ?? 30_000),
      opts.permanent ? '1' : '0',
      String(TTL_FAILED_SEC),
    )) as string;
    return result as 'RETRY' | 'FAILED' | 'GONE';
  }

  /** Job ohne Versuchsverbrauch parken (z.B. WAITING_FOR_GPU). */
  async park(
    queue: QueueName,
    jobId: string,
    status: JobStatus,
    reason: string,
    retryInMs: number,
  ): Promise<void> {
    await this.script.acfPark!(
      keys.job(jobId),
      keys.active(queue),
      keys.failed(queue),
      keys.delayed(queue),
      jobId,
      String(Date.now()),
      keys.jobPrefix(),
      keys.lockPrefix(),
      reason.slice(0, 500),
      status,
      String(retryInMs),
    );
  }

  async promoteDelayed(queue: QueueName): Promise<number> {
    const moved = (await this.script.acfPromote!(
      keys.delayed(queue),
      keys.waiting(queue),
      String(Date.now()),
      keys.jobPrefix(),
    )) as number;
    return Number(moved ?? 0);
  }

  /** Stellt Jobs abgestuerzter Worker wieder her. Gibt die Job-IDs zurueck. */
  async reapStalled(queue: QueueName): Promise<string[]> {
    const ids = (await this.script.acfReap!(
      keys.waiting(queue),
      keys.active(queue),
      keys.failed(queue),
      String(Date.now()),
      keys.jobPrefix(),
      keys.lockPrefix(),
      String(TTL_FAILED_SEC),
    )) as string[];
    return ids ?? [];
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const hash = await this.redis.hgetall(keys.job(jobId));
    return toRecord(Object.keys(hash).length ? hash : null);
  }

  async stats(queue: QueueName): Promise<QueueStats> {
    const [waiting, active, delayed, failed] = await Promise.all([
      this.redis.zcard(keys.waiting(queue)),
      this.redis.llen(keys.active(queue)),
      this.redis.zcard(keys.delayed(queue)),
      this.redis.llen(keys.failed(queue)),
    ]);
    return { queue, waiting, active, delayed, failed };
  }

  /** Listet Job-IDs einer Queue nach Zustand (fuer die Queue-Ansicht im UI). */
  async listJobIds(queue: QueueName, state: 'waiting' | 'active' | 'delayed' | 'failed', limit = 50): Promise<string[]> {
    switch (state) {
      case 'waiting':
        return this.redis.zrange(keys.waiting(queue), 0, limit - 1);
      case 'delayed':
        return this.redis.zrange(keys.delayed(queue), 0, limit - 1);
      default:
        return this.redis.lrange(state === 'active' ? keys.active(queue) : keys.failed(queue), 0, limit - 1);
    }
  }

  async listJobs(queue: QueueName, state: 'waiting' | 'active' | 'delayed' | 'failed', limit = 50): Promise<JobRecord[]> {
    const ids = await this.listJobIds(queue, state, limit);
    if (ids.length === 0) return [];
    const pipeline = this.redis.multi();
    for (const id of ids) pipeline.hgetall(keys.job(id));
    const results = (await pipeline.exec()) ?? [];
    return results
      .map(([, hash]) => toRecord(hash as Record<string, string>))
      .filter((job): job is JobRecord => job !== null);
  }

  /** Bricht einen Job ab, egal in welchem Zustand er sich befindet. */
  async cancel(queue: QueueName, jobId: string): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.zrem(keys.waiting(queue), jobId);
    pipeline.zrem(keys.delayed(queue), jobId);
    pipeline.lrem(keys.active(queue), 1, jobId);
    pipeline.lrem(keys.failed(queue), 1, jobId);
    pipeline.del(keys.lock(jobId));
    pipeline.hset(keys.job(jobId), 'status', 'CANCELLED', 'updatedAt', String(Date.now()), 'lockedBy', '');
    pipeline.expire(keys.job(jobId), TTL_COMPLETED_SEC);
    await pipeline.exec();
  }

  /** Stellt einen fehlgeschlagenen Job zurueck in die Warteschlange. */
  async retry(queue: QueueName, jobId: string): Promise<boolean> {
    const exists = await this.redis.exists(keys.job(jobId));
    if (!exists) return false;
    const now = Date.now();
    const priority = Number((await this.redis.hget(keys.job(jobId), 'priority')) ?? '0');
    const pipeline = this.redis.multi();
    pipeline.lrem(keys.failed(queue), 1, jobId);
    pipeline.hset(keys.job(jobId), 'status', 'PENDING', 'attempts', '0', 'error', '', 'updatedAt', String(now));
    pipeline.persist(keys.job(jobId));
    pipeline.zadd(keys.waiting(queue), String(scoreFor(priority, now)), jobId);
    await pipeline.exec();
    return true;
  }
}
