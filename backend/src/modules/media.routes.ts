import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config/index.js';
import { query, queryMany, queryOne } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { uploadRateLimit } from '../middleware/rate-limit.js';
import { audit, contextFromRequest } from '../services/audit.js';
import {
  deleteStorageFile,
  ensureProjectLayout,
  mimeFromExtension,
  openFileStream,
  safeFileName,
  statFile,
  writeStorageFile,
} from '../services/storage.js';
import type { MediaRow } from '../services/types.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { asyncHandler, paged, readPagination } from '../utils/http.js';

export const mediaRouter: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!config.allowedUploadMime.includes(file.mimetype)) {
      cb(new BadRequestError(`Dateityp ${file.mimetype} ist nicht erlaubt`));
      return;
    }
    cb(null, true);
  },
});

const BUCKET_BY_KIND: Record<string, string> = {
  image: 'images',
  audio: 'audio',
  video: 'videos',
  subtitle: 'subtitles',
  thumbnail: 'thumbnails',
  script: 'scripts',
  other: 'exports',
};

function kindFromMime(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/x-subrip' || mime === 'text/vtt') return 'subtitle';
  return 'other';
}

function toApi(row: MediaRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    videoId: row.video_id,
    kind: row.kind,
    path: row.path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    meta: row.meta,
    createdAt: row.created_at,
    url: `/api/media/${row.id}/file`,
  };
}

async function loadOwnedMedia(mediaId: string, userId: string): Promise<MediaRow> {
  const row = await queryOne<MediaRow>(
    `SELECT m.* FROM media m JOIN projects p ON p.id = m.project_id WHERE m.id = $1 AND p.user_id = $2`,
    [mediaId, userId],
  );
  if (!row) throw new NotFoundError('Datei');
  return row;
}

mediaRouter.use(requireAuth);

mediaRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 40);
    const filters = ['p.user_id = $1'];
    const params: Array<string | number> = [req.user!.id];
    let index = 2;

    if (req.query.projectId) {
      filters.push(`m.project_id = $${index++}`);
      params.push(String(req.query.projectId));
    }
    if (req.query.kind) {
      const kinds = String(req.query.kind).split(',').filter(Boolean);
      filters.push(`m.kind = ANY($${index++})`);
      params.push(kinds as unknown as string);
    }
    if (req.query.videoId) {
      filters.push(`m.video_id = $${index++}`);
      params.push(String(req.query.videoId));
    }
    if (req.query.q) {
      filters.push(`m.file_name ILIKE $${index++}`);
      params.push(`%${String(req.query.q)}%`);
    }
    if (req.query.stage) {
      filters.push(`m.meta->>'stage' = $${index++}`);
      params.push(String(req.query.stage));
    }

    const where = filters.join(' AND ');
    const total = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM media m JOIN projects p ON p.id = m.project_id WHERE ${where}`,
      params,
    );
    const rows = await queryMany<MediaRow>(
      `SELECT m.* FROM media m JOIN projects p ON p.id = m.project_id
       WHERE ${where} ORDER BY m.created_at DESC LIMIT $${index++} OFFSET $${index++}`,
      [...params, pageSize, offset],
    );

    res.json(paged(rows.map(toApi), total?.count ?? 0, page, pageSize));
  }),
);

mediaRouter.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const media = await loadOwnedMedia(req.params.id!, req.user!.id);
    const file = await statFile(media.path);

    res.setHeader('content-type', media.mime_type);
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('x-content-type-options', 'nosniff');

    if (req.query.download === 'true') {
      res.setHeader('content-disposition', `attachment; filename="${safeFileName(media.file_name)}"`);
    }

    const range = req.headers.range;
    if (range && media.mime_type.startsWith('video')) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match?.[2] ? Number.parseInt(match[2], 10) : file.size - 1;
      if (Number.isNaN(start) || start >= file.size) {
        res.status(416).setHeader('content-range', `bytes */${file.size}`).end();
        return;
      }
      const safeEnd = Math.min(end, file.size - 1);
      res.status(206);
      res.setHeader('content-range', `bytes ${start}-${safeEnd}/${file.size}`);
      res.setHeader('accept-ranges', 'bytes');
      res.setHeader('content-length', String(safeEnd - start + 1));
      openFileStream(file.absolute, { start, end: safeEnd }).pipe(res);
      return;
    }

    res.setHeader('content-length', String(file.size));
    res.setHeader('accept-ranges', 'bytes');
    openFileStream(file.absolute).pipe(res);
  }),
);

mediaRouter.post(
  '/upload',
  requireEditor,
  uploadRateLimit,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new BadRequestError('Es wurde keine Datei uebermittelt');

    const projectId = String(req.body.projectId ?? '');
    const kind = req.body.kind ? String(req.body.kind) : kindFromMime(file.mimetype);
    const videoId = req.body.videoId ? String(req.body.videoId) : null;

    if (!BUCKET_BY_KIND[kind]) throw new BadRequestError(`Unbekannte Kategorie: ${kind}`);

    const project = await queryOne('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, req.user!.id]);
    if (!project) throw new NotFoundError('Projekt');

    if (videoId) {
      const video = await queryOne('SELECT id FROM videos WHERE id = $1 AND project_id = $2', [videoId, projectId]);
      if (!video) throw new NotFoundError('Video');
    }

    const extension = path.extname(file.originalname).toLowerCase();
    const declaredMime = mimeFromExtension(file.originalname);
    if (declaredMime !== 'application/octet-stream' && !declaredMime.split('/')[0]!.startsWith(file.mimetype.split('/')[0]!)) {
      throw new BadRequestError('Dateiendung und Dateityp passen nicht zusammen');
    }

    await ensureProjectLayout(projectId);
    const fileName = `${Date.now()}-${safeFileName(path.basename(file.originalname, extension))}${extension}`;
    const relativePath = `projects/${projectId}/${BUCKET_BY_KIND[kind]}/${fileName}`;
    await writeStorageFile(relativePath, file.buffer);

    const row = await queryOne<MediaRow>(
      `INSERT INTO media (project_id, video_id, kind, path, file_name, mime_type, size_bytes, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        projectId,
        videoId,
        kind,
        relativePath,
        fileName,
        file.mimetype,
        file.size,
        JSON.stringify({ stage: 'upload', originalName: file.originalname }),
      ],
    );

    await audit('media.uploaded', contextFromRequest(req), 'media', row!.id, { kind, sizeBytes: file.size });
    res.status(201).json(toApi(row!));
  }),
);

mediaRouter.delete(
  '/:id',
  requireEditor,
  asyncHandler(async (req, res) => {
    const media = await loadOwnedMedia(req.params.id!, req.user!.id);
    await query('DELETE FROM media WHERE id = $1', [media.id]);
    await deleteStorageFile(media.path).catch(() => undefined);
    await audit('media.deleted', contextFromRequest(req), 'media', media.id);
    res.status(204).end();
  }),
);
