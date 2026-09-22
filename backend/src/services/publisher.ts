import { QUEUES, type QueueName } from '@acf/worker-core';
import { config } from '../config/index.js';
import { query, queryMany, queryOne } from '../db/pool.js';
import { jobQueue } from '../queue/index.js';
import { events } from '../utils/events.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { writeLog } from './log-store.js';
import { ownerOfVideo } from './ownership.js';
import type { MediaRow, SocialAccountRow, SocialPostRow, VideoRow } from './types.js';

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export const PLATFORM_QUEUE: Record<Platform, QueueName> = {
  youtube: QUEUES.PUBLISH_YOUTUBE,
  tiktok: QUEUES.PUBLISH_TIKTOK,
  instagram: QUEUES.PUBLISH_INSTAGRAM,
  facebook: QUEUES.PUBLISH_FACEBOOK,
};

const PREFERRED_TARGET: Record<Platform, string[]> = {
  youtube: ['youtube', 'youtube_short'],
  tiktok: ['tiktok', 'youtube_short'],
  instagram: ['instagram_reel', 'tiktok', 'youtube_short'],
  facebook: ['facebook_reel', 'instagram_reel', 'youtube_short'],
};

export async function selectRenderForPlatform(videoId: string, platform: Platform): Promise<MediaRow | null> {
  const renders = await queryMany<MediaRow>(
    `SELECT * FROM media WHERE video_id = $1 AND kind = 'video' AND meta->>'stage' = 'final' ORDER BY created_at`,
    [videoId],
  );
  for (const key of PREFERRED_TARGET[platform]) {
    const match = renders.find((render) => render.meta.target === key);
    if (match) return match;
  }
  if (renders[0]) return renders[0];

  const video = await queryOne<VideoRow>('SELECT final_media_id FROM videos WHERE id = $1', [videoId]);
  if (!video?.final_media_id) return null;
  return queryOne<MediaRow>('SELECT * FROM media WHERE id = $1', [video.final_media_id]);
}

export async function enqueuePublishJob(postId: string, delayMs = 0): Promise<string> {
  const post = await queryOne<SocialPostRow>('SELECT * FROM social_posts WHERE id = $1', [postId]);
  if (!post) throw new NotFoundError('Veroeffentlichung');

  const platform = post.platform as Platform;
  const queue = PLATFORM_QUEUE[platform];
  if (!queue) throw new ConflictError(`Plattform ${post.platform} wird nicht unterstuetzt`);

  if (!post.social_account_id) {
    throw new ConflictError(`Fuer ${post.platform} ist kein Konto verbunden`);
  }

  const account = await queryOne<SocialAccountRow>('SELECT * FROM social_accounts WHERE id = $1', [
    post.social_account_id,
  ]);
  if (!account || account.status !== 'connected') {
    await query(
      `UPDATE social_posts SET status = 'failed', error = $2, requires_reconnect = TRUE WHERE id = $1`,
      [postId, `Konto fuer ${post.platform} ist nicht verbunden`],
    );
    throw new ConflictError(`Konto fuer ${post.platform} ist nicht verbunden`);
  }

  const render = post.media_id
    ? await queryOne<MediaRow>('SELECT * FROM media WHERE id = $1', [post.media_id])
    : await selectRenderForPlatform(post.video_id, platform);

  if (!render) throw new ConflictError('Es liegt noch keine fertig gerenderte Videodatei vor');

  const video = await queryOne<VideoRow>('SELECT * FROM videos WHERE id = $1', [post.video_id]);
  const thumbnail = video?.thumbnail_media_id
    ? await queryOne<MediaRow>('SELECT path FROM media WHERE id = $1', [video.thumbnail_media_id])
    : null;

  const jobRow = await queryOne<{ id: string }>(
    `INSERT INTO publishing_jobs (social_post_id, platform, queue, scheduled_at, max_attempts)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [postId, platform, queue, post.scheduled_at, config.JOB_MAX_ATTEMPTS],
  );
  if (!jobRow) throw new Error('Publishing-Job konnte nicht angelegt werden');

  const payload = {
    postId: post.id,
    projectId: post.project_id,
    videoId: post.video_id,
    accountId: account.id,
    platform,
    filePath: render.path,
    thumbnailPath: thumbnail?.path ?? null,
    title: post.title,
    description: post.description,
    hashtags: post.hashtags,
    tags: post.tags,
    privacy: post.privacy,
    publishAt: post.scheduled_at ? new Date(post.scheduled_at).toISOString() : null,
    madeForKids: Boolean(post.meta?.madeForKids),
  };

  const queued = await jobQueue.enqueue({
    queue,
    name: 'publish',
    data: payload,
    refId: jobRow.id,
    priority: 7,
    maxAttempts: config.JOB_MAX_ATTEMPTS,
    delayMs,
  });

  await query('UPDATE publishing_jobs SET queue_job_id = $1 WHERE id = $2', [queued.id, jobRow.id]);
  await query(
    `UPDATE social_posts SET status = 'queued', error = NULL, media_id = $2, requires_reconnect = FALSE WHERE id = $1`,
    [postId, render.id],
  );

  events.publish(
    { type: 'post.updated', postId, videoId: post.video_id, platform, status: 'queued' },
    await ownerOfVideo(post.video_id),
  );

  await writeLog('info', 'publisher', `Veroeffentlichung eingereiht: ${platform}`, {
    postId,
    videoId: post.video_id,
    delayMs,
  });

  return jobRow.id;
}

export async function schedulePendingPosts(videoId: string): Promise<number> {
  const posts = await queryMany<SocialPostRow>(
    `SELECT * FROM social_posts WHERE video_id = $1 AND status = 'scheduled'`,
    [videoId],
  );

  let scheduled = 0;
  for (const post of posts) {
    const delayMs = post.scheduled_at ? Math.max(0, new Date(post.scheduled_at).getTime() - Date.now()) : 0;
    try {
      await enqueuePublishJob(post.id, delayMs);
      scheduled += 1;
    } catch (err) {
      await query(`UPDATE social_posts SET status = 'failed', error = $2 WHERE id = $1`, [
        post.id,
        (err as Error).message,
      ]);
      await writeLog('warn', 'publisher', `Veroeffentlichung konnte nicht eingereiht werden: ${post.platform}`, {
        postId: post.id,
        error: (err as Error).message,
      });
    }
  }

  if (scheduled > 0) {
    await query(`UPDATE videos SET status = 'SCHEDULED' WHERE id = $1 AND status IN ('APPROVED','GENERATED')`, [
      videoId,
    ]);
  }
  return scheduled;
}

export async function retryPost(postId: string): Promise<void> {
  const post = await queryOne<SocialPostRow>('SELECT * FROM social_posts WHERE id = $1', [postId]);
  if (!post) throw new NotFoundError('Veroeffentlichung');
  if (post.status === 'published') throw new ConflictError('Dieser Beitrag wurde bereits veroeffentlicht');

  const active = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM publishing_jobs
     WHERE social_post_id = $1 AND status IN ('PENDING', 'RUNNING')`,
    [postId],
  );
  if ((active?.count ?? 0) > 0) {
    throw new ConflictError('Fuer diesen Beitrag laeuft bereits ein Upload. Bitte abwarten oder zuerst abbrechen.');
  }

  await enqueuePublishJob(postId, 0);
}

