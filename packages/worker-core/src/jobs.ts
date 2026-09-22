import { z } from 'zod';

/**
 * Vertraege zwischen Backend und Worker.
 *
 * Diese Schemas sind die einzige erlaubte Kopplung: das Backend erzeugt genau
 * diese Payloads, der Worker validiert sie. Wird hier etwas geaendert, muss
 * auch das Python-Gegenstueck (workers/_shared/acfworker/schemas.py) folgen.
 */

export const aspectRatioSchema = z.enum(['9:16', '16:9', '1:1', '4:5']);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const languageSchema = z.enum(['de', 'en', 'es', 'fr', 'it']);
export type Language = z.infer<typeof languageSchema>;

export const platformSchema = z.enum(['youtube', 'tiktok', 'instagram', 'facebook']);
export type Platform = z.infer<typeof platformSchema>;

export const videoFormatSchema = z.enum([
  'youtube_video',
  'youtube_short',
  'tiktok',
  'instagram_reel',
  'facebook_reel',
]);
export type VideoFormat = z.infer<typeof videoFormatSchema>;

// --- script-worker ----------------------------------------------------------

export const scriptJobSchema = z.object({
  projectId: z.string().uuid(),
  videoId: z.string().uuid(),
  title: z.string().min(1),
  topic: z.string().min(1),
  description: z.string().default(''),
  language: languageSchema,
  style: z.string().default('cinematic'),
  durationSec: z.number().int().positive(),
  format: videoFormatSchema,
  /** Zusaetzliche Anweisungen aus dem Projekt-Preset. */
  guidance: z.string().default(''),
});
export type ScriptJob = z.infer<typeof scriptJobSchema>;

// --- image-worker -----------------------------------------------------------

export const imageJobSchema = z.object({
  projectId: z.string().uuid(),
  videoId: z.string().uuid().nullable().default(null),
  prompts: z.array(z.string().min(1)).min(1),
  negativePrompt: z.string().default(''),
  width: z.number().int().positive().default(1080),
  height: z.number().int().positive().default(1920),
  steps: z.number().int().positive().default(28),
  seed: z.number().int().nullable().default(null),
});
export type ImageJob = z.infer<typeof imageJobSchema>;

// --- video-worker (lokale Video-KI) -----------------------------------------

export const videoProviderSchema = z.enum([
  'stock',
  'slideshow',
  'ltx',
  'wan',
  'comfyui',
  'placeholder',
]);
export type VideoProvider = z.infer<typeof videoProviderSchema>;

