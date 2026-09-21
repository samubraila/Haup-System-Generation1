import type { Logger } from './logger.js';

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  workerId: string;
  logger?: Logger;
  timeoutMs?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Der einzige Weg, auf dem ein Worker Zustand veraendert.
 *
 * Worker sprechen NIE direkt mit PostgreSQL -- sie melden Ergebnisse an das
 * Backend, das die Datenbank besitzt. Dadurch bleibt das Schema eine interne
 * Angelegenheit des Hauptsystems und Worker koennen auf anderen Rechnern laufen.
 */
export class BackendApi {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly workerId: string;
  private readonly logger?: Logger;
  private readonly timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.workerId = opts.workerId;
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { retries?: number; raw?: boolean } = {},
  ): Promise<T> {
    const retries = opts.retries ?? 3;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'x-api-key': this.apiKey,
            'x-worker-id': this.workerId,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          // 4xx sind Anwendungsfehler -- ein Retry wuerde nichts aendern.
          if (response.status >= 400 && response.status < 500) {
            throw new ApiError(`${method} ${path} -> ${response.status}`, response.status, text);
          }
          throw new ApiError(`${method} ${path} -> ${response.status}`, response.status, text);
        }

        if (opts.raw) return (await response.arrayBuffer()) as unknown as T;
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      } catch (err) {
        lastError = err;
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
        if (attempt === retries) break;
        const backoff = Math.min(8000, 500 * 2 ** attempt);
        this.logger?.warn(
          { err: (err as Error).message, path, attempt },
          'Backend nicht erreichbar, neuer Versuch',
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  // --- Job-Lebenszyklus -----------------------------------------------------

  /** Fortschritt melden (0-100). Fehler werden bewusst geschluckt. */
  async reportProgress(jobId: string, progress: number, message?: string): Promise<void> {
    await this.request('POST', `/api/internal/jobs/${jobId}/progress`, {
      progress: Math.max(0, Math.min(100, Math.round(progress))),
      message,
      workerId: this.workerId,
    }).catch((err) => this.logger?.debug({ err: String(err) }, 'Fortschritt konnte nicht gemeldet werden'));
  }

  async reportStarted(jobId: string, meta: Record<string, unknown> = {}): Promise<void> {
    await this.request('POST', `/api/internal/jobs/${jobId}/started`, { workerId: this.workerId, meta });
  }

  async reportCompleted(jobId: string, result: Record<string, unknown>): Promise<void> {
    await this.request('POST', `/api/internal/jobs/${jobId}/completed`, { workerId: this.workerId, result });
  }

  async reportFailed(jobId: string, error: string, willRetry: boolean): Promise<void> {
    await this.request('POST', `/api/internal/jobs/${jobId}/failed`, {
      workerId: this.workerId,
      error: error.slice(0, 4000),
      willRetry,
    });
  }

  /** Zwischenzustand melden, z.B. WAITING_FOR_GPU. */
  async reportStatus(jobId: string, status: string, reason?: string): Promise<void> {
    await this.request('POST', `/api/internal/jobs/${jobId}/status`, {
      workerId: this.workerId,
      status,
      reason,
    });
  }

  // --- Sonstiges ------------------------------------------------------------

  /** Strukturierter Log-Eintrag, sichtbar im Logs-Bereich der Oberflaeche. */
  async log(level: 'debug' | 'info' | 'warn' | 'error', message: string, context: Record<string, unknown> = {}): Promise<void> {
    await this.request('POST', '/api/internal/logs', {
      level,
      source: this.workerId,
      message,
      context,
    }).catch(() => undefined);
  }

  /** Registriert eine erzeugte Datei als Media-Datensatz im Backend. */
  async registerMedia(payload: {
    projectId: string;
    videoId?: string | null;
    kind: 'image' | 'audio' | 'video' | 'subtitle' | 'thumbnail' | 'script' | 'other';
    path: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
    meta?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    return this.request('POST', '/api/internal/media', payload);
  }

  /** Holt ein entschluesseltes Zugriffstoken (nur fuer Publisher-Worker freigegeben). */
  async getSocialCredentials(accountId: string): Promise<{
    accountId: string;
    platform: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    externalId: string | null;
    meta: Record<string, unknown>;
  }> {
    return this.request('GET', `/api/internal/social-accounts/${accountId}/credentials`, undefined, { retries: 1 });
  }

  /** Meldet erneuerte Tokens zurueck, damit das Backend sie verschluesselt ablegt. */
  async updateSocialTokens(
    accountId: string,
    tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: string | null },
  ): Promise<void> {
    await this.request('POST', `/api/internal/social-accounts/${accountId}/tokens`, tokens, { retries: 1 });
  }

  /** Markiert ein Konto als fehlerhaft (z.B. Token abgelaufen, Reconnect noetig). */
  async reportSocialAccountError(accountId: string, error: string, requiresReconnect: boolean): Promise<void> {
    await this.request('POST', `/api/internal/social-accounts/${accountId}/error`, {
      error: error.slice(0, 1000),
      requiresReconnect,
    }).catch(() => undefined);
  }

  // --- Dateitransfer (nur im Storage-Modus "api", z.B. entfernter GPU-Worker) --

  async downloadFile(relativePath: string): Promise<ArrayBuffer> {
    return this.request<ArrayBuffer>(
      'GET',
      `/api/internal/files?path=${encodeURIComponent(relativePath)}`,
      undefined,
      { raw: true },
    );
  }

  async uploadFile(relativePath: string, data: Uint8Array, contentType = 'application/octet-stream'): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 10 * 60_000));
    try {
      const response = await fetch(
        `${this.baseUrl}/api/internal/files?path=${encodeURIComponent(relativePath)}`,
        {
          method: 'PUT',
          headers: {
            'x-api-key': this.apiKey,
            'x-worker-id': this.workerId,
            'content-type': contentType,
          },
          body: data,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ApiError(`PUT /api/internal/files -> ${response.status}`, response.status, text);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
