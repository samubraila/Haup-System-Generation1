import fs from 'node:fs/promises';
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

const GRAPH = 'https://graph.facebook.com/v21.0';
const RUPLOAD = 'https://rupload.facebook.com/ig-api-upload/v21.0';
const MAX_STATUS_POLLS = 60;
const POLL_INTERVAL_MS = 5000;

function pageToken(ctx: AdapterContext): string {
  const token = ctx.credentials.meta.pageAccessToken;
  return typeof token === 'string' && token.length > 0 ? token : ctx.credentials.accessToken;
}

export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',
  label: 'Instagram',
  maxFileBytes: 1024 * 1024 * 1024,
  supportedMimeTypes: ['video/mp4', 'video/quicktime'],

  async publish(input, ctx) {
    const igUserId = ctx.credentials.externalId;
    if (!igUserId) {
      throw new PlatformRejectedError('Dem Konto ist kein Instagram-Business-Konto zugeordnet');
    }

    const stat = await fs.stat(input.localVideoPath);
    if (stat.size === 0) throw new PlatformRejectedError('Die Videodatei ist leer');

    const token = pageToken(ctx);
    const caption = buildCaption(input.title, input.description, input.hashtags, 2200);

    await ctx.reportProgress(5, 'Container wird bei Instagram angelegt');

    const container = await requestJson<{ id?: string; uri?: string }>({
      url: `${GRAPH}/${igUserId}/media`,
      method: 'POST',
      signal: ctx.signal,
      body: {
        media_type: 'REELS',
        upload_type: 'resumable',
        caption,
        share_to_feed: true,
        access_token: token,
      },
    });

    const containerId = container.id;
    if (!containerId) throw new PlatformRejectedError('Instagram hat keine Container-ID geliefert');

    ctx.log('Instagram-Container angelegt', { containerId });
    await ctx.reportProgress(15, 'Video wird uebertragen');

    const data = await fs.readFile(input.localVideoPath);
    const uploadResponse = await fetch(`${RUPLOAD}/${containerId}`, {
      method: 'POST',
      headers: {
        authorization: `OAuth ${token}`,
        offset: '0',
        file_size: String(stat.size),
        'content-type': 'application/octet-stream',
      },
      body: data,
      signal: ctx.signal,
    });

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* Klartext-Antwort */
      }
      throw toPlatformError(uploadResponse.status, json, text);
    }

    await ctx.reportProgress(60, 'Instagram verarbeitet das Video');

    let ready = false;
    for (let poll = 0; poll < MAX_STATUS_POLLS && !ready; poll++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (ctx.signal.aborted) throw new Error('Abgebrochen');

      const status = await requestJson<{ status_code?: string; status?: string }>({
        url: `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
        signal: ctx.signal,
      });

      if (status.status_code === 'FINISHED') ready = true;
      else if (status.status_code === 'ERROR') {
        throw new PlatformRejectedError(`Instagram konnte das Video nicht verarbeiten: ${status.status ?? 'unbekannt'}`);
      } else {
        await ctx.reportProgress(60 + Math.min(20, poll), `Status: ${status.status_code ?? 'IN_PROGRESS'}`);
      }
    }

    if (!ready) throw new Error('Instagram hat die Verarbeitung nicht innerhalb der Wartezeit abgeschlossen');

    await ctx.reportProgress(90, 'Beitrag wird veroeffentlicht');
    const published = await requestJson<{ id?: string }>({
      url: `${GRAPH}/${igUserId}/media_publish`,
      method: 'POST',
      signal: ctx.signal,
      body: { creation_id: containerId, access_token: token },
    });

    const mediaId = published.id;
    if (!mediaId) throw new PlatformRejectedError('Instagram hat keine Beitrags-ID geliefert');

    const permalink = await requestJson<{ permalink?: string }>({
      url: `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      signal: ctx.signal,
    }).catch(() => ({ permalink: undefined }));

    await ctx.reportProgress(100, 'Auf Instagram veroeffentlicht');
    return {
      externalPostId: mediaId,
      externalUrl: permalink.permalink ?? null,
      raw: { containerId },
    } satisfies PublishResult;
  },

  async fetchAnalytics(externalPostId, ctx): Promise<AnalyticsSnapshot> {
    const token = pageToken(ctx);

    const insights = await requestJson<{ data?: Array<{ name: string; values?: Array<{ value: number }> }> }>({
      url: `${GRAPH}/${externalPostId}/insights?metric=plays,likes,comments,shares,saved,reach&access_token=${encodeURIComponent(token)}`,
      signal: ctx.signal,
    }).catch((err: Error) => {
      ctx.log(`Instagram-Insights nicht abrufbar: ${err.message}`);
      return { data: [] };
    });

    const values: Record<string, number> = {};
    for (const entry of insights.data ?? []) {
      values[entry.name] = entry.values?.[0]?.value ?? 0;
    }

    if (Object.keys(values).length === 0) {
      return emptyAnalytics({ note: 'Insights erst einige Zeit nach der Veroeffentlichung verfuegbar' });
    }

    return {
      views: values.plays ?? values.reach ?? 0,
      likes: values.likes ?? 0,
      comments: values.comments ?? 0,
      shares: values.shares ?? 0,
      followersGained: 0,
      watchTimeSec: 0,
      raw: values,
    };
  },
};
