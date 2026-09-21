/**
 * Fehlerklassen mit HTTP-Bedeutung. Der zentrale Error-Handler uebersetzt sie
 * in eine einheitliche JSON-Antwort: { error: { code, message, details } }.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Ungueltige Anfrage', details?: unknown) {
    super(message, 400, 'bad_request', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Nicht angemeldet') {
    super(message, 401, 'unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Keine Berechtigung') {
    super(message, 403, 'forbidden');
  }
}

export class NotFoundError extends AppError {
  constructor(entity = 'Datensatz') {
    super(`${entity} nicht gefunden`, 404, 'not_found');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Konflikt mit dem aktuellen Zustand', details?: unknown) {
    super(message, 409, 'conflict', details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Datei zu gross') {
    super(message, 413, 'payload_too_large');
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'unprocessable', details);
  }
}

/**
 * Eine benoetigte Integration ist nicht eingerichtet (z.B. fehlende OAuth-App).
 * Bewusst eigener Code: die Oberflaeche zeigt daraufhin "Not configured"
 * statt eines technischen Fehlers.
 */
export class NotConfiguredError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 503, 'not_configured', details);
  }
}
