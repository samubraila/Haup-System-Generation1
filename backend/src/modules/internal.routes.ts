import { Router, json, raw } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { query, queryOne } from '../db/pool.js';
import { requireInternalKey } from '../middleware/internal-auth.js';
import { validateBody } from '../middleware/validate.js';
import { writeLog } from '../services/log-store.js';
import { advancePipeline, setVideoStatus } from '../services/pipeline.js';
import { syncVideoPublishState } from '../services/publisher.js';
import { markAccountError, resolveCredentials, storeRefreshedTokens } from '../services/social/accounts.js';
import { openFileStream, statFile, writeStorageFile } from '../services/storage.js';
import type { VideoJobRow } from '../services/types.js';
import { events } from '../utils/events.js';
import { ownerOfVideo } from '../services/ownership.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { asyncHandler } from '../utils/http.js';

export const internalRouter: Router = Router();

internalRouter.use(requireInternalKey);
internalRouter.use(json({ limit: '2mb' }));

const progressSchema = z.object({
  progress: z.number().min(0).max(100),
  message: z.string().max(500).optional(),
  workerId: z.string().max(200).optional(),
  etaSeconds: z.number().int().min(0).nullable().optional(),
});

const startedSchema = z.object({
  workerId: z.string().max(200),
  meta: z.record(z.unknown()).default({}),
});

const completedSchema = z.object({
  workerId: z.string().max(200),
  result: z.record(z.unknown()).default({}),
});

const failedSchema = z.object({
  workerId: z.string().max(200),
  error: z.string().max(4000),
  willRetry: z.boolean().default(false),
});

const statusSchema = z.object({
  workerId: z.string().max(200),
  status: z.enum(['PENDING', 'WAITING_FOR_GPU', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  reason: z.string().max(500).optional(),
});

const logSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  source: z.string().max(120),
  message: z.string().max(4000),
  context: z.record(z.unknown()).default({}),
});

const mediaSchema = z.object({
  projectId: z.string().uuid(),
  videoId: z.string().uuid().nullable().optional(),
  kind: z.enum(['image', 'audio', 'video', 'subtitle', 'thumbnail', 'script', 'other']),
  path: z.string().min(1).max(500),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(120).default('application/octet-stream'),
  sizeBytes: z.number().int().min(0).default(0),
  durationMs: z.number().int().min(0).nullable().optional(),
  width: z.number().int().min(0).nullable().optional(),
  height: z.number().int().min(0).nullable().optional(),
  meta: z.record(z.unknown()).default({}),
});

const tokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

const accountErrorSchema = z.object({
  error: z.string().max(1000),
  requiresReconnect: z.boolean().default(false),
});

const analyticsSchema = z.object({
  postId: z.string().uuid(),
  platform: z.string().max(40),
  views: z.number().int().min(0).default(0),
  likes: z.number().int().min(0).default(0),
  comments: z.number().int().min(0).default(0),
  shares: z.number().int().min(0).default(0),
  followersGained: z.number().int().min(0).default(0),
  watchTimeSec: z.number().int().min(0).default(0),
  raw: z.record(z.unknown()).default({}),
});

type JobKind = 'video' | 'publishing';

async function findJob(jobId: string): Promise<{ kind: JobKind; row: Record<string, unknown> } | null> {
  const videoJob = await queryOne<VideoJobRow>('SELECT * FROM video_jobs WHERE id = $1', [jobId]);
  if (videoJob) return { kind: 'video', row: videoJob as unknown as Record<string, unknown> };

  const publishJob = await queryOne<{
    id: string;
    social_post_id: string;
    platform: string;
    attempts: number;
  }>('SELECT * FROM publishing_jobs WHERE id = $1', [jobId]);
  if (publishJob) return { kind: 'publishing', row: publishJob as unknown as Record<string, unknown> };

  return null;
}

