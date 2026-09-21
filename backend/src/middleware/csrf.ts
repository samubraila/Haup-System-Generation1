import { randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { config } from '../config/index.js';
import { safeCompare } from '../services/crypto.js';
import { ForbiddenError } from '../utils/errors.js';
import { CSRF_COOKIE } from './auth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(res: Response): string {
  const token = randomBytes(32).toString('base64url');
  // Bewusst NICHT httpOnly: das Frontend muss den Wert lesen und als Header
  // zuruecksenden (Double-Submit-Verfahren).
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return token;
}

/**
 * Double-Submit-CSRF-Schutz.
 *
 * Da die Sitzung in einem Cookie steckt, koennte eine fremde Seite sonst
 * Schreibanfragen ausloesen. Nur Anfragen, die den Cookie-Wert zusaetzlich im
 * Header mitschicken, werden akzeptiert -- das kann fremdes JavaScript nicht.
 *
 * Aufrufe mit internem API-Key (Worker, n8n) sind ausgenommen: sie haben kein
 * Cookie und sind damit nicht anfaellig.
 */
export const csrfProtection: RequestHandler = (req: Request, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.header('x-api-key')) {
    next();
    return;
  }
  // Reine Bearer-Aufrufe (z.B. Skripte) tragen kein Cookie und sind sicher.
  const hasSessionCookie = Boolean((req.cookies as Record<string, string> | undefined)?.acf_at);
  if (!hasSessionCookie) {
    next();
    return;
  }

  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
  const headerToken = req.header('x-csrf-token');

  if (!cookieToken || !headerToken || !safeCompare(cookieToken, headerToken)) {
    next(new ForbiddenError('CSRF-Token fehlt oder stimmt nicht ueberein'));
    return;
  }
  next();
};
