import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { requestJson, toPlatformError, withRetry } from '../http.js';
import {
  emptyAnalytics,
  PlatformRejectedError,
  type AdapterContext,
  type AnalyticsSnapshot,
  type PlatformAdapter,
  type PublishInput,
  type PublishResult,
} from '../types.js';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const API_URL = 'https://www.googleapis.com/youtube/v3';
const CHUNK_BYTES = 8 * 1024 * 1024;

const PRIVACY: Record<string, string> = {
  public: 'public',
  unlisted: 'unlisted',
  private: 'private',
};

async function startResumableSession(input: PublishInput, ctx: AdapterContext, fileSize: number): Promise<string> {
  const scheduled = input.publishAt ? new Date(input.publishAt) : null;
  const usesSchedule = scheduled !== null && scheduled.getTime() > Date.now();

  const metadata = {
    snippet: {
      title: input.title.slice(0, 100),
      description: [input.description, input.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 5000),
      tags: input.tags.slice(0, 30),
      categoryId: '22',
    },
    status: {
      privacyStatus: usesSchedule ? 'private' : (PRIVACY[input.privacy] ?? 'private'),
      selfDeclaredMadeForKids: input.madeForKids,
      ...(usesSchedule ? { publishAt: scheduled.toISOString() } : {}),
    },
  };

  const response = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ctx.credentials.accessToken}`,
      'content-type': 'application/json',
      'x-upload-content-length': String(fileSize),
      'x-upload-content-type': 'video/*',
    },
    body: JSON.stringify(metadata),
    signal: ctx.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* Klartext-Antwort */
    }
    throw toPlatformError(response.status, json, text);
  }

  const location = response.headers.get('location');
  if (!location) throw new Error('YouTube hat keine Upload-URL zurueckgegeben');
  return location;
}

async function uploadChunks(
  sessionUrl: string,
  filePath: string,
  fileSize: number,
  ctx: AdapterContext,
): Promise<Record<string, unknown>> {
  let offset = 0;

  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_BYTES, fileSize) - 1;
    const chunk = await readRange(filePath, offset, end);

    const response = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        'content-length': String(chunk.length),
        'content-range': `bytes ${offset}-${end}/${fileSize}`,
      },
      body: chunk,
      signal: ctx.signal,
    });

    if (response.status === 308) {
      const range = response.headers.get('range');
      const uploaded = range ? Number.parseInt(range.split('-')[1] ?? String(end), 10) + 1 : end + 1;
      offset = uploaded;
      await ctx.reportProgress(Math.min(95, (offset / fileSize) * 90 + 5), 'Upload laeuft');
      continue;
    }

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

  throw new Error('Upload endete ohne Bestaetigung von YouTube');
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

async function setThumbnail(videoId: string, thumbnailPath: string, ctx: AdapterContext): Promise<void> {
  const data = await fs.readFile(thumbnailPath);
  const response = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.credentials.accessToken}`,
        'content-type': 'image/jpeg',
        'content-length': String(data.length),
      },
      body: data,
      signal: ctx.signal,
    },
  );
  if (!response.ok) {
    ctx.log('Vorschaubild konnte nicht gesetzt werden (benoetigt ein verifiziertes Konto)', {
      status: response.status,
    });
  }
}

export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',
  label: 'YouTube',
  maxFileBytes: 128 * 1024 * 1024 * 1024,
  supportedMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],

  async publish(input, ctx) {
    const stat = await fs.stat(input.localVideoPath);
    if (stat.size === 0) throw new PlatformRejectedError('Die Videodatei ist leer');

    await ctx.reportProgress(5, 'Upload-Sitzung wird geoeffnet');
    const sessionUrl = await withRetry(() => startResumableSession(input, ctx, stat.size), {
      onRetry: (attempt, err) => ctx.log(`Upload-Sitzung fehlgeschlagen, Versuch ${attempt}: ${err.message}`),
    });

    ctx.log('Upload-Sitzung geoeffnet', { sizeBytes: stat.size });
    const result = await uploadChunks(sessionUrl, input.localVideoPath, stat.size, ctx);

    const videoId = String(result.id ?? '');
    if (!videoId) throw new Error('YouTube hat keine Video-ID zurueckgegeben');

    if (input.localThumbnailPath) {
      await setThumbnail(videoId, input.localThumbnailPath, ctx).catch(() => undefined);
    }

    await ctx.reportProgress(100, 'Auf YouTube veroeffentlicht');
    return {
      externalPostId: videoId,
      externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      raw: result,
    } satisfies PublishResult;
  },

  async fetchAnalytics(externalPostId, ctx): Promise<AnalyticsSnapshot> {
    const json = await requestJson<{ items?: Array<{ statistics?: Record<string, string> }> }>({
      url: `${API_URL}/videos?part=statistics&id=${encodeURIComponent(externalPostId)}`,
      accessToken: ctx.credentials.accessToken,
      signal: ctx.signal,
    });

    const stats = json.items?.[0]?.statistics;
    if (!stats) return emptyAnalytics({ note: 'Video nicht gefunden oder keine Statistik verfuegbar' });

    return {
      views: Number(stats.viewCount ?? 0),
      likes: Number(stats.likeCount ?? 0),
      comments: Number(stats.commentCount ?? 0),
      shares: 0,
      followersGained: 0,
      watchTimeSec: 0,
      raw: stats,
    };
  },
};
