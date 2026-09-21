import path from 'node:path';
import type { RenderTarget, SubtitleStyle } from '@acf/worker-core';
import { buildForceStyle, escapeFilterPath, overlayPosition, probe, run, type MediaInfo } from './ffmpeg.js';

export interface RenderInputs {
  workDir: string;
  clipPaths: string[];
  audioPath: string | null;
  musicPath: string | null;
  musicVolume: number;
  subtitleFileName: string | null;
  subtitleStyle: SubtitleStyle;
  burnSubtitles: boolean;
  watermarkPath: string | null;
  watermarkPosition: string;
  watermarkOpacity: number;
}

export interface RenderOutcome {
  outputPath: string;
  info: MediaInfo;
}

export async function renderTarget(
  inputs: RenderInputs,
  target: RenderTarget,
  options: { signal: AbortSignal; onProgress?: (fraction: number) => void; totalSourceSec: number },
): Promise<RenderOutcome> {
  const outputName = `render-${target.key}-${target.width}x${target.height}.mp4`;
  const outputPath = path.join(inputs.workDir, outputName);

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error', '-stats'];

  for (const clip of inputs.clipPaths) args.push('-i', clip);

  let inputIndex = inputs.clipPaths.length;
  let voiceIndex = -1;
  let musicIndex = -1;
  let watermarkIndex = -1;

  if (inputs.audioPath) {
    args.push('-i', inputs.audioPath);
    voiceIndex = inputIndex++;
  }
  if (inputs.musicPath) {
    args.push('-i', inputs.musicPath);
    musicIndex = inputIndex++;
  }
  if (inputs.watermarkPath) {
    args.push('-i', inputs.watermarkPath);
    watermarkIndex = inputIndex++;
  }

  const hasExternalAudio = voiceIndex >= 0 || musicIndex >= 0;
  if (!hasExternalAudio) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    inputIndex += 1;
  }

  const filters: string[] = [];

  const scaled = inputs.clipPaths.map((_, index) => {
    const label = `v${index}`;
    filters.push(
      `[${index}:v]scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,` +
        `crop=${target.width}:${target.height},fps=${target.fps},setsar=1,format=yuv420p[${label}]`,
    );
    return `[${label}]`;
  });

  let videoLabel = '[vcat]';
  if (scaled.length === 1) {
    videoLabel = scaled[0]!;
  } else {
    filters.push(`${scaled.join('')}concat=n=${scaled.length}:v=1:a=0[vcat]`);
  }

  if (inputs.watermarkPath && watermarkIndex >= 0) {
    filters.push(
      `[${watermarkIndex}:v]format=rgba,colorchannelmixer=aa=${inputs.watermarkOpacity.toFixed(2)},` +
        `scale=${Math.round(target.width * 0.16)}:-1[wm]`,
    );
    filters.push(`${videoLabel}[wm]overlay=${overlayPosition(inputs.watermarkPosition)}[vwm]`);
    videoLabel = '[vwm]';
  }

  if (inputs.burnSubtitles && inputs.subtitleFileName) {
    const scaleFactor = target.height / 1920;
    const forceStyle = buildForceStyle(inputs.subtitleStyle, scaleFactor);
    filters.push(
      `${videoLabel}subtitles=${escapeFilterPath(inputs.subtitleFileName)}:force_style='${forceStyle}'[vsub]`,
    );
    videoLabel = '[vsub]';
  }

  let audioLabel: string;
  if (voiceIndex >= 0 && musicIndex >= 0) {
    filters.push(`[${musicIndex}:a]volume=${inputs.musicVolume.toFixed(2)},aloop=loop=-1:size=2e9[music]`);
    filters.push(`[${voiceIndex}:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
    audioLabel = '[aout]';
  } else if (voiceIndex >= 0) {
    filters.push(`[${voiceIndex}:a]aresample=44100[aout]`);
    audioLabel = '[aout]';
  } else if (musicIndex >= 0) {
    filters.push(`[${musicIndex}:a]volume=${inputs.musicVolume.toFixed(2)},aresample=44100[aout]`);
    audioLabel = '[aout]';
  } else {
    audioLabel = `${inputIndex - 1}:a`;
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', videoLabel, '-map', audioLabel);

  args.push(
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-b:v', target.videoBitrate,
    '-maxrate', target.videoBitrate,
    '-bufsize', `${Number.parseInt(target.videoBitrate, 10) * 2}M`,
    '-r', String(target.fps),
    '-g', String(target.fps * 2),
    '-c:a', 'aac',
    '-b:a', target.audioBitrate,
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    '-shortest',
  );

  if (target.maxDurationSec) args.push('-t', String(target.maxDurationSec));

  args.push(outputPath);

  await run('ffmpeg', args, {
    cwd: inputs.workDir,
    signal: options.signal,
    onProgress: (seconds) => {
      if (options.totalSourceSec > 0) {
        options.onProgress?.(Math.min(1, seconds / options.totalSourceSec));
      }
    },
  });

  const info = await probe(outputPath, options.signal);
  return { outputPath, info };
}

export async function extractThumbnail(
  videoPath: string,
  workDir: string,
  atSec: number,
  signal: AbortSignal,
): Promise<string> {
  const outputPath = path.join(workDir, 'thumbnail.jpg');
  await run(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', String(Math.max(0, atSec)),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ],
    { cwd: workDir, signal },
  );
  return outputPath;
}
