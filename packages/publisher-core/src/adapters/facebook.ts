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
  type PublishResult,
} from '../types.js';

const GRAPH_VIDEO = 'https://graph-video.facebook.com/v21.0';
const GRAPH = 'https://graph.facebook.com/v21.0';

function pageToken(ctx: AdapterContext): string {
  const token = ctx.credentials.meta.pageAccessToken;
  return typeof token === 'string' && token.length > 0 ? token : ctx.credentials.accessToken;
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

interface StartSession {
  video_id?: string;
  upload_session_id?: string;
  start_offset?: string;
  end_offset?: string;
}

async function postForm(
  url: string,
  fields: Record<string, string | Blob>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value as string);

  const response = await fetch(url, { method: 'POST', body: form, signal });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* Klartext-Antwort */
  }
  if (!response.ok) throw toPlatformError(response.status, json, text);
  return json;
}

export const facebookAdapter: PlatformAdapter = {
  platform: 'facebook',
  label: 'Facebook',
  maxFileBytes: 10 * 1024 * 1024 * 1024,
  supportedMimeTypes: ['video/mp4', 'video/quicktime'],

  async publish(input, ctx) {
    const pageId = ctx.credentials.externalId;
    if (!pageId) throw new PlatformRejectedError('Dem Konto ist keine Facebook-Seite zugeordnet');

    const stat = await fs.stat(input.localVideoPath);
    if (stat.size === 0) throw new PlatformRejectedError('Die Videodatei ist leer');

    const token = pageToken(ctx);
    const description = buildCaption(input.title, input.description, input.hashtags, 5000);

    await ctx.reportProgress(5, 'Upload-Sitzung wird geoeffnet');

    const start = (await postForm(
      `${GRAPH_VIDEO}/${pageId}/videos`,
      {
        upload_phase: 'start',
        file_size: String(stat.size),
        access_token: token,
      },
      ctx.signal,
    )) as StartSession;

    const sessionId = start.upload_session_id;
    const videoId = start.video_id;
    if (!sessionId || !videoId) throw new PlatformRejectedError('Facebook hat keine Upload-Sitzung geliefert');

    ctx.log('Facebook-Upload gestartet', { sessionId, videoId });

    let startOffset = Number(start.start_offset ?? 0);
    let endOffset = Number(start.end_offset ?? stat.size);

    while (startOffset < endOffset) {
      const chunk = await readRange(input.localVideoPath, startOffset, endOffset - 1);
      const transfer = (await postForm(
        `${GRAPH_VIDEO}/${pageId}/videos`,
        {
          upload_phase: 'transfer',
          upload_session_id: sessionId,
          start_offset: String(startOffset),
          access_token: token,
          video_file_chunk: new Blob([chunk]),
        },
        ctx.signal,
      )) as StartSession;

      const nextStart = Number(transfer.start_offset ?? endOffset);
      endOffset = Number(transfer.end_offset ?? endOffset);
      if (nextStart === startOffset) break;
      startOffset = nextStart;

      await ctx.reportProgress(5 + (startOffset / stat.size) * 80, 'Upload laeuft');
    }

    await ctx.reportProgress(90, 'Beitrag wird abgeschlossen');

    const scheduled = input.publishAt ? new Date(input.publishAt) : null;
    const usesSchedule = scheduled !== null && scheduled.getTime() > Date.now() + 10 * 60_000;

    await postForm(
      `${GRAPH_VIDEO}/${pageId}/videos`,
      {
        upload_phase: 'finish',
        upload_session_id: sessionId,
        access_token: token,
        title: input.title.slice(0, 255),
        description,
        ...(usesSchedule
          ? { published: 'false', scheduled_publish_time: String(Math.floor(scheduled.getTime() / 1000)) }
          : { published: input.privacy === 'private' ? 'false' : 'true' }),
      },
      ctx.signal,
    );

    await ctx.reportProgress(100, 'Auf Facebook veroeffentlicht');
    return {
      externalPostId: videoId,
      externalUrl: `https://www.facebook.com/${videoId}`,
      raw: { sessionId },
    } satisfies PublishResult;
  },

  async fetchAnalytics(externalPostId, ctx): Promise<AnalyticsSnapshot> {
    const token = pageToken(ctx);

    type FacebookStats = {
      views?: number;
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      length?: number;
    };

    const json = await requestJson<FacebookStats>({
      url: `${GRAPH}/${externalPostId}?fields=views,length,likes.summary(true),comments.summary(true)&access_token=${encodeURIComponent(token)}`,
      signal: ctx.signal,
    }).catch((err: Error) => {
      ctx.log(`Facebook-Statistik nicht abrufbar: ${err.message}`);
      return {} as FacebookStats;
    });

    if (Object.keys(json).length === 0) return emptyAnalytics({ note: 'Keine Statistik verfuegbar' });

    return {
      views: Number(json.views ?? 0),
      likes: Number(json.likes?.summary?.total_count ?? 0),
      comments: Number(json.comments?.summary?.total_count ?? 0),
      shares: 0,
      followersGained: 0,
      watchTimeSec: 0,
      raw: json as Record<string, unknown>,
    };
  },
};
