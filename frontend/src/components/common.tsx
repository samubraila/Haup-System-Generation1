import { Link } from 'react-router-dom';
import { AlertCircle, Clock, Film, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Card, Progress, StatusDot } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import {
  cn,
  formatDuration,
  formatNumber,
  formatRelative,
  JOB_STATUS,
  PLATFORM_META,
  POST_STATUS,
  toneClasses,
  VIDEO_STATUS,
} from '@/lib/format';
import type { JobStatus, Platform, PostStatus, Video, VideoStatus } from '@/lib/types';

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function VideoStatusBadge({ status, className }: { status: VideoStatus; className?: string }) {
  const meta = VIDEO_STATUS[status] ?? VIDEO_STATUS.DRAFT;
  return (
    <Badge tone={toneClasses(meta.tone)} className={className}>
      <StatusDot className={meta.dot} pulse={meta.tone === 'progress'} />
      {meta.label}
    </Badge>
  );
}

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const meta = JOB_STATUS[status] ?? JOB_STATUS.PENDING;
  return (
    <Badge tone={toneClasses(meta.tone)} className={className}>
      <StatusDot className={meta.dot} pulse={meta.tone === 'progress'} />
      {meta.label}
    </Badge>
  );
}

export function PostStatusBadge({ status, className }: { status: PostStatus; className?: string }) {
  const meta = POST_STATUS[status] ?? POST_STATUS.draft;
  return (
    <Badge tone={toneClasses(meta.tone)} className={className}>
      <StatusDot className={meta.dot} pulse={meta.tone === 'progress'} />
      {meta.label}
    </Badge>
  );
}

export function PlatformChip({ platform, size = 'md' }: { platform: Platform; size?: 'sm' | 'md' }) {
  const meta = PLATFORM_META[platform];
  if (!meta) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-raised font-medium text-ink-muted',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
      )}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warn' | 'danger' | 'brand';
  to?: string;
}) {
  const tones = {
    default: 'text-ink',
    success: 'text-state-success',
    warn: 'text-state-warn',
    danger: 'text-state-danger',
    brand: 'text-brand-400',
  };

  const content = (
    <Card className={cn('card-hover p-5', to && 'cursor-pointer')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-muted">{label}</p>
          <p className={cn('metric-value mt-2', tones[tone])}>
            {typeof value === 'number' ? formatNumber(value) : value}
          </p>
          {hint ? <p className="mt-1 truncate text-xs text-ink-faint">{hint}</p> : null}
        </div>
        {icon ? <div className="rounded-xl bg-surface-hover p-2.5 text-ink-faint">{icon}</div> : null}
      </div>
    </Card>
  );

  return to ? <Link to={to}>{content}</Link> : content;
}

export function VideoCard({ video }: { video: Video }) {
  const thumbnail = mediaUrl(video.thumbnailMediaId);
  const inProgress = ['QUEUED', 'GENERATING', 'PROCESSING', 'WAITING_FOR_GPU'].includes(video.status);

  return (
    <Link to={`/videos/${video.id}`} className="group block">
      <Card className="card-hover overflow-hidden">
        <div
          className={cn(
            'relative flex items-center justify-center overflow-hidden bg-canvas',
            video.aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[3/4]',
          )}
        >
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-ink-faint">
              <Film className="h-8 w-8" />
              <span className="text-xs">Kein Vorschaubild</span>
            </div>
          )}

          {video.finalMediaId ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="rounded-full bg-white/15 p-3 backdrop-blur">
                <Play className="h-6 w-6 text-white" />
              </span>
            </span>
          ) : null}

          <span className="absolute left-2 top-2">
            <VideoStatusBadge status={video.status} />
          </span>

          {video.durationSec ? (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {formatDuration(video.durationSec)}
            </span>
          ) : null}
        </div>

        <div className="space-y-2.5 p-4">
          <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-ink">{video.title}</p>

          {inProgress ? <Progress value={video.progress} showLabel /> : null}

          {video.status === 'FAILED' && video.error ? (
            <p className="flex items-start gap-1.5 text-xs text-state-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-2">{video.error}</span>
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            {(video.platforms ?? []).map((platform) => (
              <PlatformChip key={platform} platform={platform as Platform} size="sm" />
            ))}
          </div>

          <div className="flex items-center justify-between text-xs text-ink-faint">
            <span className="truncate">{video.projectName ?? ''}</span>
            <span className="flex shrink-0 items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelative(video.createdAt)}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function SectionGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', className)}>{children}</div>
  );
}

export function LoadingGrid({ count = 8 }: { count?: number }) {
  return (
    <SectionGrid>
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="overflow-hidden">
          <div className="skeleton aspect-[3/4] rounded-none" />
          <div className="space-y-2 p-4">
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </SectionGrid>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-state-danger/30 bg-state-danger/10 p-4 text-sm text-state-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
