import { Router } from 'express';
import { z } from 'zod';
import { query, queryMany, queryOne } from '../db/pool.js';
import { requireInternalKey } from '../middleware/internal-auth.js';
import { validateBody } from '../middleware/validate.js';
import { writeLog } from '../services/log-store.js';
import { startPipeline } from '../services/pipeline.js';
import { schedulePendingPosts } from '../services/publisher.js';
import { parseProjectSettings, type ProjectRow, type VideoRow } from '../services/types.js';
import { NotFoundError } from '../utils/errors.js';
import { asyncHandler } from '../utils/http.js';

export const automationRouter: Router = Router();

automationRouter.use(requireInternalKey);

const ideaSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  topic: z.string().max(500).default(''),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(40)).max(20).default([]),
  score: z.number().int().min(0).max(100).default(0),
  source: z.string().max(60).default('n8n'),
});

const videoSchema = z.object({
  projectId: z.string().uuid(),
  ideaId: z.string().uuid().nullable().default(null),
  title: z.string().min(1).max(200),
  topic: z.string().max(500).default(''),
  description: z.string().max(5000).default(''),
  format: z
    .enum(['youtube_video', 'youtube_short', 'tiktok', 'instagram_reel', 'facebook_reel'])
    .optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']).optional(),
  durationSec: z.number().int().min(5).max(3600).optional(),
  style: z.string().max(60).optional(),
  language: z.enum(['de', 'en', 'es', 'fr', 'it']).optional(),
  startNow: z.boolean().default(true),
});

automationRouter.get(
  '/projects',
  asyncHandler(async (_req, res) => {
    const rows = await queryMany<ProjectRow>(
      'SELECT * FROM projects WHERE archived_at IS NULL ORDER BY created_at DESC',
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        language: row.language,
        style: row.style,
        platforms: row.platforms,
        requireApproval: row.require_approval,
        defaultFormat: row.default_format,
        defaultAspect: row.default_aspect,
        defaultDurationSec: row.default_duration_sec,
        settings: parseProjectSettings(row.settings),
      })),
    });
  }),
);

automationRouter.get(
  '/ideas',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status ?? 'new');
    const limit = Math.min(100, Number.parseInt(String(req.query.limit ?? '20'), 10) || 20);
    const projectId = req.query.projectId ? String(req.query.projectId) : null;

    const rows = await queryMany(
      `SELECT id, project_id, title, topic, description, tags, status, score
       FROM ideas
       WHERE status = $1 ${projectId ? 'AND project_id = $3' : ''}
       ORDER BY score DESC, created_at
       LIMIT $2`,
      projectId ? [status, limit, projectId] : [status, limit],
    );
    res.json({ items: rows });
  }),
);

automationRouter.post(
  '/ideas',
  validateBody(ideaSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof ideaSchema>;
    const project = await queryOne<{ user_id: string }>('SELECT user_id FROM projects WHERE id = $1', [body.projectId]);
    if (!project) throw new NotFoundError('Projekt');

    const row = await queryOne<{ id: string }>(
      `INSERT INTO ideas (project_id, user_id, title, topic, description, tags, score, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        body.projectId,
        project.user_id,
        body.title,
        body.topic,
        body.description,
        body.tags,
        body.score,
        body.source,
      ],
    );
    await writeLog('info', 'automation', `Neue Idee ueber Automatisierung: ${body.title}`, { ideaId: row?.id });
    res.status(201).json({ id: row?.id });
  }),
);

automationRouter.post(
  '/videos',
  validateBody(videoSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof videoSchema>;
    const project = await queryOne<ProjectRow>('SELECT * FROM projects WHERE id = $1', [body.projectId]);
    if (!project) throw new NotFoundError('Projekt');

    const video = await queryOne<VideoRow>(
      `INSERT INTO videos
         (project_id, idea_id, title, topic, description, language, style, format,
          aspect_ratio, duration_sec, require_approval, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT')
       RETURNING *`,
      [
        project.id,
        body.ideaId,
        body.title,
        body.topic || body.title,
        body.description,
        body.language ?? project.language,
        body.style ?? project.style,
        body.format ?? project.default_format,
        body.aspectRatio ?? project.default_aspect,
        body.durationSec ?? project.default_duration_sec,
        project.require_approval,
      ],
    );
    if (!video) throw new Error('Video konnte nicht angelegt werden');

    if (body.ideaId) await query(`UPDATE ideas SET status = 'used' WHERE id = $1`, [body.ideaId]);
    if (body.startNow) await startPipeline(video.id);

    await writeLog('info', 'automation', `Video ueber Automatisierung erstellt: ${video.title}`, {
      videoId: video.id,
      startNow: body.startNow,
    });

    res.status(201).json({ id: video.id, status: body.startNow ? 'QUEUED' : 'DRAFT' });
  }),
);

automationRouter.post(
  '/videos/:id/generate',
  asyncHandler(async (req, res) => {
    const video = await queryOne<VideoRow>('SELECT * FROM videos WHERE id = $1', [req.params.id!]);
    if (!video) throw new NotFoundError('Video');
    await startPipeline(video.id);
    res.json({ ok: true });
  }),
);

automationRouter.get(
  '/videos/:id',
  asyncHandler(async (req, res) => {
    const video = await queryOne<VideoRow>('SELECT * FROM videos WHERE id = $1', [req.params.id!]);
    if (!video) throw new NotFoundError('Video');

    const jobs = await queryMany('SELECT id, type, status, progress, error FROM video_jobs WHERE video_id = $1', [
      video.id,
    ]);
    const posts = await queryMany(
      'SELECT id, platform, status, scheduled_at, published_at, external_url, error FROM social_posts WHERE video_id = $1',
      [video.id],
    );

    res.json({
      id: video.id,
      title: video.title,
      status: video.status,
      progress: video.progress,
      requireApproval: video.require_approval,
      approvedAt: video.approved_at,
      finalMediaId: video.final_media_id,
      error: video.error,
      jobs,
      posts,
    });
  }),
);

automationRouter.post(
  '/videos/:id/publish',
  asyncHandler(async (req, res) => {
    const video = await queryOne<VideoRow>('SELECT * FROM videos WHERE id = $1', [req.params.id!]);
    if (!video) throw new NotFoundError('Video');

    if (video.require_approval && !video.approved_at) {
      res.status(409).json({
        error: {
          code: 'approval_required',
          message: 'Das Video wurde noch nicht freigegeben. Automatische Veroeffentlichung ist blockiert.',
        },
      });
      return;
    }

    const scheduled = await schedulePendingPosts(video.id);
    res.json({ ok: true, scheduledPosts: scheduled });
  }),
);
