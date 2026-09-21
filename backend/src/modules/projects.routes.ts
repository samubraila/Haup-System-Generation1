import { Router } from 'express';
import { z } from 'zod';
import { query, queryMany, queryOne } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { audit, contextFromRequest } from '../services/audit.js';
import { ensureProjectLayout, removeProjectFiles, directorySize } from '../services/storage.js';
import { parseProjectSettings, projectSettingsSchema, type ProjectRow } from '../services/types.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { asyncHandler } from '../utils/http.js';

export const projectsRouter: Router = Router();

const upsertSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  language: z.enum(['de', 'en', 'es', 'fr', 'it']).default('de'),
  style: z.string().min(1).max(60).default('cinematic'),
  defaultDurationSec: z.number().int().min(5).max(3600).default(30),
  defaultFormat: z
    .enum(['youtube_video', 'youtube_short', 'tiktok', 'instagram_reel', 'facebook_reel'])
    .default('youtube_short'),
  defaultAspect: z.enum(['9:16', '16:9', '1:1', '4:5']).default('9:16'),
  platforms: z.array(z.enum(['youtube', 'tiktok', 'instagram', 'facebook'])).default([]),
  requireApproval: z.boolean().default(true),
  settings: projectSettingsSchema.partial().default({}),
});

const patchSchema = upsertSchema.partial();

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'projekt'
  );
}

function toApi(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    language: row.language,
    style: row.style,
    defaultDurationSec: row.default_duration_sec,
    defaultFormat: row.default_format,
    defaultAspect: row.default_aspect,
    platforms: row.platforms,
    requireApproval: row.require_approval,
    settings: parseProjectSettings(row.settings),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadOwned(projectId: string, userId: string): Promise<ProjectRow> {
  const row = await queryOne<ProjectRow>('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
  if (!row) throw new NotFoundError('Projekt');
  return row;
}

projectsRouter.use(requireAuth);

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    const rows = await queryMany<ProjectRow & { video_count: number; published_count: number }>(
      `SELECT p.*,
              COUNT(v.id)::int                                                AS video_count,
              COUNT(v.id) FILTER (WHERE v.status = 'PUBLISHED')::int          AS published_count
       FROM projects p
       LEFT JOIN videos v ON v.project_id = p.id
       WHERE p.user_id = $1 ${includeArchived ? '' : 'AND p.archived_at IS NULL'}
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.user!.id],
    );
    res.json({
      items: rows.map((row) => ({ ...toApi(row), videoCount: row.video_count, publishedCount: row.published_count })),
    });
  }),
);

projectsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const project = await loadOwned(req.params.id!, req.user!.id);
    const stats = await queryOne<{
      total: number;
      published: number;
      failed: number;
      in_progress: number;
      review: number;
    }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'PUBLISHED')::int AS published,
              COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
              COUNT(*) FILTER (WHERE status IN ('QUEUED','GENERATING','PROCESSING','WAITING_FOR_GPU'))::int AS in_progress,
              COUNT(*) FILTER (WHERE status = 'REVIEW_REQUIRED')::int AS review
       FROM videos WHERE project_id = $1`,
      [project.id],
    );
    const storageBytes = await directorySize(`projects/${project.id}`).catch(() => 0);
    res.json({ ...toApi(project), stats, storageBytes });
  }),
);

projectsRouter.post(
  '/',
  requireEditor,
  validateBody(upsertSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof upsertSchema>;
    const base = slugify(body.name);

    let slug = base;
    for (let suffix = 2; suffix < 50; suffix++) {
      const clash = await queryOne('SELECT id FROM projects WHERE user_id = $1 AND slug = $2', [req.user!.id, slug]);
      if (!clash) break;
      slug = `${base}-${suffix}`;
    }

    const settings = projectSettingsSchema.parse({ ...body.settings });
    const row = await queryOne<ProjectRow>(
      `INSERT INTO projects
         (user_id, name, slug, description, language, style, default_duration_sec,
          default_format, default_aspect, platforms, require_approval, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.user!.id,
        body.name,
        slug,
        body.description,
        body.language,
        body.style,
        body.defaultDurationSec,
        body.defaultFormat,
        body.defaultAspect,
        body.platforms,
        body.requireApproval,
        JSON.stringify(settings),
      ],
    );
    if (!row) throw new Error('Projekt konnte nicht angelegt werden');

    await ensureProjectLayout(row.id);
    await audit('project.created', contextFromRequest(req), 'project', row.id, { name: row.name });
    res.status(201).json(toApi(row));
  }),
);

projectsRouter.patch(
  '/:id',
  requireEditor,
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const project = await loadOwned(req.params.id!, req.user!.id);
    const body = req.body as z.infer<typeof patchSchema>;

    const settings = body.settings
      ? projectSettingsSchema.parse({ ...parseProjectSettings(project.settings), ...body.settings })
      : parseProjectSettings(project.settings);

    const row = await queryOne<ProjectRow>(
      `UPDATE projects SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         language = COALESCE($4, language),
         style = COALESCE($5, style),
         default_duration_sec = COALESCE($6, default_duration_sec),
         default_format = COALESCE($7, default_format),
         default_aspect = COALESCE($8, default_aspect),
         platforms = COALESCE($9, platforms),
         require_approval = COALESCE($10, require_approval),
         settings = $11
       WHERE id = $1
       RETURNING *`,
      [
        project.id,
        body.name ?? null,
        body.description ?? null,
        body.language ?? null,
        body.style ?? null,
        body.defaultDurationSec ?? null,
        body.defaultFormat ?? null,
        body.defaultAspect ?? null,
        body.platforms ?? null,
        body.requireApproval ?? null,
        JSON.stringify(settings),
      ],
    );

    await audit('project.updated', contextFromRequest(req), 'project', project.id);
    res.json(toApi(row!));
  }),
);

projectsRouter.post(
  '/:id/archive',
  requireEditor,
  asyncHandler(async (req, res) => {
    const project = await loadOwned(req.params.id!, req.user!.id);
    await query('UPDATE projects SET archived_at = now() WHERE id = $1', [project.id]);
    res.json({ ok: true });
  }),
);

projectsRouter.post(
  '/:id/restore',
  requireEditor,
  asyncHandler(async (req, res) => {
    const project = await loadOwned(req.params.id!, req.user!.id);
    await query('UPDATE projects SET archived_at = NULL WHERE id = $1', [project.id]);
    res.json({ ok: true });
  }),
);

projectsRouter.delete(
  '/:id',
  requireEditor,
  asyncHandler(async (req, res) => {
    const project = await loadOwned(req.params.id!, req.user!.id);

    const active = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM video_jobs
       WHERE project_id = $1 AND status IN ('PENDING','RUNNING','WAITING_FOR_GPU')`,
      [project.id],
    );
    if ((active?.count ?? 0) > 0) {
      throw new ConflictError('Es laufen noch Jobs zu diesem Projekt. Bitte zuerst abbrechen.');
    }

    const deleteFiles = req.query.deleteFiles !== 'false';
    await query('DELETE FROM projects WHERE id = $1', [project.id]);
    if (deleteFiles) await removeProjectFiles(project.id).catch(() => undefined);

    await audit('project.deleted', contextFromRequest(req), 'project', project.id, { deleteFiles });
    res.status(204).end();
  }),
);
