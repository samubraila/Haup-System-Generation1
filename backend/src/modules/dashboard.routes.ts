import os from 'node:os';
import { Router } from 'express';
import { queryMany, queryOne } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { listWorkers, queueOverview } from '../queue/index.js';
import { directorySize } from '../services/storage.js';
import { stageLabel } from '../services/pipeline.js';
import { asyncHandler } from '../utils/http.js';

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    const counts = await queryOne<{
      today: number;
      week: number;
      scheduled: number;
      published: number;
      in_progress: number;
      review: number;
      failed: number;
      waiting_gpu: number;
      total: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE v.created_at >= date_trunc('day', now()))::int          AS today,
         COUNT(*) FILTER (WHERE v.created_at >= date_trunc('week', now()))::int         AS week,
         COUNT(*) FILTER (WHERE v.status = 'SCHEDULED')::int                            AS scheduled,
         COUNT(*) FILTER (WHERE v.status = 'PUBLISHED')::int                            AS published,
         COUNT(*) FILTER (WHERE v.status IN ('QUEUED','GENERATING','PROCESSING'))::int  AS in_progress,
         COUNT(*) FILTER (WHERE v.status = 'REVIEW_REQUIRED')::int                      AS review,
         COUNT(*) FILTER (WHERE v.status = 'FAILED')::int                               AS failed,
         COUNT(*) FILTER (WHERE v.status = 'WAITING_FOR_GPU')::int                      AS waiting_gpu,
         COUNT(*)::int                                                                  AS total
       FROM videos v JOIN projects p ON p.id = v.project_id
       WHERE p.user_id = $1`,
      [userId],
    );

    const social = await queryOne<{
      views: number;
      likes: number;
      comments: number;
      shares: number;
      followers: number;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (a.social_post_id) a.*
         FROM analytics a
         JOIN social_posts sp ON sp.id = a.social_post_id
         JOIN videos v ON v.id = sp.video_id
         JOIN projects p ON p.id = v.project_id
         WHERE p.user_id = $1
         ORDER BY a.social_post_id, a.collected_at DESC
       )
       SELECT COALESCE(SUM(views),0)::bigint            AS views,
              COALESCE(SUM(likes),0)::bigint            AS likes,
              COALESCE(SUM(comments),0)::bigint         AS comments,
              COALESCE(SUM(shares),0)::bigint           AS shares,
              COALESCE(SUM(followers_gained),0)::bigint AS followers
       FROM latest`,
      [userId],
    );

    const activeJobs = await queryMany<{
      id: string;
      video_id: string | null;
      video_title: string | null;
      type: string;
      status: string;
      progress: number;
      eta_seconds: number | null;
      worker_id: string | null;
      step_index: number;
      step_total: number;
    }>(
      `SELECT j.id, j.video_id, v.title AS video_title, j.type, j.status, j.progress,
              j.eta_seconds, j.worker_id, j.step_index, j.step_total
       FROM video_jobs j
       JOIN projects p ON p.id = j.project_id
       LEFT JOIN videos v ON v.id = j.video_id
       WHERE p.user_id = $1 AND j.status IN ('RUNNING','WAITING_FOR_GPU','PENDING')
       ORDER BY CASE j.status WHEN 'RUNNING' THEN 0 WHEN 'WAITING_FOR_GPU' THEN 1 ELSE 2 END, j.created_at
       LIMIT 12`,
      [userId],
    );

    const upcoming = await queryMany<{
      id: string;
      platform: string;
      title: string;
      scheduled_at: Date;
      video_id: string;
      status: string;
    }>(
      `SELECT sp.id, sp.platform, sp.title, sp.scheduled_at, sp.video_id, sp.status
       FROM social_posts sp
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = v.project_id
       WHERE p.user_id = $1 AND sp.scheduled_at IS NOT NULL
         AND sp.status IN ('scheduled','queued','processing')
       ORDER BY sp.scheduled_at
       LIMIT 8`,
      [userId],
    );

    const [workers, queues, storageBytes] = await Promise.all([
      listWorkers(),
      queueOverview(),
      directorySize('projects').catch(() => 0),
    ]);

    const videoWorker = workers.find((w) => w.queue === 'video');
    const gpu = videoWorker?.capabilities?.gpu as
      | { available?: boolean; name?: string; totalVramMb?: number; freeVramMb?: number; utilization?: number }
      | undefined;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    res.json({
      videos: counts,
      social: {
        views: Number(social?.views ?? 0),
        likes: Number(social?.likes ?? 0),
        comments: Number(social?.comments ?? 0),
        shares: Number(social?.shares ?? 0),
        followers: Number(social?.followers ?? 0),
      },
      activeJobs: activeJobs.map((job) => ({
        id: job.id,
        videoId: job.video_id,
        videoTitle: job.video_title,
        type: job.type,
        label: stageLabel(job.type as 'script' | 'video' | 'voice' | 'subtitle' | 'ffmpeg'),
        status: job.status,
        progress: job.progress,
        etaSeconds: job.eta_seconds,
        workerId: job.worker_id,
        stepIndex: job.step_index,
        stepTotal: job.step_total,
      })),
      upcoming: upcoming.map((row) => ({
        id: row.id,
        platform: row.platform,
        title: row.title,
        scheduledAt: row.scheduled_at,
        videoId: row.video_id,
        status: row.status,
      })),
      queues,
      system: {
        online: workers.length > 0,
        workerCount: workers.length,
        busyWorkers: workers.filter((w) => w.status === 'busy').length,
        degradedWorkers: workers.filter((w) => w.status === 'degraded').length,
        gpu: {
          available: Boolean(gpu?.available),
          name: gpu?.name ?? null,
          totalVramMb: gpu?.totalVramMb ?? null,
          freeVramMb: gpu?.freeVramMb ?? null,
          utilization: gpu?.utilization ?? null,
        },
        cpu: {
          cores: os.cpus().length,
          loadAvg1: os.loadavg()[0] ?? 0,
        },
        memory: {
          totalBytes: totalMem,
          freeBytes: freeMem,
          usedPercent: totalMem > 0 ? Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1)) : 0,
        },
        storageBytes,
      },
    });
  }),
);