export async function cancelPost(postId: string): Promise<void> {
  const jobs = await queryMany<{ id: string; queue: string; queue_job_id: string | null }>(
    `SELECT id, queue, queue_job_id FROM publishing_jobs
     WHERE social_post_id = $1 AND status IN ('PENDING','RUNNING')`,
    [postId],
  );
  for (const job of jobs) {
    if (job.queue_job_id) await jobQueue.cancel(job.queue as QueueName, job.queue_job_id);
    await query(`UPDATE publishing_jobs SET status = 'CANCELLED', finished_at = now() WHERE id = $1`, [job.id]);
  }
  await query(`UPDATE social_posts SET status = 'cancelled' WHERE id = $1 AND status <> 'published'`, [postId]);
}

export async function dueScheduledPosts(): Promise<SocialPostRow[]> {
  return queryMany<SocialPostRow>(
    `SELECT sp.* FROM social_posts sp
     JOIN videos v ON v.id = sp.video_id
     WHERE sp.status = 'scheduled'
       AND sp.scheduled_at IS NOT NULL
       AND sp.scheduled_at <= now()
       AND v.status IN ('APPROVED','SCHEDULED','PUBLISHING','PUBLISHED','GENERATED')
       AND (v.require_approval = FALSE OR v.approved_at IS NOT NULL)`,
  );
}

export async function syncVideoPublishState(videoId: string): Promise<void> {
  const posts = await queryMany<{ status: string }>('SELECT status FROM social_posts WHERE video_id = $1', [videoId]);
  if (posts.length === 0) return;

  const published = posts.filter((p) => p.status === 'published').length;
  const active = posts.filter((p) => p.status === 'queued' || p.status === 'processing').length;

  if (published === posts.length) {
    await query(`UPDATE videos SET status = 'PUBLISHED', published_at = COALESCE(published_at, now()) WHERE id = $1`, [
      videoId,
    ]);
    events.publish({ type: 'video.updated', videoId, status: 'PUBLISHED', progress: 100 }, await ownerOfVideo(videoId));
  } else if (published > 0) {
    await query(`UPDATE videos SET status = 'PUBLISHING' WHERE id = $1 AND status <> 'PUBLISHED'`, [videoId]);
    events.publish({ type: 'video.updated', videoId, status: 'PUBLISHING', progress: 100 }, await ownerOfVideo(videoId));
  } else if (active > 0) {
    await query(`UPDATE videos SET status = 'PUBLISHING' WHERE id = $1 AND status NOT IN ('PUBLISHED')`, [videoId]);
  }
}
