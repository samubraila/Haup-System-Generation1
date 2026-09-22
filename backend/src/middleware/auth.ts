import type { NextFunction, Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { queryOne } from '../db/pool.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

export const ACCESS_COOKIE = 'acf_at';
export const REFRESH_COOKIE = 'acf_rt';
export const CSRF_COOKIE = 'acf_csrf';

export type Role = 'admin' | 'editor' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    /** Gesetzt, wenn die Anfrage von einem Worker oder n8n mit API-Key kommt. */
    internalCaller?: string;
  }
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  name: string;
}

export function signAccessToken(user: AuthUser): string {
  const payload: AccessTokenPayload = { sub: user.id, email: user.email, role: user.role, name: user.name };
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL,
    issuer: 'acf-backend',
    audience: 'acf-frontend',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_SECRET, {
    issuer: 'acf-backend',
    audience: 'acf-frontend',
  }) as AccessTokenPayload;
}

function extractToken(req: Request): string | null {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/**
 * Prueft die Anmeldung. Der Token wird bei jedem Aufruf gegen die Datenbank
 * gehalten, damit deaktivierte Konten sofort wirken und nicht erst nach Ablauf.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = extractToken(req);
  if (!token) {
    next(new UnauthorizedError());
    return;
  }

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const expired = (err as Error).name === 'TokenExpiredError';
    next(new UnauthorizedError(expired ? 'Sitzung abgelaufen' : 'Ungueltiges Token'));
    return;
  }

  queryOne<{ id: string; email: string; name: string; role: Role; is_active: boolean }>(
    'SELECT id, email, name, role, is_active FROM users WHERE id = $1',
    [payload.sub],
  )
    .then((user) => {
      if (!user || !user.is_active) {
        next(new UnauthorizedError('Konto ist nicht mehr aktiv'));
        return;
      }
      req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
      next();
    })
    .catch(next);
};

/** Erlaubt den Zugriff nur bestimmten Rollen. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: unknown, next: NextFunction) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError(`Diese Aktion erfordert eine der Rollen: ${roles.join(', ')}`));
      return;
    }
    next();
  };
}

/** Schreibende Aktionen sind fuer die Rolle "viewer" gesperrt. */
export const requireEditor = requireRole('admin', 'editor');
