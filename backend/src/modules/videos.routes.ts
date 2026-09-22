import { Router } from 'express';
import { z } from 'zod';
import { query, queryMany, queryOne, transaction } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { audit, contextFromRequest } from '../services/audit.js';
import { writeLog } from '../services/log-store.js';
import {
  advancePipeline,
  cancelVideoJobs,
  loadProject,
  plannedStages,
  setVideoStatus,
  stageLabel,
  startPipeline,
} from '../services/pipeline.js';
import { cancelPost, enqueuePublishJob, schedulePendingPosts, selectRenderForPlatform } from '../services/publisher.js';
import { accountForPlatform } from '../services/social/accounts.js';
import { parseProjectSettings, type MediaRow, type ProjectRow, type SocialPostRow, type VideoJobRow, type VideoRow } from '../services/types.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors.js';
import { asyncHandler, paged, readPagination } from '../utils/http.js';

export const videosRouter: Router = Router();

const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook'] as const;

const createSchema = z.object({
  projectId: z.string().uuid(),
  ideaId: z.string().uuid().nullable().default(null),
  title: z.string().min(1).max(200),
  topic: z.string().max(500).default(''),
  description: z.string().max(5000).default(''),
  format: z.enum(['youtube_video', 'youtube_short', 'tiktok', 'instagram_reel', 'facebook_reel']),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']),
  durationSec: z.number().int().min(5).max(3600),
  style: z.string().min(1).max(60),
  language: z.enum(['de', 'en', 'es', 'fr', 'it']),
  requireApproval: z.boolean().optional(),
  startNow: z.boolean().default(true),
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  topic: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  style: z.string().max(60).optional(),
  requireApproval: z.boolean().optional(),
});

const publishTargetSchema = z.object({
  platform: z.enum(PLATFORMS),
  enabled: z.boolean().default(true),
  accountId: z.string().uuid().nullable().default(null),
  title: z.string().max(200).default(''),
  description: z.string().max(5000).default(''),
  hashtags: z.array(z.string().max(60)).max(30).default([]),
  tags: z.array(z.string().max(60)).max(30).default([]),
  privacy: z.enum(['public', 'unlisted', 'private']).default('private'),
  scheduledAt: z.string().datetime().nullable().default(null),
});

const publishSchema = z.object({
  mode: z.enum(['now', 'schedule', 'draft']),
  targets: z.array(publishTargetSchema).min(1),
});

