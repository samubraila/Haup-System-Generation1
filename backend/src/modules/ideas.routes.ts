import { Router } from 'express';
import { z } from 'zod';
import { query, queryMany, queryOne } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { NotFoundError } from '../utils/errors.js';
import { asyncHandler, paged, readPagination } from '../utils/http.js';

export const ideasRouter: Router = Router();

interface IdeaRow {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  topic: string;
  description: string;
  tags: string[];
  status: 'new' | 'approved' | 'used' | 'rejected';
  score: number;
  source: string;
  created_at: Date;
  updated_at: Date;
}

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  topic: z.string().max(500).default(''),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(40)).max(20).default([]),
  score: z.number().int().min(0).max(100).default(0),
  source: z.string().max(60).default('manual'),
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  topic: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  status: z.enum(['new', 'approved', 'used', 'rejected']).optional(),
  score: z.number().int().min(0).max(100).optional(),
});

function toApi(row: IdeaRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    topic: row.topic,
    description: row.description,
    tags: row.tags,
    status: row.status,
    score: row.score,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

ideasRouter.use(requireAuth);

ideasRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 50);
    const filters = ['i.user_id = $1'];
    const params: Array<string | number> = [req.user!.id];
    let index = 2;

    if (req.query.projectId) {
      filters.push(`i.project_id = $${index++}`);
      params.push(String(req.query.projectId));
    }
    if (req.query.status) {
      filters.push(`i.status = $${index++}`);
      params.push(String(req.query.status));
    }
    if (req.query.q) {
      filters.push(`(i.title ILIKE $${index} OR i.topic ILIKE $${index})`);
      params.push(`%${String(req.query.q)}%`);
      index++;
    }

    const where = filters.join(' AND ');
    const total = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ideas i WHERE ${where}`,
      params,
    );
    const rows = await queryMany<IdeaRow>(
      `SELECT i.* FROM ideas i WHERE ${where} ORDER BY i.score DESC, i.created_at DESC LIMIT $${index++} OFFSET $${index++}`,
      [...params, pageSize, offset],
    );

    res.json(paged(rows.map(toApi), total?.count ?? 0, page, pageSize));
  }),
);

ideasRouter.post(
  '/',
  requireEditor,
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const project = await queryOne('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [
      body.projectId,
      req.user!.id,
    ]);
    if (!project) throw new NotFoundError('Projekt');

    const row = await queryOne<IdeaRow>(
      `INSERT INTO ideas (project_id, user_id, title, topic, description, tags, score, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        body.projectId,
        req.user!.id,
        body.title,
        body.topic,
        body.description,
        body.tags,
        body.score,
        body.source,
      ],
    );
    res.status(201).json(toApi(row!));
  }),
);

ideasRouter.patch(
  '/:id',
  requireEditor,
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof patchSchema>;
    const row = await queryOne<IdeaRow>(
      `UPDATE ideas SET
         title = COALESCE($3, title),
         topic = COALESCE($4, topic),
         description = COALESCE($5, description),
         tags = COALESCE($6, tags),
         status = COALESCE($7, status),
         score = COALESCE($8, score)
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        req.params.id!,
        req.user!.id,
        body.title ?? null,
        body.topic ?? null,
        body.description ?? null,
        body.tags ?? null,
        body.status ?? null,
        body.score ?? null,
      ],
    );
    if (!row) throw new NotFoundError('Idee');
    res.json(toApi(row));
  }),
);

ideasRouter.delete(
  '/:id',
  requireEditor,
  asyncHandler(async (req, res) => {
    const result = await query('DELETE FROM ideas WHERE id = $1 AND user_id = $2', [req.params.id!, req.user!.id]);
    if (!result.rowCount) throw new NotFoundError('Idee');
    res.status(204).end();
  }),
);
