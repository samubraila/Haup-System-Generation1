import { Router } from 'express';
import { queryMany, queryOne } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { queueOverview } from '../queue/index.js';
import { audit, contextFromRequest } from '../services/audit.js';
import { cancelJob, retryJob, stageLabel } from '../services/pipeline.js';
import { retryPost } from '../services/publisher.js';
import type { VideoJobRow } from '../services/types.js';
import { NotFoundError } from '../utils/errors.js';
import { asyncHandler, paged, readPagination } from '../utils/http.js';

export const jobsRouter: Router = Router();

interface JobListRow extends VideoJobRow {
  video_title: string | null;
  project_name: string;
}

function toApi(row: JobListRow) {
  return {
    id: row.id,
    videoId: row.video_id,
    videoTitle: row.video_title,
    projectName: row.project_name,
    type: row.type,
    label: stageLabel(row.type),
    queue: row.queue,
    status: row.status,
    provider: row.provider,
    progress: row.progress,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    error: row.error,
    statusReason: row.status_reason,
    workerId: row.worker_id,
    etaSeconds: row.eta_seconds,
    stepIndex: row.step_index,
    stepTotal: row.step_total,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

jobsRouter.use(requireAuth);

jobsRouter.get(
  '/queues',
  asyncHandler(async (_req, res) => {
    res.json({ items: await queueOverview() });
  }),
);

jobsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 50);
    const filters = ['p.user_id = $1'];
    const params: Array<string | number> = [req.user!.id];
    let index = 2;

    if (req.query.status) {
      const statuses = String(req.query.status).split(',').filter(Boolean);
      filters.push(`j.status = ANY($${index++})`);
      params.push(statuses as unknown as string);
    }
    if (req.query.type) {
      filters.push(`j.type = $${index++}`);
      params.push(String(req.query.type));
    }
    if (req.query.videoId) {
      filters.push(`j.video_id = $${index++}`);
      params.push(String(req.query.videoId));
    }
    if (req.query.projectId) {
      filters.push(`j.project_id = $${index++}`);
      params.push(String(req.query.projectId));
    }

    const where = filters.join(' AND ');
    const total = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM video_jobs j JOIN projects p ON p.id = j.project_id WHERE ${where}`,
      params,
    );
    const rows = await queryMany<JobListRow>(
      `SELECT j.*, v.title AS video_title, p.name AS project_name
       FROM video_jobs j
       JOIN projects p ON p.id = j.project_id
       LEFT JOIN videos v ON v.id = j.video_id
       WHERE ${where}
       ORDER BY
         CASE j.status WHEN 'RUNNING' THEN 0 WHEN 'WAITING_FOR_GPU' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END,
         j.created_at DESC
       LIMIT $${index++} OFFSET $${index++}`,
      [...params, pageSize, offset],
    );

    res.json(paged(rows.map(toApi), total?.count ?? 0, page, pageSize));
  }),
);

jobsRouter.get(
  '/publishing',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 50);
    const rows = await queryMany<{
      id: string;
      platform: string;
      status: string;
      attempts: number;
      max_attempts: number;
      error: string | null;
      scheduled_at: Date | null;
      started_at: Date | null;
      finished_at: Date | null;
      post_id: string;
      post_status: string;
      external_url: string | null;
      requires_reconnect: boolean;
      video_id: string;
      video_title: string;
    }>(
      `SELECT pj.id, pj.platform, pj.status, pj.attempts, pj.max_attempts, pj.error,
              pj.scheduled_at, pj.started_at, pj.finished_at,
              sp.id AS post_id, sp.status AS post_status, sp.external_url, sp.requires_reconnect,
              v.id AS video_id, v.title AS video_title
       FROM publishing_jobs pj
       JOIN social_posts sp ON sp.id = pj.social_post_id
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = v.project_id
       WHERE p.user_id = $1
       ORDER BY COALESCE(pj.scheduled_at, pj.created_at) DESC
       LIMIT $2 OFFSET $3`,
      [req.user!.id, pageSize, offset],
    );
    const total = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM publishing_jobs pj
       JOIN social_posts sp ON sp.id = pj.social_post_id
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = v.project_id
       WHERE p.user_id = $1`,
      [req.user!.id],
    );

    res.json(
      paged(
        rows.map((row) => ({
          id: row.id,
          postId: row.post_id,
          videoId: row.video_id,
          videoTitle: row.video_title,
          platform: row.platform,
          status: row.status,
          postStatus: row.post_status,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          error: row.error,
          externalUrl: row.external_url,
          requiresReconnect: row.requires_reconnect,
          scheduledAt: row.scheduled_at,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
        })),
        total?.count ?? 0,
        page,
        pageSize,
      ),
    );
  }),
);

jobsRouter.post(
  '/:id/retry',
  requireEditor,
  asyncHandler(async (req, res) => {
    const owned = await queryOne<{ id: string }>(
      `SELECT j.id FROM video_jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = $1 AND p.user_id = $2`,
      [req.params.id!, req.user!.id],
    );
    if (!owned) throw new NotFoundError('Job');

    const job = await retryJob(req.params.id!);
    await audit('job.retried', contextFromRequest(req), 'video_job', req.params.id!);
    res.json({ ok: true, job: job ? { id: job.id, status: job.status } : null });
  }),
);

jobsRouter.post(
  '/:id/cancel',
  requireEditor,
  asyncHandler(async (req, res) => {
    const owned = await queryOne<{ id: string }>(
      `SELECT j.id FROM video_jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = $1 AND p.user_id = $2`,
      [req.params.id!, req.user!.id],
    );
    if (!owned) throw new NotFoundError('Job');

    await cancelJob(req.params.id!);
    await audit('job.cancelled', contextFromRequest(req), 'video_job', req.params.id!);
    res.json({ ok: true });
  }),
);

jobsRouter.post(
  '/publishing/:postId/retry',
  requireEditor,
  asyncHandler(async (req, res) => {
    const owned = await queryOne<{ id: string }>(
      `SELECT sp.id FROM social_posts sp
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = v.project_id
       WHERE sp.id = $1 AND p.user_id = $2`,
      [req.params.postId!, req.user!.id],
    );
    if (!owned) throw new NotFoundError('Veroeffentlichung');

    await retryPost(req.params.postId!);
    await audit('job.retried', contextFromRequest(req), 'social_post', req.params.postId!);
    res.json({ ok: true });
  }),
);
