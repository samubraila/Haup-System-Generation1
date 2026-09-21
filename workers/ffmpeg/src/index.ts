import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpegJobSchema, PermanentJobError, QUEUES, runWorker } from '@acf/worker-core';
import { ffmpegVersion, probe } from './ffmpeg.js';
import { extractThumbnail, renderTarget } from './render.js';

await runWorker({
  name: 'ffmpeg-worker',
  queue: QUEUES.FFMPEG,
  defaultConcurrency: 1,

  async onStart({ logger }) {
    const version = await ffmpegVersion();
    logger.info({ version }, 'FFmpeg gefunden');
    return { ffmpeg: version };
  },

  async handler(ctx) {
    const parsed = ffmpegJobSchema.safeParse(ctx.data);
    if (!parsed.success) {
      throw new PermanentJobError(
        `Ungueltige Auftragsdaten: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`,
      );
    }
    const job = parsed.data;
    const workDir = await ctx.storage.createTempDir(`render-${job.videoId.slice(0, 8)}`);

    try {
      await ctx.reportProgress(3, 'Quelldateien werden bereitgestellt');

      const clipPaths: string[] = [];
      for (const sourcePath of job.sourcePaths) {
        clipPaths.push(await ctx.storage.pull(sourcePath, workDir));
      }
      if (clipPaths.length === 0) throw new PermanentJobError('Es wurden keine Videoclips uebergeben');

      const audioPath = job.audioPath ? await ctx.storage.pull(job.audioPath, workDir).catch(() => null) : null;
      const musicPath = job.musicPath ? await ctx.storage.pull(job.musicPath, workDir).catch(() => null) : null;
      const watermarkPath = job.watermarkPath
        ? await ctx.storage.pull(job.watermarkPath, workDir).catch(() => null)
        : null;

      let subtitleFileName: string | null = null;
      if (job.subtitlePath && job.burnSubtitles) {
        const pulled = await ctx.storage.pull(job.subtitlePath, workDir).catch(() => null);
        if (pulled) {
          subtitleFileName = 'subtitles.srt';
          await fs.copyFile(pulled, path.join(workDir, subtitleFileName));
        }
      }

      let totalSourceSec = 0;
      for (const clip of clipPaths) {
        const info = await probe(clip, ctx.signal);
        totalSourceSec += info.durationSec;
      }

      ctx.logger.info(
        { clips: clipPaths.length, totalSourceSec, targets: job.targets.map((t) => t.key) },
        'Rendern beginnt',
      );

      const renders: Array<{ mediaId: string; target: string; path: string; width: number; height: number }> = [];
      let primaryLocalPath: string | null = null;
      let primaryMediaId: string | null = null;

      for (const [index, target] of job.targets.entries()) {
        const baseProgress = 10 + (index / job.targets.length) * 75;
        const span = 75 / job.targets.length;

        await ctx.reportProgress(baseProgress, `Rendern: ${target.key} (${target.width}x${target.height})`);

        const outcome = await renderTarget(
          {
            workDir,
            clipPaths,
            audioPath,
            musicPath,
            musicVolume: job.musicVolume,
            subtitleFileName,
            subtitleStyle: job.subtitleStyle,
            burnSubtitles: job.burnSubtitles,
            watermarkPath,
            watermarkPosition: job.watermarkPosition,
            watermarkOpacity: job.watermarkOpacity,
          },
          target,
          {
            signal: ctx.signal,
            totalSourceSec,
            onProgress: (fraction) => {
              void ctx.reportProgress(baseProgress + fraction * span, `Rendern: ${target.key}`);
            },
          },
        );

        const fileName = path.basename(outcome.outputPath);
        const storagePath = ctx.storage.projectPath(job.projectId, 'final', `${job.videoId}-${fileName}`);
        await ctx.storage.push(outcome.outputPath, storagePath, 'video/mp4');

        const media = await ctx.api.registerMedia({
          projectId: job.projectId,
          videoId: job.videoId,
          kind: 'video',
          path: storagePath,
          fileName: `${job.videoId}-${fileName}`,
          mimeType: 'video/mp4',
          sizeBytes: outcome.info.sizeBytes,
          durationMs: Math.round(outcome.info.durationSec * 1000),
          width: outcome.info.width,
          height: outcome.info.height,
          meta: { stage: 'final', target: target.key, fps: outcome.info.fps },
        });

        renders.push({
          mediaId: media.id,
          target: target.key,
          path: storagePath,
          width: outcome.info.width,
          height: outcome.info.height,
        });

        if (!primaryLocalPath) {
          primaryLocalPath = outcome.outputPath;
          primaryMediaId = media.id;
        }
      }

      let thumbnailMediaId: string | null = null;
      if (job.generateThumbnail && primaryLocalPath) {
        await ctx.reportProgress(90, 'Vorschaubild wird erzeugt');
        try {
          const thumbnailPath = await extractThumbnail(primaryLocalPath, workDir, job.thumbnailAtSec, ctx.signal);
          const storagePath = ctx.storage.projectPath(job.projectId, 'thumbnails', `${job.videoId}.jpg`);
          await ctx.storage.push(thumbnailPath, storagePath, 'image/jpeg');
          const stat = await fs.stat(thumbnailPath);
          const media = await ctx.api.registerMedia({
            projectId: job.projectId,
            videoId: job.videoId,
            kind: 'thumbnail',
            path: storagePath,
            fileName: `${job.videoId}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: stat.size,
            meta: { stage: 'final' },
          });
          thumbnailMediaId = media.id;
        } catch (err) {
          ctx.logger.warn({ err: (err as Error).message }, 'Vorschaubild konnte nicht erzeugt werden');
        }
      }

      await ctx.reportProgress(100, 'Rendern abgeschlossen');

      return {
        finalMediaId: primaryMediaId,
        thumbnailMediaId,
        renders,
      };
    } finally {
      await ctx.storage.removeTempDir(workDir);
    }
  },
});
