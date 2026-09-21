import type { Request } from 'express';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export type AuditAction =
  | 'user.login'
  | 'user.login_failed'
  | 'user.logout'
  | 'user.created'
  | 'user.password_changed'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'video.created'
  | 'video.generate'
  | 'video.approved'
  | 'video.rejected'
  | 'video.deleted'
  | 'video.regenerate'
  | 'job.retried'
  | 'job.cancelled'
  | 'social.connect_started'
  | 'social.connected'
  | 'social.disconnected'
  | 'social.token_refreshed'
  | 'post.scheduled'
  | 'post.published'
  | 'post.cancelled'
  | 'media.uploaded'
  | 'media.deleted'
  | 'settings.updated'
  | 'backup.created'
  | 'backup.restored';

export interface AuditContext {
  userId?: string | null;
  ip?: string;
  userAgent?: string;
}

export function contextFromRequest(req: Request): AuditContext {
  return {
    userId: req.user?.id ?? null,
    ip: req.ip ?? '',
    userAgent: (req.headers['user-agent'] ?? '').toString().slice(0, 300),
  };
}

export async function audit(
  action: AuditAction,
  ctx: AuditContext,
  entity = '',
  entityId = '',
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, ip, user_agent, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ctx.userId ?? null,
        action,
        entity,
        entityId,
        (ctx.ip ?? '').slice(0, 64),
        (ctx.userAgent ?? '').slice(0, 300),
        JSON.stringify(meta),
      ],
    );
  } catch (err) {
    logger.error({ err: (err as Error).message, action }, 'Audit-Eintrag fehlgeschlagen');
  }
}
