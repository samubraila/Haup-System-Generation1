import os from 'node:os';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { checkDatabase, query, queryMany, queryOne } from '../db/pool.js';
import { requireAuth, requireEditor, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { checkRedis, listWorkers, maintainQueues, queueOverview } from '../queue/index.js';
import { audit, contextFromRequest } from '../services/audit.js';
import { createBackup, listBackups } from '../services/backup.js';
import { purgeOldLogs } from '../services/log-store.js';
import { SERVICES } from '../services/service-registry.js';
import { directorySize } from '../services/storage.js';
import { events } from '../utils/events.js';
import { asyncHandler, paged, readPagination } from '../utils/http.js';

export const systemRouter: Router = Router();

const settingSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.unknown(),
});

systemRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [db, redis] = await Promise.all([checkDatabase(), checkRedis()]);
    const ok = db.ok && redis.ok;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      uptimeSec: Math.round(process.uptime()),
      database: db,
      redis,
      version: process.env.npm_package_version ?? '1.0.0',
    });
  }),
);

systemRouter.use(requireAuth);

systemRouter.get(
  '/services',
  asyncHandler(async (_req, res) => {
    const [db, redis, workers, queues] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      listWorkers(),
      queueOverview(),
    ]);

    const items = SERVICES.map((service) => {
      if (service.key === 'backend') {
        return {
          ...service,
          state: 'online' as const,
          detail: { uptimeSec: Math.round(process.uptime()) },
          reason: null,
        };
      }
      if (service.key === 'postgres') {
        return {
          ...service,
          state: db.ok ? ('online' as const) : ('offline' as const),
          detail: { latencyMs: db.latencyMs },
          reason: db.error ?? null,
        };
      }
      if (service.key === 'redis') {
        return {
          ...service,
          state: redis.ok ? ('online' as const) : ('offline' as const),
          detail: { latencyMs: redis.latencyMs },
          reason: redis.error ?? null,
        };
      }
      if (service.key === 'n8n') {
        return { ...service, state: 'unknown' as const, detail: {}, reason: null };
      }

      const instances = workers.filter((worker) => worker.queue === service.queue);
      const stats = queues.find((entry) => entry.queue === service.queue);
      if (instances.length === 0) {
        return {
          ...service,
          state: 'offline' as const,
          detail: { queue: stats ?? null },
          reason: service.optional ? 'Container ist nicht gestartet (optionales Profil)' : 'Container ist nicht erreichbar',
        };
      }

      const degraded = instances.find((worker) => worker.status === 'degraded');
      return {
        ...service,
        state: degraded ? ('degraded' as const) : ('online' as const),
        detail: {
          instances: instances.length,
          busy: instances.filter((worker) => worker.status === 'busy').length,
          capabilities: instances[0]?.capabilities ?? {},
          queue: stats ?? null,
        },
        reason: degraded?.reason ?? null,
      };
    });

    res.json({ items });
  }),
);

systemRouter.get(
  '/workers',
  asyncHandler(async (_req, res) => {
    const workers = await listWorkers();
    res.json({
      items: workers.map((worker) => ({
        ...worker,
        lastSeenAgoMs: Date.now() - worker.lastSeen,
        uptimeSec: Math.round((Date.now() - worker.startedAt) / 1000),
      })),
    });
  }),
);

systemRouter.get(
  '/gpu',
  asyncHandler(async (_req, res) => {
    const workers = await listWorkers();
    const videoWorkers = workers.filter((worker) => worker.queue === 'video');

    if (videoWorkers.length === 0) {
      res.json({
        available: false,
        mode: config.GPU_MODE,
        reason: 'Es ist kein Video-Worker verbunden. Starte ihn mit dem Profil "gpu" oder "cpu".',
        workers: [],
      });
      return;
    }

    res.json({
      mode: config.GPU_MODE,
      available: videoWorkers.some((worker) => Boolean((worker.capabilities.gpu as { available?: boolean })?.available)),
      reason: videoWorkers.find((worker) => worker.reason)?.reason ?? null,
      workers: videoWorkers.map((worker) => ({
        id: worker.id,
        host: worker.host,
        status: worker.status,
        reason: worker.reason,
        currentJobId: worker.currentJobId,
        capabilities: worker.capabilities,
      })),
    });
  }),
);

