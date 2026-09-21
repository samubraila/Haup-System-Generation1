import { config } from '../config/index.js';
import { queryMany } from '../db/pool.js';
import { jobQueue, maintainQueues } from '../queue/index.js';
import { writeLog, purgeOldLogs } from './log-store.js';
import { dueScheduledPosts, enqueuePublishJob, PLATFORM_QUEUE, type Platform } from './publisher.js';
import { logger } from '../utils/logger.js';

const QUEUE_MAINTENANCE_MS = 15_000;
const PUBLISH_CHECK_MS = 30_000;
const LOG_PURGE_MS = 6 * 60 * 60 * 1000;

const timers: NodeJS.Timeout[] = [];

function every(intervalMs: number, name: string, task: () => Promise<void>): void {
  const timer = setInterval(() => {
    task().catch((err) => logger.error({ err: (err as Error).message, task: name }, 'Geplante Aufgabe fehlgeschlagen'));
  }, intervalMs);
  timer.unref?.();
  timers.push(timer);
}

async function publishDuePosts(): Promise<void> {
  const posts = await dueScheduledPosts();
  for (const post of posts) {
    try {
      await enqueuePublishJob(post.id, 0);
    } catch (err) {
      await writeLog('warn', 'scheduler', `Geplante Veroeffentlichung konnte nicht gestartet werden: ${post.platform}`, {
        postId: post.id,
        error: (err as Error).message,
      });
    }
  }
}

async function collectAnalytics(): Promise<void> {
  if (!config.ANALYTICS_SYNC_ENABLED) return;

  const posts = await queryMany<{ id: string; platform: string; social_account_id: string | null; external_post_id: string | null }>(
    `SELECT sp.id, sp.platform, sp.social_account_id, sp.external_post_id
     FROM social_posts sp
     JOIN social_accounts sa ON sa.id = sp.social_account_id
     WHERE sp.status = 'published'
       AND sp.external_post_id IS NOT NULL
       AND sa.status = 'connected'
       AND sp.published_at > now() - interval '90 days'`,
  );

  let enqueued = 0;
  for (const post of posts) {
    const queue = PLATFORM_QUEUE[post.platform as Platform];
    if (!queue || !post.social_account_id) continue;
    await jobQueue.enqueue({
      queue,
      name: 'collect_analytics',
      data: {
        postId: post.id,
        platform: post.platform,
        accountId: post.social_account_id,
        externalPostId: post.external_post_id,
      },
      refId: null,
      priority: 1,
      maxAttempts: 2,
    });
    enqueued += 1;
  }

  if (enqueued > 0) {
    await writeLog('info', 'scheduler', `Analytics-Abruf eingereiht: ${enqueued} Beitraege`, { enqueued });
  }
}

export function startScheduler(): void {
  every(QUEUE_MAINTENANCE_MS, 'queue-maintenance', async () => {
    const { reaped } = await maintainQueues();
    if (reaped.length > 0) {
      await writeLog('warn', 'scheduler', `Jobs abgestuerzter Worker wiederhergestellt: ${reaped.length}`, {
        jobIds: reaped.slice(0, 20),
      });
    }
  });

  every(PUBLISH_CHECK_MS, 'publish-due', publishDuePosts);

  every(LOG_PURGE_MS, 'log-purge', async () => {
    const purged = await purgeOldLogs();
    if (purged > 0) logger.info({ purged }, 'Alte Logeintraege entfernt');
  });

  if (config.ANALYTICS_SYNC_ENABLED) {
    every(config.ANALYTICS_SYNC_INTERVAL_MIN * 60_000, 'analytics-sync', collectAnalytics);
  }

  logger.info(
    { analyticsSync: config.ANALYTICS_SYNC_ENABLED, intervalMin: config.ANALYTICS_SYNC_INTERVAL_MIN },
    'Scheduler gestartet',
  );
}

export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}
