/**
 * Gemeinsame Typen fuer das sprachneutrale Queue-Protokoll.
 *
 * Diese Typen bilden exakt die Felder ab, die auch die Python-Worker
 * (workers/_shared/acfworker) lesen und schreiben. Aenderungen hier muessen
 * dort nachgezogen werden -- siehe docs/QUEUE_PROTOCOL.md.
 */

/** Alle Queues des Systems. Ein Worker-Container bedient genau eine Queue. */
export const QUEUES = {
  SCRIPT: 'script',
  IMAGE: 'image',
  VIDEO: 'video',
  VOICE: 'voice',
  SUBTITLE: 'subtitle',
  FFMPEG: 'ffmpeg',
  PUBLISH_YOUTUBE: 'publish.youtube',
  PUBLISH_TIKTOK: 'publish.tiktok',
  PUBLISH_INSTAGRAM: 'publish.instagram',
  PUBLISH_FACEBOOK: 'publish.facebook',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);

/** Lebenszyklus eines Jobs. Identisch in DB, Redis und UI. */
export type JobStatus =
  | 'PENDING'
  | 'WAITING_FOR_GPU'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface JobRecord<TData = unknown> {
  id: string;
  queue: QueueName;
  /** Fachlicher Job-Typ, z.B. "generate_video" oder "render_variant". */
  name: string;
  data: TData;
  attempts: number;
  maxAttempts: number;
  status: JobStatus;
  progress: number;
  /** ID des Jobs in der Backend-Datenbank (video_jobs.id / publishing_jobs.id). */
  refId: string | null;
  priority: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  lockedBy: string | null;
  error: string | null;
}

/** Ergebnis, das ein Handler zurueckgibt. Wird an das Backend gemeldet. */
export interface JobResult {
  [key: string]: unknown;
}

/**
 * Signalisiert, dass der Job aktuell nicht bearbeitet werden kann, weil keine
 * passende GPU verfuegbar ist. Der Job bleibt in der Queue (Status
 * WAITING_FOR_GPU) und wird periodisch erneut geprueft -- ohne Versuch zu
 * verbrauchen und ohne als Fehler zu gelten.
 */
export class WaitingForGpuError extends Error {
  readonly retryInMs: number;
  constructor(message: string, retryInMs: number) {
    super(message);
    this.name = 'WaitingForGpuError';
    this.retryInMs = retryInMs;
  }
}

/**
 * Fehler, der nicht durch einen Retry behoben werden kann (z.B. ungueltige
 * Eingabedaten). Der Job wandert sofort in die Dead-Letter-Liste.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/** Status-Eintrag eines Workers im Health-Dashboard. */
export interface WorkerHeartbeat {
  id: string;
  name: string;
  queue: QueueName | null;
  version: string;
  host: string;
  startedAt: number;
  lastSeen: number;
  status: 'idle' | 'busy' | 'degraded';
  currentJobId: string | null;
  concurrency: number;
  /** Frei belegbare Zusatzinfos, z.B. GPU-Name oder verfuegbarer VRAM. */
  capabilities: Record<string, unknown>;
  /** Grund fuer den Zustand "degraded", z.B. "GPU unavailable". */
  reason: string | null;
}