export const motionSchema = z.enum(['none', 'kenburns', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right']);
export type Motion = z.infer<typeof motionSchema>;

export const videoJobSchema = z.object({
  projectId: z.string().uuid(),
  videoId: z.string().uuid(),
  prompt: z.string().min(1),
  negativePrompt: z.string().default(''),
  provider: videoProviderSchema.default('placeholder'),
  keywords: z.array(z.string()).default([]),
  motion: motionSchema.default('kenburns'),
  motionStrength: z.number().min(0).max(1).default(0.35),
  imagePaths: z.array(z.string()).default([]),
  stockOrientation: z.enum(['portrait', 'landscape', 'square']).default('portrait'),
  width: z.number().int().positive().default(768),
  height: z.number().int().positive().default(1344),
  fps: z.number().int().positive().default(24),
  durationSec: z.number().positive().default(5),
  seed: z.number().int().nullable().default(null),
  steps: z.number().int().positive().default(30),
  guidanceScale: z.number().positive().default(3.5),
  /** Optionales Startbild fuer Image-to-Video. */
  initImagePath: z.string().nullable().default(null),
  /** Mehrere Szenen werden nacheinander erzeugt und spaeter zusammengeschnitten. */
  sceneIndex: z.number().int().min(0).default(0),
  sceneCount: z.number().int().min(1).default(1),
});
export type VideoJob = z.infer<typeof videoJobSchema>;

// --- voice-worker -----------------------------------------------------------

export const voiceJobSchema = z.object({
  projectId: z.string().uuid(),
  videoId: z.string().uuid(),
  text: z.string().min(1),
  language: languageSchema,
  voice: z.string().default('default'),
  speed: z.number().positive().default(1.0),
});
export type VoiceJob = z.infer<typeof voiceJobSchema>;

// --- subtitle-worker --------------------------------------------------------

export const subtitleStyleSchema = z.object({
  font: z.string().default('DejaVu Sans'),
  fontSize: z.number().int().positive().default(48),
  primaryColor: z.string().default('#FFFFFF'),
  outlineColor: z.string().default('#000000'),
  backgroundColor: z.string().nullable().default(null),
  position: z.enum(['top', 'center', 'bottom']).default('bottom'),
  marginVertical: z.number().int().min(0).default(120),
  bold: z.boolean().default(true),
  uppercase: z.boolean().default(false),
  /** Karaoke hebt das gerade gesprochene Wort hervor. */
  animation: z.enum(['none', 'fade', 'karaoke', 'pop']).default('none'),
  maxCharsPerLine: z.number().int().positive().default(38),
  highlightColor: z.string().default('#FACC15'),
});
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;

export const subtitleJobSchema = z.object({
  projectId: z.string().uuid(),
  videoId: z.string().uuid(),
  /** Quelle fuer die Spracherkennung: Audiodatei oder Video mit Tonspur. */
  sourcePath: z.string().min(1),
  language: languageSchema,
  /** Liegt bereits ein Skript vor, verbessert es die Erkennungsgenauigkeit. */
  transcriptHint: z.string().default(''),
  style: subtitleStyleSchema.default({}),
  videoWidth: z.number().int().positive().default(1080),
  videoHeight: z.number().int().positive().default(1920),
});
export type SubtitleJob = z.infer<typeof subtitleJobSchema>;

// --- ffmpeg-worker ----------------------------------------------------------

export const renderTargetSchema = z.object({
  /** Kennung des Ausgabeformats, z.B. "youtube" oder "tiktok". */
  key: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().default(30),
  videoBitrate: z.string().default('8M'),
  audioBitrate: z.string().default('192k'),
  maxDurationSec: z.number().positive().nullable().default(null),
});
export type RenderTarget = z.infer<typeof renderTargetSchema>;

export const transitionSchema = z.enum(['none', 'fade', 'slideleft', 'wipeleft', 'circleopen', 'dissolve']);
export type Transition = z.infer<typeof transitionSchema>;

export const colorGradeSchema = z.enum(['none', 'cinematic', 'warm', 'cool', 'vivid', 'muted']);
export type ColorGrade = z.infer<typeof colorGradeSchema>;

export const ffmpegJobSchema = z.object({
  projectId: z.string().uuid(),
  videoId: z.string().uuid(),
  /** Ein oder mehrere KI-Clips, die in dieser Reihenfolge aneinandergehaengt werden. */
  sourcePaths: z.array(z.string().min(1)).min(1),
  transition: transitionSchema.default('fade'),
  transitionDurationSec: z.number().min(0).max(2).default(0.4),
  colorGrade: colorGradeSchema.default('cinematic'),
  vignette: z.boolean().default(true),
  titleCard: z.string().default(''),
  titleCardDurationSec: z.number().min(0).max(6).default(0),
  subtitleAssPath: z.string().nullable().default(null),
  audioPath: z.string().nullable().default(null),
  musicPath: z.string().nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.15),
  subtitlePath: z.string().nullable().default(null),
  subtitleStyle: subtitleStyleSchema.default({}),
  burnSubtitles: z.boolean().default(true),
  watermarkPath: z.string().nullable().default(null),
  watermarkPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('bottom-right'),
  watermarkOpacity: z.number().min(0).max(1).default(0.8),
  targets: z.array(renderTargetSchema).min(1),
  /** Standbild aus dem fertigen Video als Vorschaubild erzeugen. */
  generateThumbnail: z.boolean().default(true),
  thumbnailAtSec: z.number().min(0).default(1),
});
export type FfmpegJob = z.infer<typeof ffmpegJobSchema>;

// --- publisher-worker -------------------------------------------------------

export const publishJobSchema = z.object({
  postId: z.string().uuid(),
  projectId: z.string().uuid(),
  videoId: z.string().uuid(),
  accountId: z.string().uuid(),
  platform: platformSchema,
  filePath: z.string().min(1),
  thumbnailPath: z.string().nullable().default(null),
  title: z.string().min(1),
  description: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  privacy: z.enum(['public', 'unlisted', 'private']).default('private'),
  /** Von der Plattform selbst geplante Veroeffentlichung (nur YouTube). */
  publishAt: z.string().nullable().default(null),
  madeForKids: z.boolean().default(false),
});
export type PublishJob = z.infer<typeof publishJobSchema>;

/** Standard-Rendervorgaben je Zielplattform. */
export const RENDER_PRESETS: Record<string, RenderTarget> = {
  youtube: { key: 'youtube', width: 1920, height: 1080, fps: 30, videoBitrate: '12M', audioBitrate: '192k', maxDurationSec: null },
  youtube_short: { key: 'youtube_short', width: 1080, height: 1920, fps: 30, videoBitrate: '10M', audioBitrate: '192k', maxDurationSec: 60 },
  tiktok: { key: 'tiktok', width: 1080, height: 1920, fps: 30, videoBitrate: '10M', audioBitrate: '192k', maxDurationSec: 600 },
  instagram_reel: { key: 'instagram_reel', width: 1080, height: 1920, fps: 30, videoBitrate: '10M', audioBitrate: '192k', maxDurationSec: 90 },
  facebook_reel: { key: 'facebook_reel', width: 1080, height: 1920, fps: 30, videoBitrate: '10M', audioBitrate: '192k', maxDurationSec: 90 },
  square: { key: 'square', width: 1080, height: 1080, fps: 30, videoBitrate: '8M', audioBitrate: '192k', maxDurationSec: null },
};

/** Aufloesung zu einem Seitenverhaeltnis (Basisbreite 1080). */
export function resolutionFor(aspect: AspectRatio): { width: number; height: number } {
  switch (aspect) {
    case '16:9':
      return { width: 1920, height: 1080 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:5':
      return { width: 1080, height: 1350 };
    case '9:16':
    default:
      return { width: 1080, height: 1920 };
  }
}
