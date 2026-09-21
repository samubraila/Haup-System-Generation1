export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      });
  }
  return refreshPromise;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  retryOnUnauthorized?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, retryOnUnauthorized = true, headers, ...rest } = options;
  const method = (rest.method ?? 'GET').toUpperCase();

  const finalHeaders: Record<string, string> = {
    accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    finalHeaders['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('acf_csrf');
    if (csrf) finalHeaders['x-csrf-token'] = csrf;
  }

  const response = await fetch(path, {
    ...rest,
    method,
    headers: finalHeaders,
    body: payload,
    credentials: 'same-origin',
  });

  if (response.status === 401 && retryOnUnauthorized && !path.startsWith('/api/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, retryOnUnauthorized: false });
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      error?.message ?? `Anfrage fehlgeschlagen (${response.status})`,
      response.status,
      error?.code ?? 'unknown',
      error?.details,
    );
  }

  return json as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => apiFetch<T>(path, { method: 'POST', body: form }),
};

export function mediaUrl(mediaId: string | null | undefined, download = false): string | null {
  if (!mediaId) return null;
  return `/api/media/${mediaId}/file${download ? '?download=true' : ''}`;
}
