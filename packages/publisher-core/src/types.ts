export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export interface Credentials {
  accountId: string;
  platform: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  externalId: string | null;
  meta: Record<string, unknown>;
}

export interface PublishInput {
  postId: string;
  projectId: string;
  videoId: string;
  accountId: string;
  platform: Platform;
  localVideoPath: string;
  localThumbnailPath: string | null;
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  privacy: 'public' | 'unlisted' | 'private';
  publishAt: string | null;
  madeForKids: boolean;
}

export interface PublishResult {
  externalPostId: string;
  externalUrl: string | null;
  raw?: Record<string, unknown>;
}

export interface AnalyticsSnapshot {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  followersGained: number;
  watchTimeSec: number;
  raw: Record<string, unknown>;
}

export interface AdapterContext {
  credentials: Credentials;
  log(message: string, extra?: Record<string, unknown>): void;
  reportProgress(progress: number, message?: string): Promise<void>;
  signal: AbortSignal;
}

export interface PlatformAdapter {
  platform: Platform;
  label: string;
  maxFileBytes: number;
  supportedMimeTypes: string[];
  publish(input: PublishInput, ctx: AdapterContext): Promise<PublishResult>;
  fetchAnalytics(externalPostId: string, ctx: AdapterContext): Promise<AnalyticsSnapshot>;
}

export class ReconnectRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconnectRequiredError';
  }
}

export class PlatformRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformRejectedError';
  }
}

export function emptyAnalytics(raw: Record<string, unknown> = {}): AnalyticsSnapshot {
  return { views: 0, likes: 0, comments: 0, shares: 0, followersGained: 0, watchTimeSec: 0, raw };
}

export function buildCaption(title: string, description: string, hashtags: string[], limit: number): string {
  const tags = hashtags
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .filter((tag) => tag.length > 1)
    .join(' ');
  const parts = [title, description, tags].filter((part) => part && part.trim().length > 0);
  return parts.join('\n\n').slice(0, limit);
}
