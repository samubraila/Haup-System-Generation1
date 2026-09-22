import { spawn } from 'node:child_process';

export interface MediaInfo {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  sizeBytes: number;
}

export interface RunOptions {
  cwd?: string;
  signal?: AbortSignal;
  onProgress?: (seconds: number) => void;
  totalDurationSec?: number;
}

export async function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);

      if (options.onProgress) {
        const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text);
        if (match) {
          const seconds =
            Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          options.onProgress(seconds);
        }
      }
    });

    const abortHandler = () => child.kill('SIGKILL');
    options.signal?.addEventListener('abort', abortHandler);

    child.on('error', (err) => {
      options.signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`${command} konnte nicht gestartet werden: ${err.message}`));
    });

    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abortHandler);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} beendet mit Code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

export async function probe(filePath: string, signal?: AbortSignal): Promise<MediaInfo> {
  const output = await run(
    'ffprobe',
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { signal },
  );

  const data = JSON.parse(output) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      duration?: string;
    }>;
  };

  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');

  let fps = 30;
  if (video?.r_frame_rate) {
    const [numerator, denominator] = video.r_frame_rate.split('/').map(Number);
    if (numerator && denominator) fps = Math.round(numerator / denominator);
  }

  return {
    durationSec: Number(data.format?.duration ?? video?.duration ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps,
    hasAudio: Boolean(audio),
    sizeBytes: Number(data.format?.size ?? 0),
  };
}

export async function ffmpegVersion(): Promise<string> {
  const output = await run('ffmpeg', ['-version']);
  return output.split('\n')[0]?.trim() ?? 'unbekannt';
}

export function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = hex.replace('#', '').trim();
  const value = clean.length === 3
    ? clean.split('').map((char) => char + char).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const red = value.slice(0, 2);
  const green = value.slice(2, 4);
  const blue = value.slice(4, 6);
  return `&H${alphaHex}${blue}${green}${red}`.toUpperCase();
}

export interface SubtitleStyleInput {
  font: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  backgroundColor: string | null;
  position: 'top' | 'center' | 'bottom';
  marginVertical: number;
  bold: boolean;
  uppercase: boolean;
  animation: 'none' | 'fade' | 'karaoke' | 'pop';
  maxCharsPerLine: number;
  highlightColor?: string;
}

export function buildForceStyle(style: SubtitleStyleInput, scaleFactor: number): string {
  const alignment = style.position === 'top' ? 8 : style.position === 'center' ? 5 : 2;
  const parts = [
    `FontName=${style.font}`,
    `FontSize=${Math.max(12, Math.round(style.fontSize * scaleFactor))}`,
    `PrimaryColour=${hexToAssColor(style.primaryColor)}`,
    `OutlineColour=${hexToAssColor(style.outlineColor)}`,
    `Bold=${style.bold ? 1 : 0}`,
    `Alignment=${alignment}`,
    `MarginV=${Math.max(0, Math.round(style.marginVertical * scaleFactor))}`,
    'Outline=3',
    'Shadow=1',
  ];

  if (style.backgroundColor) {
    parts.push(`BackColour=${hexToAssColor(style.backgroundColor, '40')}`, 'BorderStyle=3');
  }

  return parts.join(',');
}

export function escapeFilterPath(fileName: string): string {
  return fileName.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

const OVERLAY_POSITION: Record<string, string> = {
  'top-left': '24:24',
  'top-right': 'W-w-24:24',
  'bottom-left': '24:H-h-24',
  'bottom-right': 'W-w-24:H-h-24',
};

export function overlayPosition(position: string): string {
  return OVERLAY_POSITION[position] ?? OVERLAY_POSITION['bottom-right']!;
}

export function escapeDrawText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '')
    .replace(/%/g, '\\%')
    .slice(0, 200);
}