internalRouter.post(
  '/jobs/:id/started',
  validateBody(startedSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof startedSchema>;
    const job = await findJob(req.params.id!);
    if (!job) throw new NotFoundError('Job');

    if (job.kind === 'video') {
      await query(
        `UPDATE video_jobs SET status = 'RUNNING', worker_id = $2, started_at = COALESCE(started_at, now()),
                attempts = attempts + 1, error = NULL, status_reason = NULL
         WHERE id = $1`,
        [req.params.id!, body.workerId],
      );
      const videoId = job.row.video_id as string | null;
      if (videoId) {
        const type = job.row.type as string;
        await setVideoStatus(videoId, type === 'ffmpeg' ? 'PROCESSING' : 'GENERATING');
      }
    } else {
      await query(
        `UPDATE publishing_jobs SET status = 'RUNNING', worker_id = $2, started_at = COALESCE(started_at, now()),
                attempts = attempts + 1, error = NULL
         WHERE id = $1`,
        [req.params.id!, body.workerId],
      );
      await query(`UPDATE social_posts SET status = 'processing' WHERE id = $1`, [job.row.social_post_id as string]);
    }

    res.json({ ok: true });
  }),
);

internalRouter.post(
  '/jobs/:id/progress',
  validateBody(progressSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof progressSchema>;
    const job = await findJob(req.params.id!);
    if (!job) throw new NotFoundError('Job');

    if (job.kind === 'video') {
      await query('UPDATE video_jobs SET progress = $2, eta_seconds = COALESCE($3, eta_seconds) WHERE id = $1', [
        req.params.id!,
        Math.round(body.progress),
        body.etaSeconds ?? null,
      ]);
      const videoId = job.row.video_id as string | null;
      events.publish(
        {
          type: 'job.updated',
          jobId: req.params.id!,
          videoId,
          status: 'RUNNING',
          progress: Math.round(body.progress),
          queue: String(job.row.queue ?? ''),
        },
        await ownerOfVideo(videoId),
      );
      if (videoId) {
        await query('UPDATE videos SET progress = GREATEST(progress, $2) WHERE id = $1', [
          videoId,
          Math.min(95, Math.round(body.progress)),
        ]);
      }
    } else {
      await query('UPDATE publishing_jobs SET progress = $2 WHERE id = $1', [
        req.params.id!,
        Math.round(body.progress),
      ]);
    }

    res.json({ ok: true });
  }),
);

internalRouter.post(
  '/jobs/:id/status',
  validateBody(statusSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof statusSchema>;
    const job = await findJob(req.params.id!);
    if (!job) throw new NotFoundError('Job');

    if (job.kind === 'video') {
      await query('UPDATE video_jobs SET status = $2, status_reason = $3 WHERE id = $1', [
        req.params.id!,
        body.status,
        body.reason ?? null,
      ]);
      const videoId = job.row.video_id as string | null;
      if (videoId && body.status === 'WAITING_FOR_GPU') {
        await setVideoStatus(videoId, 'WAITING_FOR_GPU');
        await writeLog('warn', 'gpu', body.reason ?? 'Job wartet auf eine verfuegbare GPU', {
          jobId: req.params.id!,
          videoId,
        });
      }
    }

    res.json({ ok: true });
  }),
);