systemRouter.get(
  '/storage',
  asyncHandler(async (req, res) => {
    const projects = await queryMany<{ id: string; name: string }>(
      'SELECT id, name FROM projects WHERE user_id = $1',
      [req.user!.id],
    );

    const perProject = await Promise.all(
      projects.map(async (project) => ({
        projectId: project.id,
        name: project.name,
        bytes: await directorySize(`projects/${project.id}`).catch(() => 0),
      })),
    );

    const byKind = await queryMany<{ kind: string; bytes: number; files: number }>(
      `SELECT m.kind, COALESCE(SUM(m.size_bytes), 0)::bigint AS bytes, COUNT(*)::int AS files
       FROM media m JOIN projects p ON p.id = m.project_id
       WHERE p.user_id = $1 GROUP BY m.kind ORDER BY bytes DESC`,
      [req.user!.id],
    );

    const tempBytes = await directorySize('temp').catch(() => 0);

    res.json({
      dataDir: config.DATA_DIR,
      totalBytes: perProject.reduce((sum, entry) => sum + entry.bytes, 0),
      tempBytes,
      byProject: perProject.sort((a, b) => b.bytes - a.bytes),
      byKind: byKind.map((row) => ({ kind: row.kind, bytes: Number(row.bytes), files: row.files })),
      host: {
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
        cpuCores: os.cpus().length,
      },
    });
  }),
);

systemRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 100, 500);
    const filters: string[] = [];
    const params: Array<string | number> = [];
    let index = 1;

    if (req.query.level) {
      const levels = String(req.query.level).split(',').filter(Boolean);
      filters.push(`level = ANY($${index++})`);
      params.push(levels as unknown as string);
    }
    if (req.query.source) {
      filters.push(`source ILIKE $${index++}`);
      params.push(`%${String(req.query.source)}%`);
    }
    if (req.query.q) {
      filters.push(`message ILIKE $${index++}`);
      params.push(`%${String(req.query.q)}%`);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const total = await queryOne<{ count: number }>(`SELECT COUNT(*)::int AS count FROM logs ${where}`, params);
    const rows = await queryMany(
      `SELECT id, level, source, message, context, created_at FROM logs ${where}
       ORDER BY created_at DESC LIMIT $${index++} OFFSET $${index++}`,
      [...params, pageSize, offset],
    );

    res.json(paged(rows, total?.count ?? 0, page, pageSize));
  }),
);

systemRouter.get(
  '/audit',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 50, 200);
    const total = await queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM audit_logs');
    const rows = await queryMany(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.ip, a.meta, a.created_at, u.email
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    res.json(paged(rows, total?.count ?? 0, page, pageSize));
  }),
);

systemRouter.get('/events', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const unsubscribe = events.subscribe(res, req.user!.id);
  req.on('close', unsubscribe);
});

systemRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const rows = await queryMany<{ key: string; value: unknown; scope: string }>(
      `SELECT key, value, scope FROM settings WHERE scope = 'global' OR user_id = $1`,
      [req.user!.id],
    );
    const settings: Record<string, unknown> = {};
    for (const row of rows) settings[row.key] = row.value;

    res.json({
      settings,
      runtime: {
        gpuMode: config.GPU_MODE,
        videoProvider: config.VIDEO_GENERATOR_PROVIDER,
        requireApprovalDefault: config.REQUIRE_APPROVAL_DEFAULT,
        analyticsSyncEnabled: config.ANALYTICS_SYNC_ENABLED,
        analyticsSyncIntervalMin: config.ANALYTICS_SYNC_INTERVAL_MIN,
        maxUploadMb: config.MAX_UPLOAD_MB,
        dataDir: config.DATA_DIR,
        appUrl: config.APP_URL,
        logRetentionDays: config.LOG_RETENTION_DAYS,
      },
    });
  }),
);

systemRouter.put(
  '/settings',
  requireEditor,
  validateBody(settingSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof settingSchema>;
    await query(
      `INSERT INTO settings (scope, user_id, key, value) VALUES ('user', $1, $2, $3)
       ON CONFLICT (user_id, key) WHERE scope = 'user'
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [req.user!.id, body.key, JSON.stringify(body.value ?? null)],
    );
    await audit('settings.updated', contextFromRequest(req), 'setting', body.key);
    res.json({ ok: true });
  }),
);

systemRouter.get(
  '/backups',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    res.json({ items: await listBackups() });
  }),
);

systemRouter.post(
  '/backups',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const includeMedia = req.query.includeMedia === 'true';
    const entry = await createBackup(includeMedia);
    await audit('backup.created', contextFromRequest(req), 'backup', entry.name, { includeMedia });
    res.status(201).json(entry);
  }),
);

systemRouter.post(
  '/maintenance',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const purged = await purgeOldLogs();
    const { promoted, reaped } = await maintainQueues();
    res.json({ purgedLogs: purged, promotedJobs: promoted, recoveredJobs: reaped.length });
  }),
);
