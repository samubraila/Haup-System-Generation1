import os from 'node:os';
import { randomUUID } from 'node:crypto';

function env(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Pflicht-Umgebungsvariable ${key} fehlt`);
  }
  return value;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Umgebungsvariable ${key} ist keine Zahl: ${raw}`);
  return parsed;
}

export interface WorkerConfig {
  workerName: string;
  workerId: string;
  version: string;
  host: string;
  redisUrl: string;
  backendUrl: string;
  internalApiKey: string;
  dataDir: string;
  /** volume = gemeinsames Dateisystem, api = Dateitransfer ueber Backend-HTTP. */
  storageMode: 'volume' | 'api';
  healthPort: number;
  concurrency: number;
  jobTimeoutMs: number;
  maxAttempts: number;
  lockTtlSec: number;
  logLevel: string;
}

/**
 * Laedt die Worker-Konfiguration aus der Umgebung. Alle Worker-Container
 * verwenden dieselben Variablennamen -- dadurch bleibt docker-compose lesbar.
 */
export function loadWorkerConfig(defaults: { name: string; concurrency?: number }): WorkerConfig {
  const storageMode = env('STORAGE_MODE', 'volume');
  if (storageMode !== 'volume' && storageMode !== 'api') {
    throw new Error(`STORAGE_MODE muss "volume" oder "api" sein, war: ${storageMode}`);
  }

  const workerName = env('WORKER_NAME', defaults.name);

  return {
    workerName,
    // Stabil ueber Container-Neustarts hinweg, wenn WORKER_ID gesetzt ist.
    workerId: env('WORKER_ID', `${workerName}-${os.hostname()}-${randomUUID().slice(0, 8)}`),
    version: env('WORKER_VERSION', '1.0.0'),
    host: os.hostname(),
    redisUrl: env('REDIS_URL'),
    backendUrl: env('BACKEND_URL', 'http://backend:4000'),
    internalApiKey: env('INTERNAL_API_KEY'),
    dataDir: env('DATA_DIR', '/data'),
    storageMode,
    healthPort: envInt('HEALTH_PORT', 9000),
    concurrency: envInt('CONCURRENCY', defaults.concurrency ?? 1),
    jobTimeoutMs: envInt('JOB_TIMEOUT_MS', 60 * 60 * 1000),
    maxAttempts: envInt('JOB_MAX_ATTEMPTS', 3),
    lockTtlSec: envInt('JOB_LOCK_TTL_SEC', 60),
    logLevel: env('LOG_LEVEL', 'info'),
  };
}
