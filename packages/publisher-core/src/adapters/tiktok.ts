import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { requestJson, toPlatformError } from '../http.js';
import {
  buildCaption,
  emptyAnalytics,
  PlatformRejectedError,
  type AdapterContext,
  type AnalyticsSnapshot,
  type PlatformAdapter,
  type PublishInput,
  type PublishResult,
} from '../types.js';

const API = 'https://open.tiktokapis.com/v2';
const CHUNK_BYTES = 10 * 1024 * 1024;
const MAX_STATUS_POLLS = 60;
const POLL_INTERVAL_MS = 5000;

const PRIVACY: Record<string, string> = {
  public: 'PUBLIC_TO_EVERYONE',
  unlisted: 'MUTUAL_FOLLOW_FRIENDS',
  private: 'SELF_ONLY',
};

interface InitResponse {
  data?: { publish_id?: string; upload_url?: string };
  error?: { code?: string; message?: string };
}

interface StatusResponse {
  data?: {
    status?: string;
    publicaly_available_post_id?: string[];
    publicly_available_post_id?: string[];
    fail_reason?: string;
  };
  error?: { code?: string; message?: string };
}

function readRange(filePath: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath, { start, end });
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function assertNoApiError(json: { error?: { code?: string; message?: string } }): void {
  const code = json.error?.code;
  if (code && code !== 'ok') {
    throw new PlatformRejectedError(`TikTok: ${json.error?.message ?? code}`);
  }
}

export const tiktokAdapter: PlatformAdapter = {
  platform: 'tiktok',
  label: 'TikTok',
  maxFileBytes: 4 * 1024 * 1024 * 1024,
  supportedMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],

  async publish(input, ctx) {
    const stat = await fs.stat(input.localVideoPath);
    if (stat.size === 0) throw new PlatformRejectedError('Die Videodatei ist leer');

    const chunkSize = stat.size < CHUNK_BYTES ? stat.size : CHUNK_BYTES;
    const totalChunks = Math.max(1, Math.ceil(stat.size / chunkSize));

    await ctx.reportProgress(5, 'Upload wird bei TikTok angemeldet');

    const init = await requestJson<InitResponse>({
      url: `${API}/post/publish/video/init/`,
      method: 'POST',
      accessToken: ctx.credentials.accessToken,
      signal: ctx.signal,
      body: {
        post_info: {
          title: buildCaption(input.title, input.description, input.hashtags, 2200),
          privacy_level: PRIVACY[input.privacy] ?? 'SELF_ONLY',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: stat.size,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      },
    });
    assertNoApiError(init);

    const publishId = init.data?.publish_id;
    const uploadUrl = init.data?.upload_url;
    if (!publishId || !uploadUrl) {
      throw new PlatformRejectedError(
        'TikTok hat keine Upload-Adresse geliefert. Pruefe, ob die App fuer die Content Posting API freigeschaltet ist.',
      );
    }

    ctx.log('TikTok-Upload angemeldet', { publishId, totalChunks });

    for (let index = 0; index < totalChunks; index++) {
      const start = index * chunkSize;
      const end = index === totalChunks - 1 ? stat.size - 1 : start + chunkSize - 1;
      const chunk = await readRange(input.localVideoPath, start, end);

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(chunk.length),
          'content-range': `bytes ${start}-${end}/${stat.size}`,
        },
        body: chunk,
        signal: ctx.signal,
      });

      if (!response.ok && response.status !== 201 && response.status !== 206) {
        const text = await response.text();
        throw toPlatformError(response.status, {}, text);
      }

      await ctx.reportProgress(5 + ((index + 1) / totalChunks) * 70, `Teil ${index + 1} von ${totalChunks} geladen`);
    }

    await ctx.reportProgress(80, 'TikTok verarbeitet das Video');

    for (let poll = 0; poll < MAX_STATUS_POLLS; poll++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (ctx.signal.aborted) throw new Error('Abgebrochen');

      const status = await requestJson<StatusResponse>({
        url: `${API}/post/publish/status/fetch/`,
        method: 'POST',
        accessToken: ctx.credentials.accessToken,
        signal: ctx.signal,
        body: { publish_id: publishId },
      });
      assertNoApiError(status);

      const state = status.data?.status ?? 'PROCESSING';
      if (state === 'PUBLISH_COMPLETE') {
        const postIds = status.data?.publicly_available_post_id ?? status.data?.publicaly_available_post_id ?? [];
        const postId = postIds[0] ?? publishId;
        await ctx.reportProgress(100, 'Auf TikTok veroeffentlicht');
        return {
          externalPostId: String(postId),
          externalUrl: postIds[0] ? `https://www.tiktok.com/video/${postIds[0]}` : null,
          raw: status.data as Record<string, unknown>,
        } satisfies PublishResult;
      }
      if (state === 'FAILED') {
        throw new PlatformRejectedError(`TikTok hat die Verarbeitung abgebrochen: ${status.data?.fail_reason ?? 'unbekannt'}`);
      }

      await ctx.reportProgress(80 + Math.min(15, poll), `Status: ${state}`);
    }

    throw new Error('TikTok hat die Verarbeitung nicht innerhalb der Wartezeit abgeschlossen');
  },

  async fetchAnalytics(externalPostId, ctx): Promise<AnalyticsSnapshot> {
    const json = await requestJson<{
      data?: { videos?: Array<Record<string, number>> };
      error?: { code?: string; message?: string };
    }>({
      url: `${API}/video/query/?fields=id,like_count,comment_count,share_count,view_count`,
      method: 'POST',
      accessToken: ctx.credentials.accessToken,
      signal: ctx.signal,
      body: { filters: { video_ids: [externalPostId] } },
    }).catch((err: Error) => {
      ctx.log(`Statistik nicht abrufbar: ${err.message}`);
      return { data: { videos: [] } };
    });

    const video = json.data?.videos?.[0];
    if (!video) return emptyAnalytics({ note: 'Keine Statistik verfuegbar (Scope video.list erforderlich)' });

    return {
      views: Number(video.view_count ?? 0),
      likes: Number(video.like_count ?? 0),
      comments: Number(video.comment_count ?? 0),
      shares: Number(video.share_count ?? 0),
      followersGained: 0,
      watchTimeSec: 0,
      raw: video,
    };
  },
};
