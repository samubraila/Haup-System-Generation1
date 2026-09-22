import { queryMany, queryOne } from '../db/pool.js';
import { jobQueue } from '../queue/index.js';
import { writeLog } from './log-store.js';
import { setVideoStatus } from './pipeline.js';
import { syncVideoPublishState } from './publisher.js';
import type { VideoJobRow } from './types.js';

const STALE_REASON =
  'Der bearbeitende Worker ist abgestuerzt und es waren keine Versuche mehr uebrig. Der Job kann erneut gestartet werden.';

export async function reconcileDeadLetteredJobs(queueJobIds: string[]): Promise<number> {
  if (queueJobIds.length === 0) return 0;

  let reconciled = 0;

  for (const queueJobId of queueJobIds) {
    const videoJob = await queryOne<VideoJobRow>(
      `UPDATE video_jobs SET status = 'FAILED', error = COALESCE(error, $2), finished_at = now()
       WHERE queue_job_id = $1 AND status IN ('PENDING', 'RUNNING', 'WAITING_FOR_GPU')
       RETURNING *`,
      [queueJobId, STALE_REASON],
    );

    if (videoJob) {
      reconciled += 1;
      if (videoJob.video_id) {
        await setVideoStatus(videoJob.video_id, 'FAILED', { error: videoJob.error ?? STALE_REASON });
      }
      await writeLog('error', 'reconcile', 'Haengengebliebener Job als fehlgeschlagen eingetragen', {
        queueJobId,
        jobId: videoJob.id,
        videoId: videoJob.video_id,
      });
      continue;
    }

    const publishJob = await queryOne<{ id: string; social_post_id: string }>(
      `UPDATE publishing_jobs SET status = 'FAILED', error = COALESCE(error, $2), finished_at = now()
       WHERE queue_job_id = $1 AND status IN ('PENDING', 'RUNNING')
       RETURNING id, social_post_id`,
      [queueJobId, STALE_REASON],
    );

    if (publishJob) {
      reconciled += 1;
      const post = await queryOne<{ video_id: string }>(
        `UPDATE social_posts SET status = 'failed', error = COALESCE(error, $2)
         WHERE id = $1 AND status <> 'published'
         RETURNING video_id`,
        [publishJob.social_post_id, STALE_REASON],
      );
      if (post) await syncVideoPublishState(post.video_id);
      await writeLog('error', 'reconcile', 'Haengengebliebenen Upload als fehlgeschlagen eingetragen', {
        queueJobId,
        postId: publishJob.social_post_id,
      });
    }
  }

  return reconciled;
}

export async function reconcileOrphanedJobs(): Promise<number> {
  const candidates = await queryMany<VideoJobRow>(
    `SELECT * FROM video_jobs
     WHERE status IN ('PENDING', 'RUNNING', 'WAITING_FOR_GPU')
       AND queue_job_id IS NOT NULL
       AND updated_at < now() - interval '10 minutes'
     LIMIT 200`,
  );

  let orphaned = 0;

  for (const job of candidates) {
    const queued = await jobQueue.getJob(job.queue_job_id!);
    if (queued) continue;

    await queryOne(
      `UPDATE video_jobs SET status = 'FAILED', finished_at = now(),
              error = COALESCE(error, 'Der Job ist nicht mehr in der Warteschlange vorhanden.')
       WHERE id = $1`,
      [job.id],
    );
    if (job.video_id) {
      await setVideoStatus(job.video_id, 'FAILED', {
        error: 'Ein Arbeitsschritt ist aus der Warteschlange verschwunden. Bitte erneut starten.',
      });
    }
    orphaned += 1;
    await writeLog('warn', 'reconcile', 'Job ohne Eintrag in der Warteschlange gefunden', {
      jobId: job.id,
      videoId: job.video_id,
      queue: job.queue,
    });
  }

  return orphaned;
}
