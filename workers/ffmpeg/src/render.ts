import path from 'node:path';
import type { ColorGrade, RenderTarget, SubtitleStyle, Transition } from '@acf/worker-core';
import {
  buildForceStyle,
  escapeDrawText,
  escapeFilterPath,
  overlayPosition,
  probe,
  run,
  type MediaInfo,
} from './ffmpeg.js';

export interface RenderInputs {
  workDir: string;
  clipPaths: string[];
  clipDurations: number[];
  audioPath: string | null;
  musicPath: string | null;
  musicVolume: number;
  subtitleFileName: string | null;
  subtitleIsAss: boolean;
  subtitleStyle: SubtitleStyle;
  burnSubtitles: boolean;
  watermarkPath: string | null;
  watermarkPosition: string;
  watermarkOpacity: number;
  transition: Transition;
  transitionDurationSec: number;
  colorGrade: ColorGrade;
  vignette: boolean;
  titleCard: string;
  titleCardDurationSec: number;
}

export interface RenderOutcome {
  outputPath: string;
  info: MediaInfo;
}

const XFADE_NAME: Record<Transition, string> = {
  none: 'fade',
  fade: 'fade',
  dissolve: 'dissolve',
  slideleft: 'slideleft',
  wipeleft: 'wipeleft',
  circleopen: 'circleopen',
};

const GRADE_FILTER: Record<ColorGrade, string> = {
  none: '',
  cinematic: 'eq=contrast=1.08:saturation=0.97:gamma=1.02,colorbalance=rs=-0.02:bs=0.04',
  warm: 'eq=contrast=1.04:saturation=1.08,colorbalance=rs=0.06:gs=0.02:bs=-0.05',
  cool: 'eq=contrast=1.04:saturation=1.02,colorbalance=rs=-0.05:bs=0.07',
  vivid: 'eq=contrast=1.12:saturation=1.35:gamma=1.01',
  muted: 'eq=contrast=0.96:saturation=0.72:gamma=1.03',
};

export function effectiveTransitionSec(inputs: RenderInputs): number {
  if (inputs.transition === 'none' || inputs.clipPaths.length < 2) return 0;
  const usable = inputs.clipDurations.filter((value) => value > 0);
  if (usable.length !== inputs.clipPaths.length) return 0;
  const shortest = Math.min(...usable);
  return Math.max(0, Math.min(inputs.transitionDurationSec, shortest / 2 - 0.05));
}

export function buildVideoChain(inputs: RenderInputs, target: RenderTarget): { filters: string[]; label: string } {
  const filters: string[] = [];

  const scaled = inputs.clipPaths.map((_, index) => {
    const label = `v${index}`;
    filters.push(
      `[${index}:v]scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,` +
        `crop=${target.width}:${target.height},fps=${target.fps},setsar=1,format=yuv420p[${label}]`,
    );
    return label;
  });

  let label: string;
  const transitionSec = effectiveTransitionSec(inputs);

  if (scaled.length === 1) {
    label = scaled[0]!;
  } else if (transitionSec <= 0) {
    filters.push(`${scaled.map((name) => `[${name}]`).join('')}concat=n=${scaled.length}:v=1:a=0[vcat]`);
    label = 'vcat';
  } else {
    let previous = scaled[0]!;
    let elapsed = inputs.clipDurations[0] ?? 0;

    for (let index = 1; index < scaled.length; index++) {
      const next = scaled[index]!;
      const out = index === scaled.length - 1 ? 'vcat' : `vx${index}`;
      const offset = Math.max(0, elapsed - transitionSec);
      filters.push(
        `[${previous}][${next}]xfade=transition=${XFADE_NAME[inputs.transition]}:` +
          `duration=${transitionSec.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`,
      );
      elapsed = offset + (inputs.clipDurations[index] ?? 0);
      previous = out;
    }
    label = previous;
  }

  const polish = [GRADE_FILTER[inputs.colorGrade], inputs.vignette ? 'vignette=PI/5' : '']
    .filter(Boolean)
    .join(',');
  if (polish) {
    filters.push(`[${label}]${polish}[vgrade]`);
    label = 'vgrade';
  }

  return { filters, label };
}

export function buildTitleCardFilter(
  input: string,
  text: string,
  holdSec: number,
  height: number,
): { filter: string; label: string } {
  const fade = Math.min(0.5, holdSec / 3);
  const fontSize = Math.round(height * 0.055);
  const filter =
    `[${input}]drawtext=text='${escapeDrawText(text)}':` +
    `fontcolor=white:fontsize=${fontSize}:line_spacing=${Math.round(fontSize * 0.3)}:` +
    `box=1:boxcolor=black@0.45:boxborderw=${Math.round(fontSize * 0.5)}:` +
    `x=(w-text_w)/2:y=(h-text_h)/2:` +
    `alpha='if(lt(t,${fade.toFixed(2)}),t/${fade.toFixed(2)},` +
    `if(lt(t,${(holdSec - fade).toFixed(2)}),1,max(0,(${holdSec.toFixed(2)}-t)/${fade.toFixed(2)})))':` +
    `enable='lt(t,${holdSec.toFixed(2)})'[vtitle]`;
  return { filter, label: 'vtitle' };
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

  const chain = buildVideoChain(inputs, target);
  const filters = chain.filters;
  let videoLabel = chain.label;

  if (inputs.watermarkPath && watermarkIndex >= 0) {
    filters.push(
      `[${watermarkIndex}:v]format=rgba,colorchannelmixer=aa=${inputs.watermarkOpacity.toFixed(2)},` +
        `scale=${Math.round(target.width * 0.16)}:-1[wm]`,
    );
    filters.push(`[${videoLabel}][wm]overlay=${overlayPosition(inputs.watermarkPosition)}[vwm]`);
    videoLabel = 'vwm';
  }

  if (inputs.burnSubtitles && inputs.subtitleFileName) {
    const subtitleFilter = inputs.subtitleIsAss
      ? `subtitles=${escapeFilterPath(inputs.subtitleFileName)}`
      : `subtitles=${escapeFilterPath(inputs.subtitleFileName)}:force_style='${buildForceStyle(
          inputs.subtitleStyle,
          target.height / 1920,
        )}'`;
    filters.push(`[${videoLabel}]${subtitleFilter}[vsub]`);
    videoLabel = 'vsub';
  }

  if (inputs.titleCard.trim() && inputs.titleCardDurationSec > 0) {
    const card = buildTitleCardFilter(videoLabel, inputs.titleCard, inputs.titleCardDurationSec, target.height);
    filters.push(card.filter);
    videoLabel = card.label;
  }

  let audioLabel: string;
  if (voiceIndex >= 0 && musicIndex >= 0) {
    filters.push(`[${musicIndex}:a]volume=${inputs.musicVolume.toFixed(2)},aloop=loop=-1:size=2e9[music]`);
    filters.push(`[${voiceIndex}:a][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`);
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
  args.push('-map', `[${videoLabel}]`, '-map', audioLabel);

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
