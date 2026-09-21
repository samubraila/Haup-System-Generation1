import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { writeLog } from '../services/log-store.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'not_found', message: `Route ${req.method} ${req.path} existiert nicht` },
  });
};

/**
 * Einheitliche Fehlerantwort. Interne Details (Stacktrace, SQL) verlassen den
 * Server nie -- der Benutzer bekommt eine verstaendliche Meldung, die
 * technischen Details landen im Log-Bereich.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Die uebermittelten Daten sind ungueltig',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ err: err.message, code: err.code, path: req.path }, 'Anwendungsfehler');
    } else {
      logger.debug({ err: err.message, code: err.code, path: req.path }, 'Abgewiesene Anfrage');
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // Multer-Fehler (Upload zu gross, zu viele Dateien).
  const anyErr = err as { code?: string; message?: string; stack?: string };
  if (anyErr.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      error: { code: 'payload_too_large', message: `Datei ueberschreitet ${config.MAX_UPLOAD_MB} MB` },
    });
    return;
  }

  logger.error({ err: anyErr.message, stack: anyErr.stack, path: req.path }, 'Unbehandelter Fehler');
  void writeLog('error', 'backend', anyErr.message ?? 'Unbekannter Fehler', {
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Interner Serverfehler. Details stehen im Log-Bereich.',
      ...(config.isProduction ? {} : { debug: anyErr.message }),
    },
  });
};