async function applyVideoJobResult(job: VideoJobRow, result: Record<string, unknown>): Promise<void> {
  const videoId = job.video_id;
  if (!videoId) return;

  switch (job.type) {
    case 'script': {
      const scenes = Array.isArray(result.scenes) ? result.scenes : [];
      const script = await queryOne<{ id: string }>(
        `INSERT INTO scripts (project_id, video_id, title, hook, body, scenes, language,
                              word_count, estimated_duration_sec, provider)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          job.project_id,
          videoId,
          String(result.title ?? ''),
          String(result.hook ?? ''),
          String(result.body ?? ''),
          JSON.stringify(scenes),
          String(result.language ?? 'de'),
          Number(result.wordCount ?? 0),
          Number(result.estimatedDurationSec ?? 0),
          String(result.provider ?? 'template'),
        ],
      );
      if (script) await query('UPDATE videos SET script_id = $2 WHERE id = $1', [videoId, script.id]);
      break;
    }
    case 'voice': {
      if (result.mediaId) await query('UPDATE videos SET audio_media_id = $2 WHERE id = $1', [videoId, String(result.mediaId)]);
      break;
    }
    case 'subtitle': {
      if (result.mediaId) await query('UPDATE videos SET subtitle_media_id = $2 WHERE id = $1', [videoId, String(result.mediaId)]);
      break;
    }
    case 'ffmpeg': {
      if (result.finalMediaId) {
        await query('UPDATE videos SET final_media_id = $2 WHERE id = $1', [videoId, String(result.finalMediaId)]);
      }
      if (result.thumbnailMediaId) {
        await query('UPDATE videos SET thumbnail_media_id = $2 WHERE id = $1', [videoId, String(result.thumbnailMediaId)]);
      }
      break;
    }
    case 'video': {
      if (result.mediaId && !(await queryOne('SELECT source_media_id FROM videos WHERE id = $1 AND source_media_id IS NOT NULL', [videoId]))) {
        await query('UPDATE videos SET source_media_id = $2 WHERE id = $1', [videoId, String(result.mediaId)]);
      }
      break;
    }
    default:
      break;
  }
}

internalRouter.post(
  '/jobs/:id/completed',
  validateBody(completedSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof completedSchema>;
    const job = await findJob(req.params.id!);
    if (!job) throw new NotFoundError('Job');

    if (job.kind === 'video') {
      const row = job.row as unknown as VideoJobRow;
      await query(
        `UPDATE video_jobs SET status = 'COMPLETED', progress = 100, result = $2,
                finished_at = now(), error = NULL, status_reason = NULL, worker_id = $3
         WHERE id = $1`,
        [row.id, JSON.stringify(body.result), body.workerId],
      );

      await applyVideoJobResult(row, body.result);

      events.publish(
        { type: 'job.updated', jobId: row.id, videoId: row.video_id, status: 'COMPLETED', progress: 100, queue: row.queue },
        await ownerOfVideo(row.video_id),
      );

      if (row.video_id) await advancePipeline(row.video_id);
    } else {
      const postId = job.row.social_post_id as string;
      await query(
        `UPDATE publishing_jobs SET status = 'COMPLETED', progress = 100, result = $2, finished_at = now(), worker_id = $3
         WHERE id = $1`,
        [req.params.id!, JSON.stringify(body.result), body.workerId],
      );
      await query(
        `UPDATE social_posts SET status = 'published', published_at = now(),
                external_post_id = $2, external_url = $3, error = NULL, requires_reconnect = FALSE
         WHERE id = $1`,
        [postId, String(body.result.externalPostId ?? ''), String(body.result.externalUrl ?? '')],
      );

      const post = await queryOne<{ video_id: string; platform: string }>(
        'SELECT video_id, platform FROM social_posts WHERE id = $1',
        [postId],
      );
      if (post) {
        events.publish(
          { type: 'post.updated', postId, videoId: post.video_id, platform: post.platform, status: 'published' },
          await ownerOfVideo(post.video_id),
        );
        await syncVideoPublishState(post.video_id);
        await writeLog('info', 'publisher', `Veroeffentlicht auf ${post.platform}`, {
          postId,
          url: body.result.externalUrl ?? null,
        });
      }
    }

    res.json({ ok: true });
  }),
);

internalRouter.post(
  '/jobs/:id/failed',
  validateBody(failedSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof failedSchema>;
    const job = await findJob(req.params.id!);
    if (!job) throw new NotFoundError('Job');

    const status = body.willRetry ? 'PENDING' : 'FAILED';

    if (job.kind === 'video') {
      const row = job.row as unknown as VideoJobRow;
      await query(
        `UPDATE video_jobs SET status = $2, error = $3, worker_id = $4,
                finished_at = CASE WHEN $2 = 'FAILED' THEN now() ELSE NULL END
         WHERE id = $1`,
        [row.id, status, body.error, body.workerId],
      );

      events.publish(
        { type: 'job.updated', jobId: row.id, videoId: row.video_id, status, progress: row.progress, queue: row.queue },
        await ownerOfVideo(row.video_id),
      );

      await writeLog(body.willRetry ? 'warn' : 'error', row.queue, `Job fehlgeschlagen: ${body.error}`, {
        jobId: row.id,
        videoId: row.video_id,
        willRetry: body.willRetry,
      });

      if (!body.willRetry && row.video_id) {
        await setVideoStatus(row.video_id, 'FAILED', { error: body.error });
      }
    } else {
      const postId = job.row.social_post_id as string;
      await query(
        `UPDATE publishing_jobs SET status = $2, error = $3, worker_id = $4,
                finished_at = CASE WHEN $2 = 'FAILED' THEN now() ELSE NULL END
         WHERE id = $1`,
        [req.params.id!, status, body.error, body.workerId],
      );
      if (!body.willRetry) {
        await query(`UPDATE social_posts SET status = 'failed', error = $2 WHERE id = $1`, [postId, body.error]);
        const post = await queryOne<{ video_id: string; platform: string }>(
          'SELECT video_id, platform FROM social_posts WHERE id = $1',
          [postId],
        );
        if (post) {
          events.publish(
            { type: 'post.updated', postId, videoId: post.video_id, platform: post.platform, status: 'failed' },
            await ownerOfVideo(post.video_id),
          );
          await syncVideoPublishState(post.video_id);
        }
      }
      await writeLog(body.willRetry ? 'warn' : 'error', 'publisher', `Upload fehlgeschlagen: ${body.error}`, {
        postId,
        willRetry: body.willRetry,
      });
    }

    res.json({ ok: true });
  }),
);

internalRouter.post(
  '/logs',
  validateBody(logSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof logSchema>;
    await writeLog(body.level, body.source, body.message, body.context);
    res.status(204).end();
  }),
);

internalRouter.post(
  '/media',
  validateBody(mediaSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof mediaSchema>;
    const row = await queryOne<{ id: string }>(
      `INSERT INTO media (project_id, video_id, kind, path, file_name, mime_type, size_bytes,
                          duration_ms, width, height, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (path) DO UPDATE SET
         size_bytes = EXCLUDED.size_bytes,
         duration_ms = EXCLUDED.duration_ms,
         width = EXCLUDED.width,
         height = EXCLUDED.height,
         meta = EXCLUDED.meta
       RETURNING id`,
      [
        body.projectId,
        body.videoId ?? null,
        body.kind,
        body.path,
        body.fileName,
        body.mimeType,
        body.sizeBytes,
        body.durationMs ?? null,
        body.width ?? null,
        body.height ?? null,
        JSON.stringify(body.meta),
      ],
    );
    res.status(201).json({ id: row?.id });
  }),
);

internalRouter.get(
  '/social-accounts/:id/credentials',
  asyncHandler(async (req, res) => {
    const credentials = await resolveCredentials(req.params.id!);
    res.json(credentials);
  }),
);

internalRouter.post(
  '/social-accounts/:id/tokens',
  validateBody(tokensSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof tokensSchema>;
    await storeRefreshedTokens(req.params.id!, {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken ?? null,
      expiresAt: body.expiresAt ?? null,
    });
    res.json({ ok: true });
  }),
);

internalRouter.post(
  '/social-accounts/:id/error',
  validateBody(accountErrorSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof accountErrorSchema>;
    await markAccountError(req.params.id!, body.error, body.requiresReconnect);
    res.json({ ok: true });
  }),
);

internalRouter.post(
  '/analytics',
  validateBody(analyticsSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof analyticsSchema>;
    const engagement = body.views > 0 ? ((body.likes + body.comments + body.shares) / body.views) * 100 : 0;
    await query(
      `INSERT INTO analytics (social_post_id, platform, views, likes, comments, shares,
                              followers_gained, watch_time_sec, engagement_rate, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        body.postId,
        body.platform,
        body.views,
        body.likes,
        body.comments,
        body.shares,
        body.followersGained,
        body.watchTimeSec,
        Number(engagement.toFixed(3)),
        JSON.stringify(body.raw),
      ],
    );
    res.status(201).json({ ok: true });
  }),
);

internalRouter.get(
  '/files',
  asyncHandler(async (req, res) => {
    const relativePath = String(req.query.path ?? '');
    if (!relativePath) throw new BadRequestError('Parameter "path" fehlt');
    const file = await statFile(relativePath);
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', String(file.size));
    openFileStream(file.absolute).pipe(res);
  }),
);

internalRouter.put(
  '/files',
  raw({ type: '*/*', limit: `${config.MAX_UPLOAD_MB}mb` }),
  asyncHandler(async (req, res) => {
    const relativePath = String(req.query.path ?? '');
    if (!relativePath) throw new BadRequestError('Parameter "path" fehlt');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new BadRequestError('Leerer Datei-Upload');
    }
    await writeStorageFile(relativePath, req.body);
    res.status(201).json({ ok: true, path: relativePath, sizeBytes: req.body.length });
  }),
);
