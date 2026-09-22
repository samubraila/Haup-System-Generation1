import { z } from 'zod';
import { colorGradeSchema, motionSchema, subtitleStyleSchema, transitionSchema, videoProviderSchema } from '@acf/worker-core';

export const projectSettingsSchema = z.object({
  scriptProvider: z.enum(['template', 'ollama']).default('template'),
  ollamaUrl: z.string().default('http://host.docker.internal:11434'),
  ollamaModel: z.string().default('llama3.1:8b'),
  videoProvider: videoProviderSchema.default('placeholder'),
  sceneCount: z.number().int().min(1).max(20).default(4),
  motion: motionSchema.default('kenburns'),
  motionStrength: z.number().min(0).max(1).default(0.35),
  transition: transitionSchema.default('fade'),
  transitionDurationSec: z.number().min(0).max(2).default(0.4),
  colorGrade: colorGradeSchema.default('cinematic'),
  vignette: z.boolean().default(true),
  titleCardDurationSec: z.number().min(0).max(6).default(0),
  voiceEnabled: z.boolean().default(false),
  voiceName: z.string().default('default'),
  voiceSpeed: z.number().min(0.5).max(2).default(1),
  subtitlesEnabled: z.boolean().default(true),
  subtitleStyle: subtitleStyleSchema.default({}),
  burnSubtitles: z.boolean().default(true),
  watermarkPath: z.string().nullable().default(null),
  watermarkPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('bottom-right'),
  watermarkOpacity: z.number().min(0).max(1).default(0.8),
  musicPath: z.string().nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.15),
  negativePrompt: z.string().default(''),
  promptSuffix: z.string().default(''),
  hashtagPresets: z.array(z.string()).default([]),
  defaultPrivacy: z.enum(['public', 'unlisted', 'private']).default('private'),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export function parseProjectSettings(raw: unknown): ProjectSettings {
  const result = projectSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : projectSettingsSchema.parse({});
}

export type VideoStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'WAITING_FOR_GPU'
  | 'GENERATING'
  | 'PROCESSING'
  | 'GENERATED'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'ARCHIVED';

export type JobType = 'script' | 'image' | 'video' | 'voice' | 'subtitle' | 'ffmpeg';

export interface VideoRow {
  id: string;
  project_id: string;
  idea_id: string | null;
  script_id: string | null;
  title: string;
  topic: string;
  description: string;
  language: string;
  style: string;
  format: string;
  aspect_ratio: string;
  duration_sec: number;
  status: VideoStatus;
  progress: number;
  require_approval: boolean;
  error: string | null;
  meta: Record<string, unknown>;
  source_media_id: string | null;
  audio_media_id: string | null;
  subtitle_media_id: string | null;
  final_media_id: string | null;
  thumbnail_media_id: string | null;
  generated_at: Date | null;
  approved_at: Date | null;
  approved_by: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string;
  language: string;
  style: string;
  default_duration_sec: number;
  default_format: string;
  default_aspect: string;
  platforms: string[];
  require_approval: boolean;
  settings: Record<string, unknown>;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MediaRow {
  id: string;
  project_id: string;
  video_id: string | null;
  kind: string;
  path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  meta: Record<string, unknown>;
  created_at: Date;
}

export interface VideoJobRow {
  id: string;
  video_id: string | null;
  project_id: string;
  type: JobType;
  queue: string;
  queue_job_id: string | null;
  status: 'PENDING' | 'WAITING_FOR_GPU' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  provider: string;
  priority: number;
  progress: number;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  status_reason: string | null;
  worker_id: string | null;
  eta_seconds: number | null;
  step_index: number;
  step_total: number;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SocialAccountRow {
  id: string;
  user_id: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
  account_name: string;
  external_id: string;
  avatar_url: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'expired';
  scopes: string[];
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: Date | null;
  connected_at: Date | null;
  last_checked_at: Date | null;
  last_error: string | null;
  requires_reconnect: boolean;
  meta: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface SocialPostRow {
  id: string;
  video_id: string;
  project_id: string;
  social_account_id: string | null;
  platform: string;
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  privacy: 'public' | 'unlisted' | 'private';
  status: 'draft' | 'scheduled' | 'queued' | 'processing' | 'published' | 'failed' | 'cancelled';
  scheduled_at: Date | null;
  published_at: Date | null;
  external_post_id: string | null;
  external_url: string | null;
  error: string | null;
  requires_reconnect: boolean;
  media_id: string | null;
  meta: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
