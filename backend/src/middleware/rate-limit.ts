import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

const message = {
  error: { code: 'rate_limited', message: 'Zu viele Anfragen. Bitte kurz warten.' },
};

/** Allgemeine Obergrenze fuer die gesamte API. */
export const apiRateLimit = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
  // Worker und n8n arbeiten im Maschinentakt und wuerden das Limit sonst reissen.
  skip: (req) => Boolean(req.header('x-api-key')),
});

/** Deutlich straffer: schuetzt Anmeldung und Registrierung vor Rateversuchen. */
export const authRateLimit = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: { code: 'rate_limited', message: 'Zu viele Anmeldeversuche. Bitte spaeter erneut versuchen.' },
  },
});

/** Uploads sind teuer, daher eigenes Limit. */
export const uploadRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
  skip: (req) => Boolean(req.header('x-api-key')),
});