function videoToApi(row: VideoRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    ideaId: row.idea_id,
    scriptId: row.script_id,
    title: row.title,
    topic: row.topic,
    description: row.description,
    language: row.language,
    style: row.style,
    format: row.format,
    aspectRatio: row.aspect_ratio,
    durationSec: row.duration_sec,
    status: row.status,
    progress: row.progress,
    requireApproval: row.require_approval,
    error: row.error,
    meta: row.meta,
    finalMediaId: row.final_media_id,
    thumbnailMediaId: row.thumbnail_media_id,
    subtitleMediaId: row.subtitle_media_id,
    audioMediaId: row.audio_media_id,
    generatedAt: row.generated_at,
    approvedAt: row.approved_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jobToApi(row: VideoJobRow) {
  return {
    id: row.id,
    videoId: row.video_id,
    type: row.type,
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
    label: stageLabel(row.type as 'script' | 'video' | 'voice' | 'subtitle' | 'ffmpeg'),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function postToApi(row: SocialPostRow) {
  return {
    id: row.id,
    videoId: row.video_id,
    platform: row.platform,
    accountId: row.social_account_id,
    title: row.title,
    description: row.description,
    hashtags: row.hashtags,
    tags: row.tags,
    privacy: row.privacy,
    status: row.status,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    externalUrl: row.external_url,
    error: row.error,
    requiresReconnect: row.requires_reconnect,
  };
}

async function loadVideoOwned(videoId: string, userId: string): Promise<{ video: VideoRow; project: ProjectRow }> {
  const video = await queryOne<VideoRow>(
    `SELECT v.* FROM videos v JOIN projects p ON p.id = v.project_id
     WHERE v.id = $1 AND p.user_id = $2`,
    [videoId, userId],
  );
  if (!video) throw new NotFoundError('Video');
  const project = await loadProject(video.project_id);
  if (!project) throw new NotFoundError('Projekt');
  return { video, project };
}

videosRouter.use(requireAuth);

videosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 24);
    const filters: string[] = ['p.user_id = $1'];
    const params: Array<string | number> = [req.user!.id];
    let index = 2;

    if (req.query.projectId) {
      filters.push(`v.project_id = $${index++}`);
      params.push(String(req.query.projectId));
    }
    if (req.query.status) {
      const statuses = String(req.query.status).split(',').filter(Boolean);
      filters.push(`v.status = ANY($${index++})`);
      params.push(statuses as unknown as string);
    }
    if (req.query.q) {
      filters.push(`(v.title ILIKE $${index} OR v.topic ILIKE $${index} OR v.description ILIKE $${index})`);
      params.push(`%${String(req.query.q)}%`);
      index++;
    }
    if (req.query.language) {
      filters.push(`v.language = $${index++}`);
      params.push(String(req.query.language));
    }
    if (req.query.from) {
      filters.push(`v.created_at >= $${index++}`);
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      filters.push(`v.created_at <= $${index++}`);
      params.push(String(req.query.to));
    }
    if (req.query.platform) {
      filters.push(
        `EXISTS (SELECT 1 FROM social_posts sp WHERE sp.video_id = v.id AND sp.platform = $${index++})`,
      );
      params.push(String(req.query.platform));
    }

    const where = filters.join(' AND ');
    const totalRow = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM videos v JOIN projects p ON p.id = v.project_id WHERE ${where}`,
      params,
    );

    const rows = await queryMany<VideoRow & { project_name: string; platforms: string[] }>(
      `SELECT v.*, p.name AS project_name,
              COALESCE(ARRAY(SELECT DISTINCT sp.platform FROM social_posts sp WHERE sp.video_id = v.id), '{}') AS platforms
       FROM videos v JOIN projects p ON p.id = v.project_id
       WHERE ${where}
       ORDER BY v.created_at DESC
       LIMIT $${index++} OFFSET $${index++}`,
      [...params, pageSize, offset],
    );

    res.json(
      paged(
        rows.map((row) => ({ ...videoToApi(row), projectName: row.project_name, platforms: row.platforms })),
        totalRow?.count ?? 0,
        page,
        pageSize,
      ),
    );
  }),
);

videosRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { video, project } = await loadVideoOwned(req.params.id!, req.user!.id);

    const [jobs, media, posts, script] = await Promise.all([
      queryMany<VideoJobRow>('SELECT * FROM video_jobs WHERE video_id = $1 ORDER BY step_index, created_at', [
        video.id,
      ]),
      queryMany<MediaRow>('SELECT * FROM media WHERE video_id = $1 ORDER BY created_at', [video.id]),
      queryMany<SocialPostRow>('SELECT * FROM social_posts WHERE video_id = $1 ORDER BY platform', [video.id]),
      video.script_id
        ? queryOne('SELECT id, title, hook, body, scenes, word_count, estimated_duration_sec, provider FROM scripts WHERE id = $1', [
            video.script_id,
          ])
        : Promise.resolve(null),
    ]);

    res.json({
      ...videoToApi(video),
      project: { id: project.id, name: project.name, settings: parseProjectSettings(project.settings) },
      pipeline: plannedStages(project, video, Boolean(video.script_id)).map((stage) => ({
        stage,
        label: stageLabel(stage),
        status: jobs.filter((j) => j.type === stage).at(-1)?.status ?? 'PENDING',
      })),
      jobs: jobs.map(jobToApi),
      media: media.map((m) => ({
        id: m.id,
        kind: m.kind,
        path: m.path,
        fileName: m.file_name,
        mimeType: m.mime_type,
        sizeBytes: m.size_bytes,
        durationMs: m.duration_ms,
        width: m.width,
        height: m.height,
        meta: m.meta,
        createdAt: m.created_at,
      })),
      posts: posts.map(postToApi),
      script,
    });
  }),
);

videosRouter.post(
  '/',
  requireEditor,
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const project = await queryOne<ProjectRow>('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [
      body.projectId,
      req.user!.id,
    ]);
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
        body.language,
        body.style,
        body.format,
        body.aspectRatio,
        body.durationSec,
        body.requireApproval ?? project.require_approval,
      ],
    );
    if (!video) throw new Error('Video konnte nicht angelegt werden');

    if (body.ideaId) {
      await query(`UPDATE ideas SET status = 'used' WHERE id = $1 AND user_id = $2 AND project_id = $3`, [
        body.ideaId,
        req.user!.id,
        project.id,
      ]);
    }

    await audit('video.created', contextFromRequest(req), 'video', video.id, { title: video.title });

    if (body.startNow) {
      await startPipeline(video.id);
      await audit('video.generate', contextFromRequest(req), 'video', video.id);
    }

    const fresh = await queryOne<VideoRow>('SELECT * FROM videos WHERE id = $1', [video.id]);
    res.status(201).json(videoToApi(fresh!));
  }),
);

videosRouter.patch(
  '/:id',
  requireEditor,
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    const body = req.body as z.infer<typeof patchSchema>;

    const row = await queryOne<VideoRow>(
      `UPDATE videos SET
         title = COALESCE($2, title),
         topic = COALESCE($3, topic),
         description = COALESCE($4, description),
         style = COALESCE($5, style),
         require_approval = COALESCE($6, require_approval)
       WHERE id = $1 RETURNING *`,
      [
        video.id,
        body.title ?? null,
        body.topic ?? null,
        body.description ?? null,
        body.style ?? null,
        body.requireApproval ?? null,
      ],
    );
    res.json(videoToApi(row!));
  }),
);

videosRouter.post(
  '/:id/generate',
  requireEditor,
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    if (['GENERATING', 'PROCESSING', 'QUEUED'].includes(video.status)) {
      throw new ConflictError('Fuer dieses Video laeuft bereits eine Generierung');
    }
    await startPipeline(video.id);
    await audit('video.generate', contextFromRequest(req), 'video', video.id);
    res.json({ ok: true, status: 'QUEUED' });
  }),
);

videosRouter.post(
  '/:id/stop',
  requireEditor,
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    await cancelVideoJobs(video.id);
    await setVideoStatus(video.id, 'DRAFT', { error: 'Vom Benutzer gestoppt' });
    await audit('job.cancelled', contextFromRequest(req), 'video', video.id);
    res.json({ ok: true });
  }),
);

videosRouter.post(
  '/:id/regenerate',
  requireEditor,
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    const keepScript = req.query.keepScript !== 'false';

    await cancelVideoJobs(video.id);
    await transaction(async (client) => {
      await client.query(
        `UPDATE videos SET source_media_id = NULL, audio_media_id = NULL, subtitle_media_id = NULL,
                           final_media_id = NULL, thumbnail_media_id = NULL, progress = 0, error = NULL,
                           status = 'DRAFT', approved_at = NULL, approved_by = NULL, published_at = NULL
         WHERE id = $1`,
        [video.id],
      );
      await client.query(
        `UPDATE social_posts SET status = 'draft', scheduled_at = NULL, media_id = NULL
         WHERE video_id = $1 AND status IN ('scheduled', 'queued', 'failed')`,
        [video.id],
      );
      await client.query(`DELETE FROM media WHERE video_id = $1 AND kind <> 'script'`, [video.id]);
      await client.query('DELETE FROM video_jobs WHERE video_id = $1', [video.id]);
      if (!keepScript) {
        await client.query('UPDATE videos SET script_id = NULL WHERE id = $1', [video.id]);
        await client.query('DELETE FROM scripts WHERE video_id = $1', [video.id]);
      }
    });

    await startPipeline(video.id);
    await audit('video.regenerate', contextFromRequest(req), 'video', video.id, { keepScript });
    res.json({ ok: true });
  }),
);

videosRouter.post(
  '/:id/approve',
  requireEditor,
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    if (!video.final_media_id) {
      throw new ConflictError('Das Video ist noch nicht fertig gerendert und kann nicht freigegeben werden');
    }

    await query(`UPDATE videos SET status = 'APPROVED', approved_at = now(), approved_by = $2 WHERE id = $1`, [
      video.id,
      req.user!.id,
    ]);
    await audit('video.approved', contextFromRequest(req), 'video', video.id);

    const scheduled = await schedulePendingPosts(video.id);
    await writeLog('info', 'approval', `Video freigegeben: ${video.title}`, { videoId: video.id, scheduled });

    res.json({ ok: true, status: 'APPROVED', scheduledPosts: scheduled });
  }),
);

videosRouter.post(
  '/:id/reject',
  requireEditor,
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : 'Abgelehnt';
    await query(`UPDATE videos SET status = 'DRAFT', approved_at = NULL, approved_by = NULL, error = $2 WHERE id = $1`, [
      video.id,
      reason,
    ]);
    await audit('video.rejected', contextFromRequest(req), 'video', video.id, { reason });
    res.json({ ok: true });
  }),
);

videosRouter.put(
  '/:id/publish',
  requireEditor,
  validateBody(publishSchema),
  asyncHandler(async (req, res) => {
    const { video, project } = await loadVideoOwned(req.params.id!, req.user!.id);
    const body = req.body as z.infer<typeof publishSchema>;
    const settings = parseProjectSettings(project.settings);

    const results: Array<{ platform: string; status: string; message?: string }> = [];

    for (const target of body.targets) {
      if (!target.enabled) {
        const result = await query(
          `UPDATE social_posts SET status = 'cancelled'
           WHERE video_id = $1 AND platform = $2 AND status <> 'published'`,
          [video.id, target.platform],
        );
        results.push({
          platform: target.platform,
          status: result.rowCount ? 'disabled' : 'already_published',
        });
        continue;
      }

      const account = target.accountId
        ? await queryOne<{ id: string }>('SELECT id FROM social_accounts WHERE id = $1 AND user_id = $2', [
            target.accountId,
            req.user!.id,
          ])
        : await accountForPlatform(req.user!.id, target.platform);

      if (!account) {
        results.push({
          platform: target.platform,
          status: 'not_connected',
          message: `Fuer ${target.platform} ist kein Konto verbunden`,
        });
        continue;
      }

      const scheduledAt =
        body.mode === 'schedule' ? (target.scheduledAt ? new Date(target.scheduledAt) : null) : null;
      if (body.mode === 'schedule' && !scheduledAt) {
        throw new BadRequestError(`Fuer ${target.platform} fehlt der geplante Veroeffentlichungszeitpunkt`);
      }

      const status = body.mode === 'draft' ? 'draft' : 'scheduled';
      const render = await selectRenderForPlatform(video.id, target.platform);

      const existing = await queryOne<SocialPostRow>(
        'SELECT * FROM social_posts WHERE video_id = $1 AND platform = $2',
        [video.id, target.platform],
      );

      const hashtags = target.hashtags.length > 0 ? target.hashtags : settings.hashtagPresets;
      const title = target.title || video.title;
      const description = target.description || video.description;
      const privacy = target.privacy || settings.defaultPrivacy;

      if (existing && existing.status === 'published') {
        results.push({ platform: target.platform, status: 'already_published' });
        continue;
      }

      const post = existing
        ? await queryOne<SocialPostRow>(
            `UPDATE social_posts SET social_account_id = $2, title = $3, description = $4, hashtags = $5,
                    tags = $6, privacy = $7, status = $8, scheduled_at = $9, media_id = $10, error = NULL
             WHERE id = $1 RETURNING *`,
            [
              existing.id,
              account.id,
              title,
              description,
              hashtags,
              target.tags,
              privacy,
              status,
              scheduledAt,
              render?.id ?? null,
            ],
          )
        : await queryOne<SocialPostRow>(
            `INSERT INTO social_posts
               (video_id, project_id, social_account_id, platform, title, description, hashtags,
                tags, privacy, status, scheduled_at, media_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [
              video.id,
              video.project_id,
              account.id,
              target.platform,
              title,
              description,
              hashtags,
              target.tags,
              privacy,
              status,
              scheduledAt,
              render?.id ?? null,
            ],
          );

      results.push({ platform: target.platform, status: post?.status ?? status });
    }

    const readyToPublish =
      video.status === 'APPROVED' || video.status === 'SCHEDULED' || !video.require_approval;

    if (body.mode === 'now') {
      if (!readyToPublish) {
        await query(`UPDATE videos SET status = 'REVIEW_REQUIRED' WHERE id = $1`, [video.id]);
        res.json({
          ok: true,
          published: false,
          reason: 'approval_required',
          message: 'Das Video muss zuerst freigegeben werden. Die Ziele sind gespeichert.',
          results,
        });
        return;
      }
      const posts = await queryMany<SocialPostRow>(
        `SELECT * FROM social_posts WHERE video_id = $1 AND status = 'scheduled'`,
        [video.id],
      );
      for (const post of posts) {
        try {
          await enqueuePublishJob(post.id, 0);
        } catch (err) {
          await query(`UPDATE social_posts SET status = 'failed', error = $2 WHERE id = $1`, [
            post.id,
            (err as Error).message,
          ]);
        }
      }
      await query(`UPDATE videos SET status = 'PUBLISHING' WHERE id = $1`, [video.id]);
    } else if (body.mode === 'schedule' && readyToPublish) {
      await schedulePendingPosts(video.id);
    } else if (body.mode === 'schedule') {
      await query(`UPDATE videos SET status = 'REVIEW_REQUIRED' WHERE id = $1 AND status = 'GENERATED'`, [video.id]);
    }

    await audit('post.scheduled', contextFromRequest(req), 'video', video.id, { mode: body.mode, results });
    res.json({ ok: true, mode: body.mode, results });
  }),
);

videosRouter.post(
  '/:id/posts/:postId/cancel',
  requireEditor,
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    const post = await queryOne<{ id: string }>('SELECT id FROM social_posts WHERE id = $1 AND video_id = $2', [
      req.params.postId!,
      video.id,
    ]);
    if (!post) throw new NotFoundError('Veroeffentlichung');
    await cancelPost(post.id);
    await audit('post.cancelled', contextFromRequest(req), 'social_post', req.params.postId!);
    res.json({ ok: true });
  }),
);

videosRouter.delete(
  '/:id',
  requireEditor,
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    await cancelVideoJobs(video.id);
    await query('DELETE FROM videos WHERE id = $1', [video.id]);
    await audit('video.deleted', contextFromRequest(req), 'video', video.id, { title: video.title });
    res.status(204).end();
  }),
);

videosRouter.post(
  '/:id/advance',
  requireEditor,
  asyncHandler(async (req, res) => {
    const { video } = await loadVideoOwned(req.params.id!, req.user!.id);
    await advancePipeline(video.id);
    res.json({ ok: true });
  }),
);
