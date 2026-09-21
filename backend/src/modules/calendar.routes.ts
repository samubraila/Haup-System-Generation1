import { Router } from 'express';
import { z } from 'zod';
import { query, queryMany, queryOne } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { audit, contextFromRequest } from '../services/audit.js';
import { cancelPost, enqueuePublishJob } from '../services/publisher.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { asyncHandler } from '../utils/http.js';

export const calendarRouter: Router = Router();

const rescheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

interface CalendarRow {
  id: string;
  video_id: string;
  video_title: string;
  project_id: string;
  project_name: string;
  platform: string;
  status: string;
  title: string;
  scheduled_at: Date | null;
  published_at: Date | null;
  external_url: string | null;
  error: string | null;
  thumbnail_media_id: string | null;
  format: string;
}

calendarRouter.use(requireAuth);

calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 864e5);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 30 * 864e5);

    const rows = await queryMany<CalendarRow>(
      `SELECT sp.id, sp.video_id, v.title AS video_title, v.format, v.thumbnail_media_id,
              sp.project_id, p.name AS project_name, sp.platform, sp.status, sp.title,
              sp.scheduled_at, sp.published_at, sp.external_url, sp.error
       FROM social_posts sp
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = sp.project_id
       WHERE p.user_id = $1
         AND sp.status <> 'cancelled'
         AND COALESCE(sp.published_at, sp.scheduled_at) BETWEEN $2 AND $3
       ORDER BY COALESCE(sp.published_at, sp.scheduled_at)`,
      [req.user!.id, from, to],
    );

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      items: rows.map((row) => ({
        id: row.id,
        videoId: row.video_id,
        videoTitle: row.video_title,
        format: row.format,
        thumbnailMediaId: row.thumbnail_media_id,
        projectId: row.project_id,
        projectName: row.project_name,
        platform: row.platform,
        status: row.status,
        title: row.title,
        scheduledAt: row.scheduled_at,
        publishedAt: row.published_at,
        externalUrl: row.external_url,
        error: row.error,
      })),
    });
  }),
);

calendarRouter.patch(
  '/:postId',
  requireEditor,
  validateBody(rescheduleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof rescheduleSchema>;
    const post = await queryOne<{ id: string; status: string; video_id: string }>(
      `SELECT sp.id, sp.status, sp.video_id FROM social_posts sp
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = v.project_id
       WHERE sp.id = $1 AND p.user_id = $2`,
      [req.params.postId!, req.user!.id],
    );
    if (!post) throw new NotFoundError('Veroeffentlichung');
    if (post.status === 'published') throw new ConflictError('Bereits veroeffentlichte Beitraege lassen sich nicht verschieben');

    const scheduledAt = new Date(body.scheduledAt);

    if (post.status === 'queued' || post.status === 'processing') {
      await cancelPost(post.id);
    }

    await query(
      `UPDATE social_posts SET scheduled_at = $2, status = 'scheduled', error = NULL WHERE id = $1`,
      [post.id, scheduledAt],
    );

    const video = await queryOne<{ status: string; require_approval: boolean; approved_at: Date | null }>(
      'SELECT status, require_approval, approved_at FROM videos WHERE id = $1',
      [post.video_id],
    );
    const ready = video && (!video.require_approval || video.approved_at !== null);

    if (ready) {
      const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
      await enqueuePublishJob(post.id, delayMs).catch(() => undefined);
    }

    await audit('post.scheduled', contextFromRequest(req), 'social_post', post.id, {
      scheduledAt: scheduledAt.toISOString(),
    });
    res.json({ ok: true, scheduledAt: scheduledAt.toISOString() });
  }),
);

calendarRouter.delete(
  '/:postId',
  requireEditor,
  asyncHandler(async (req, res) => {
    const post = await queryOne<{ id: string }>(
      `SELECT sp.id FROM social_posts sp
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = v.project_id
       WHERE sp.id = $1 AND p.user_id = $2`,
      [req.params.postId!, req.user!.id],
    );
    if (!post) throw new NotFoundError('Veroeffentlichung');
    await cancelPost(post.id);
    res.status(204).end();
  }),
);
