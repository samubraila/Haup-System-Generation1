import type { RequestHandler } from 'express';
import { config } from '../config/index.js';
import { safeCompare } from '../services/crypto.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * Authentifizierung fuer Maschine-zu-Maschine-Aufrufe: Worker-Container und n8n.
 *
 * Diese Route-Gruppe ist im Docker-Netz erreichbar, aber nicht vom Browser --
 * sie wird nicht ueber den Frontend-Proxy durchgereicht (siehe infra/nginx).
 */
export const requireInternalKey: RequestHandler = (req, _res, next) => {
  const provided = req.header('x-api-key');
  if (!provided || !safeCompare(provided, config.INTERNAL_API_KEY)) {
    next(new UnauthorizedError('Ungueltiger interner API-Key'));
    return;
  }
  req.internalCaller = req.header('x-worker-id') ?? 'unknown';
  next();
};
