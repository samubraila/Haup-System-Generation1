import { PlatformRejectedError, ReconnectRequiredError } from './types.js';

export interface JsonRequest {
  url: string;
  method?: string;
  accessToken?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function requestJson<T = Record<string, unknown>>(options: JsonRequest): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(options.url, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        if (!response.ok) throw new PlatformRejectedError(`HTTP ${response.status}: ${text.slice(0, 300)}`);
        return {} as T;
      }
    }

    if (!response.ok) throw toPlatformError(response.status, json, text);
    return json as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function toPlatformError(status: number, json: Record<string, unknown>, fallbackText = ''): Error {
  const errorObject = (json.error ?? {}) as Record<string, unknown>;
  const message =
    (errorObject.message as string) ??
    (json.error_description as string) ??
    ((json.data as Record<string, unknown>)?.error_message as string) ??
    (typeof json.error === 'string' ? json.error : null) ??
    fallbackText.slice(0, 300) ??
    `HTTP ${status}`;

  const code =
    (errorObject.code as number | string) ??
    ((json.error as Record<string, unknown>)?.code as string) ??
    status;

  if (status === 401 || status === 403 || String(code).includes('access_token')) {
    return new ReconnectRequiredError(`Zugriff verweigert (${code}): ${message}`);
  }
  if (status >= 400 && status < 500 && status !== 429) {
    return new PlatformRejectedError(`Von der Plattform abgelehnt (${code}): ${message}`);
  }
  return new Error(`Plattformfehler ${status} (${code}): ${message}`);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; onRetry?: (attempt: number, err: Error) => void } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let lastError: Error = new Error('Unbekannter Fehler');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err as Error;
      if (err instanceof PlatformRejectedError || err instanceof ReconnectRequiredError) throw err;
      if (attempt === attempts) break;
      opts.onRetry?.(attempt, lastError);
      await new Promise((resolve) => setTimeout(resolve, (opts.baseDelayMs ?? 2000) * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
