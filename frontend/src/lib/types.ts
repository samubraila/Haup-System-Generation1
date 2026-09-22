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

export type JobStatus = 'PENDING' | 'WAITING_FOR_GPU' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export type PostStatus = 'draft' | 'scheduled' | 'queued' | 'processing' | 'published' | 'failed' | 'cancelled';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
}

export interface ProjectSettings {
  scriptProvider: 'template' | 'ollama';
  ollamaUrl: string;
  ollamaModel: string;
  videoProvider: VideoProvider;
  sceneCount: number;
  motion: Motion;
  motionStrength: number;
  transition: Transition;
  transitionDurationSec: number;
  colorGrade: ColorGrade;
  vignette: boolean;
  titleCardDurationSec: number;
  voiceEnabled: boolean;
  voiceName: string;
  voiceSpeed: number;
  subtitlesEnabled: boolean;
  subtitleStyle: SubtitleStyle;
  burnSubtitles: boolean;
  watermarkPath: string | null;
  watermarkPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  watermarkOpacity: number;
  musicPath: string | null;
  musicVolume: number;
  negativePrompt: string;
  promptSuffix: string;
  hashtagPresets: string[];
  defaultPrivacy: 'public' | 'unlisted' | 'private';
}

export type VideoProvider = 'stock' | 'slideshow' | 'ltx' | 'wan' | 'comfyui' | 'placeholder';
export type Motion = 'none' | 'kenburns' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';
export type Transition = 'none' | 'fade' | 'slideleft' | 'wipeleft' | 'circleopen' | 'dissolve';
export type ColorGrade = 'none' | 'cinematic' | 'warm' | 'cool' | 'vivid' | 'muted';

export interface SubtitleStyle {
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
  highlightColor: string;
  maxCharsPerLine: number;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  language: string;
  style: string;
  defaultDurationSec: number;
  defaultFormat: string;
  defaultAspect: '9:16' | '16:9' | '1:1' | '4:5';
  platforms: Platform[];
  requireApproval: boolean;
  settings: ProjectSettings;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  videoCount?: number;
  publishedCount?: number;
  storageBytes?: number;
  stats?: { total: number; published: number; failed: number; in_progress: number; review: number };
}

export interface Idea {
  id: string;
  projectId: string;
  title: string;
  topic: string;
  description: string;
  tags: string[];
  status: 'new' | 'approved' | 'used' | 'rejected';
  score: number;
  source: string;
  createdAt: string;
}

export interface Video {
  id: string;
  projectId: string;
  projectName?: string;
  ideaId: string | null;
  scriptId: string | null;
  title: string;
  topic: string;
  description: string;
  language: string;
  style: string;
  format: string;
  aspectRatio: string;
  durationSec: number;
  status: VideoStatus;
  progress: number;
  requireApproval: boolean;
  error: string | null;
  meta: Record<string, unknown>;
  finalMediaId: string | null;
  thumbnailMediaId: string | null;
  subtitleMediaId: string | null;
  audioMediaId: string | null;
  generatedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  platforms?: string[];
}

export interface VideoJob {
  id: string;
  videoId: string | null;
  videoTitle?: string | null;
  projectName?: string;
  type: 'script' | 'image' | 'video' | 'voice' | 'subtitle' | 'ffmpeg';
  label: string;
  queue: string;
  status: JobStatus;
  provider: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  statusReason: string | null;
  workerId: string | null;
  etaSeconds: number | null;
  stepIndex: number;
  stepTotal: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface MediaItem {
  id: string;
  projectId?: string;
  videoId?: string | null;
  kind: 'image' | 'audio' | 'video' | 'subtitle' | 'thumbnail' | 'script' | 'other';
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  meta: Record<string, unknown>;
  createdAt: string;
  url?: string;
}

export interface SocialPost {
  id: string;
  videoId: string;
  platform: Platform;
  accountId: string | null;
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  privacy: 'public' | 'unlisted' | 'private';
  status: PostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  error: string | null;
  requiresReconnect: boolean;
}

export interface SocialAccount {
  id: string;
  platform: Platform;
  accountName: string;
  externalId: string;
  avatarUrl: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'expired';
  scopes: string[];
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  lastError: string | null;
  requiresReconnect: boolean;
  meta: Record<string, unknown>;
}

export interface PlatformStatus {
  platform: Platform;
  label: string;
  configured: boolean;
  missingEnv: string[];
  docsUrl: string;
  scopes: string[];
  accounts: SocialAccount[];
}

export interface QueueStats {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface DashboardData {
  videos: {
    today: number;
    week: number;
    scheduled: number;
    published: number;
    in_progress: number;
    review: number;
    failed: number;
    waiting_gpu: number;
    total: number;
  };
  social: { views: number; likes: number; comments: number; shares: number; followers: number };
  activeJobs: Array<{
    id: string;
    videoId: string | null;
    videoTitle: string | null;
    type: string;
    label: string;
    status: JobStatus;
    progress: number;
    etaSeconds: number | null;
    workerId: string | null;
    stepIndex: number;
    stepTotal: number;
  }>;
  upcoming: Array<{
    id: string;
    platform: Platform;
    title: string;
    scheduledAt: string;
    videoId: string;
    status: PostStatus;
  }>;
  queues: QueueStats[];
  system: {
    online: boolean;
    workerCount: number;
    busyWorkers: number;
    degradedWorkers: number;
    gpu: {
      available: boolean;
      name: string | null;
      totalVramMb: number | null;
      freeVramMb: number | null;
      utilization: number | null;
    };
    cpu: { cores: number; loadAvg1: number };
    memory: { totalBytes: number; freeBytes: number; usedPercent: number };
    storageBytes: number;
  };
}

export interface ServiceState {
  key: string;
  container: string;
  label: string;
  queue: string | null;
  profile: 'core' | 'ai' | 'gpu' | 'publish';
  optional: boolean;
  description: string;
  state: 'online' | 'offline' | 'degraded' | 'unknown';
  detail: Record<string, unknown>;
  reason: string | null;
}

export interface WorkerHeartbeat {
  id: string;
  name: string;
  queue: string | null;
  version: string;
  host: string;
  startedAt: number;
  lastSeen: number;
  status: 'idle' | 'busy' | 'degraded';
  currentJobId: string | null;
  concurrency: number;
  capabilities: Record<string, unknown>;
  reason: string | null;
  lastSeenAgoMs: number;
  uptimeSec: number;
}

export interface CalendarEntry {
  id: string;
  videoId: string;
  videoTitle: string;
  format: string;
  thumbnailMediaId: string | null;
  projectId: string;
  projectName: string;
  platform: Platform;
  status: PostStatus;
  title: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  error: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface LogEntry {
  id: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  context: Record<string, unknown>;
  created_at: string;
}

export interface AnalyticsSummary {
  totals: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    followersGained: number;
    watchTimeSec: number;
    engagementRate: number;
  };
  byPlatform: Array<{
    platform: Platform;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    followersGained: number;
    watchTimeSec: number;
    posts: number;
  }>;
  timeline: Array<{ day: string; views: number; likes: number; comments: number; published: number }>;
}
