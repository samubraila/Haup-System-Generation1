import fs from 'node:fs/promises';
import {
  PermanentJobError,
  publishJobSchema,
  QUEUES,
  runWorker,
  type JobContext,
  type JobResult,
  type QueueName,
  type RunningWorker,
} from '@acf/worker-core';
import {
  PlatformRejectedError,
  ReconnectRequiredError,
  type Credentials,
  type AdapterContext,
  type PlatformAdapter,
  type PublishInput,
} from './types.js';

const QUEUE_BY_PLATFORM: Record<string, QueueName> = {
  youtube: QUEUES.PUBLISH_YOUTUBE,
  tiktok: QUEUES.PUBLISH_TIKTOK,
  instagram: QUEUES.PUBLISH_INSTAGRAM,
  facebook: QUEUES.PUBLISH_FACEBOOK,
};

interface AnalyticsPayload {
  postId: string;
  platform: string;
  accountId: string;
  externalPostId: string;
}

export async function runPublisherWorker(adapter: PlatformAdapter): Promise<RunningWorker> {
  const queue = QUEUE_BY_PLATFORM[adapter.platform];
  if (!queue) throw new Error(`Keine Queue fuer Plattform ${adapter.platform} definiert`);

  return runWorker<Record<string, unknown>>({
    name: `publisher-${adapter.platform}`,
    queue,
    defaultConcurrency: 1,

    async onStart({ logger }) {
      logger.info({ platform: adapter.platform }, 'Publisher bereit');
      return {
        platform: adapter.platform,
        label: adapter.label,
        maxFileBytes: adapter.maxFileBytes,
        supportedMimeTypes: adapter.supportedMimeTypes,
      };
    },

    async handler(ctx) {
      if (ctx.job.name === 'collect_analytics') return collectAnalytics(adapter, ctx);
      return publish(adapter, ctx);
    },
  });
}

async function collectAnalytics(
  adapter: PlatformAdapter,
  ctx: JobContext<Record<string, unknown>>,
): Promise<JobResult> {
  const payload = ctx.data as unknown as AnalyticsPayload;
  const credentials = (await ctx.api.getSocialCredentials(payload.accountId)) as Credentials;

  const adapterCtx: AdapterContext = {
    credentials,
    log: (message, extra) => ctx.logger.info(extra ?? {}, message),
    reportProgress: async () => undefined,
    signal: ctx.signal,
  };

  const snapshot = await adapter.fetchAnalytics(payload.externalPostId, adapterCtx);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const onAbort = () => controller.abort();
  ctx.signal.addEventListener('abort', onAbort);

  let response: Response;
  try {
    response = await fetch(`${ctx.config.backendUrl}/api/internal/analytics`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': ctx.config.internalApiKey,
        'x-worker-id': ctx.config.workerId,
      },
      body: JSON.stringify({
        postId: payload.postId,
        platform: adapter.platform,
        views: snapshot.views,
        likes: snapshot.likes,
        comments: snapshot.comments,
        shares: snapshot.shares,
        followersGained: snapshot.followersGained,
        watchTimeSec: snapshot.watchTimeSec,
        raw: snapshot.raw,
      }),
    });
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', onAbort);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Kennzahlen konnten nicht gespeichert werden (${response.status}): ${text.slice(0, 200)}`);
  }

  return { views: snapshot.views, likes: snapshot.likes };
}

async function publish(adapter: PlatformAdapter, ctx: JobContext<Record<string, unknown>>): Promise<JobResult> {
  const parsed = publishJobSchema.safeParse(ctx.data);
  if (!parsed.success) {
    throw new PermanentJobError(`Ungueltige Auftragsdaten: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
  }
  const job = parsed.data;

  if (job.platform !== adapter.platform) {
    throw new PermanentJobError(`Job fuer ${job.platform} in der Queue von ${adapter.platform}`);
  }

  const workDir = await ctx.storage.createTempDir(`publish-${adapter.platform}`);

  try {
    await ctx.reportProgress(2, 'Video wird bereitgestellt');
    const localVideoPath = await ctx.storage.pull(job.filePath, workDir);
    const localThumbnailPath = job.thumbnailPath
      ? await ctx.storage.pull(job.thumbnailPath, workDir).catch(() => null)
      : null;

    const stat = await fs.stat(localVideoPath);
    if (stat.size > adapter.maxFileBytes) {
      throw new PermanentJobError(
        `Datei ist ${Math.round(stat.size / 1024 / 1024)} MB gross, ${adapter.label} erlaubt maximal ` +
          `${Math.round(adapter.maxFileBytes / 1024 / 1024)} MB`,
      );
    }

    const credentials = (await ctx.api.getSocialCredentials(job.accountId)) as Credentials;

    const adapterCtx: AdapterContext = {
      credentials,
      log: (message, extra) => ctx.logger.info(extra ?? {}, message),
      reportProgress: (progress, message) => ctx.reportProgress(progress, message),
      signal: ctx.signal,
    };

    const input: PublishInput = {
      postId: job.postId,
      projectId: job.projectId,
      videoId: job.videoId,
      accountId: job.accountId,
      platform: adapter.platform,
      localVideoPath,
      localThumbnailPath,
      title: job.title,
      description: job.description,
      hashtags: job.hashtags,
      tags: job.tags,
      privacy: job.privacy,
      publishAt: job.publishAt,
      madeForKids: job.madeForKids,
    };

    try {
      const result = await adapter.publish(input, adapterCtx);
      ctx.logger.info({ externalPostId: result.externalPostId }, `Auf ${adapter.label} veroeffentlicht`);
      return {
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        platform: adapter.platform,
      };
    } catch (err) {
      if (err instanceof ReconnectRequiredError) {
        await ctx.api.reportSocialAccountError(job.accountId, err.message, true);
        throw new PermanentJobError(`${adapter.label}: ${err.message} Bitte das Konto neu verbinden.`);
      }
      if (err instanceof PlatformRejectedError) {
        await ctx.api.reportSocialAccountError(job.accountId, err.message, false);
        throw new PermanentJobError(err.message);
      }
      throw err;
    }
  } finally {
    await ctx.storage.removeTempDir(workDir);
  }
}
