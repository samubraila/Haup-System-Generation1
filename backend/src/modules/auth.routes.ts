import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config/index.js';
import { query, queryMany, queryOne } from '../db/pool.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  requireAuth,
  requireRole,
  signAccessToken,
  type AuthUser,
  type Role,
} from '../middleware/auth.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';
import { audit, contextFromRequest } from '../services/audit.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../utils/errors.js';
import { asyncHandler } from '../utils/http.js';
import { emailSchema } from '../utils/validation.js';

export const authRouter: Router = Router();

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;
const REFRESH_TTL_DAYS = 30;

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Passwort fehlt'),
});

const passwordSchema = z
  .string()
  .min(12, 'Das Passwort muss mindestens 12 Zeichen lang sein')
  .max(200)
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value), {
    message: 'Das Passwort braucht Gross- und Kleinbuchstaben sowie eine Ziffer',
  });

const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(120),
  role: z.enum(['admin', 'editor', 'viewer']).default('editor'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: Role;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function setSessionCookies(res: import('express').Response, user: AuthUser, refreshToken: string): string {
  const base = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
  } as const;

  res.cookie(ACCESS_COOKIE, signAccessToken(user), {
    ...base,
    path: '/',
    maxAge: 60 * 60 * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: '/api/auth',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
  return issueCsrfToken(res);
}

function clearSessionCookies(res: import('express').Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

async function issueRefreshToken(userId: string, req: import('express').Request): Promise<string> {
  const token = randomBytes(48).toString('base64url');
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`,
    [
      userId,
      hashToken(token),
      String(REFRESH_TTL_DAYS),
      (req.headers['user-agent'] ?? '').toString().slice(0, 300),
      req.ip ?? '',
    ],
  );
  return token;
}

authRouter.post(
  '/login',
  authRateLimit,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const ctx = contextFromRequest(req);

    const user = await queryOne<UserRow>(
      `SELECT id, email, password_hash, name, role, is_active, failed_login_attempts, locked_until
       FROM users WHERE lower(email) = lower($1)`,
      [email],
    );

    const genericError = new UnauthorizedError('E-Mail-Adresse oder Passwort ist falsch');

    if (!user) {
      await bcrypt.compare(password, '$2a$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvalidsa');
      await audit('user.login_failed', ctx, 'user', '', { email });
      throw genericError;
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new UnauthorizedError('Konto ist vorübergehend gesperrt. Bitte später erneut versuchen.');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid || !user.is_active) {
      const attempts = user.failed_login_attempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await query(
        `UPDATE users SET failed_login_attempts = $2,
           locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
         WHERE id = $1`,
        [user.id, attempts, lock, String(LOCK_MINUTES)],
      );
      await audit('user.login_failed', { ...ctx, userId: user.id }, 'user', user.id, { attempts, locked: lock });
      throw genericError;
    }

    await query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [user.id],
    );

    const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    const refreshToken = await issueRefreshToken(user.id, req);
    const csrfToken = setSessionCookies(res, authUser, refreshToken);
    await audit('user.login', { ...ctx, userId: user.id }, 'user', user.id);

    res.json({ user: authUser, csrfToken });
  }),
);

authRouter.post(
  '/refresh',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedError('Kein Refresh-Token vorhanden');

    const row = await queryOne<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hashToken(token)],
    );
    if (!row) {
      clearSessionCookies(res);
      throw new UnauthorizedError('Sitzung abgelaufen. Bitte erneut anmelden.');
    }

    const user = await queryOne<UserRow>(
      'SELECT id, email, password_hash, name, role, is_active, failed_login_attempts, locked_until FROM users WHERE id = $1',
      [row.user_id],
    );
    if (!user || !user.is_active) {
      clearSessionCookies(res);
      throw new UnauthorizedError('Konto ist nicht mehr aktiv');
    }

    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);

    const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    const nextToken = await issueRefreshToken(user.id, req);
    const csrfToken = setSessionCookies(res, authUser, nextToken);

    res.json({ user: authUser, csrfToken });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token) {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]);
    }
    clearSessionCookies(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const csrfToken = issueCsrfToken(res);
    res.json({ user: req.user, csrfToken });
  }),
);

authRouter.post(
  '/password',
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
      req.user!.id,
    ]);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new UnauthorizedError('Das aktuelle Passwort ist falsch');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestError('Das neue Passwort muss sich vom alten unterscheiden');
    }

    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user!.id, await bcrypt.hash(newPassword, 12)]);
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
      req.user!.id,
    ]);
    await audit('user.password_changed', contextFromRequest(req), 'user', req.user!.id);

    clearSessionCookies(res);
    res.json({ ok: true, message: 'Passwort geaendert. Bitte erneut anmelden.' });
  }),
);

authRouter.get(
  '/users',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const items = await queryMany<{
      id: string;
      email: string;
      name: string;
      role: Role;
      is_active: boolean;
      last_login_at: Date | null;
      created_at: Date;
    }>('SELECT id, email, name, role, is_active, last_login_at, created_at FROM users ORDER BY created_at');
    res.json({ items });
  }),
);

authRouter.post(
  '/users',
  requireAuth,
  requireRole('admin'),
  validateBody(createUserSchema),
  asyncHandler(async (req, res) => {
    const { email, password, name, role } = req.body as z.infer<typeof createUserSchema>;
    const existing = await queryOne('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (existing) throw new ConflictError('Diese E-Mail-Adresse wird bereits verwendet');

    const created = await queryOne<{ id: string }>(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, await bcrypt.hash(password, 12), name, role],
    );
    await audit('user.created', contextFromRequest(req), 'user', created?.id ?? '', { email, role });
    res.status(201).json({ id: created?.id, email, name, role });
  }),
);
