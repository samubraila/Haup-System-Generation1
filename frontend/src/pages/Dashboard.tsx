import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Eye,
  HardDrive,
  Heart,
  Layers,
  Loader2,
  MessageCircle,
  Timer,
  UserPlus,
  Video as VideoIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { MetricCard, PageHeader, PostStatusBadge, JobStatusBadge, PlatformChip } from '@/components/common';
import { Card, CardHeader, EmptyState, Progress, Skeleton, StatusDot } from '@/components/ui';
import { api } from '@/lib/api';
import { cn, formatBytes, formatDuration, formatNumber, formatRelative, formatTime } from '@/lib/format';
import type { DashboardData, Video } from '@/lib/types';

function SystemGauge({
  label,
  value,
  detail,
  percent,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  percent: number | null;
  icon: React.ReactNode;
  tone?: 'brand' | 'warn' | 'success';
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          <span className="text-ink-faint">{icon}</span>
          {label}
        </span>
        <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
      </div>
      {percent !== null ? (
        <Progress
          value={percent}
          className="mt-3"
          barClassName={cn(
            tone === 'warn' && 'bg-state-warn',
            tone === 'success' && 'bg-state-success',
            percent > 90 && 'bg-state-danger',
          )}
        />
      ) : null}
      {detail ? <p className="mt-2 text-[11px] text-ink-faint">{detail}</p> : null}
    </div>
  );
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/api/dashboard'),
    refetchInterval: 15_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['videos', 'recent'],
    queryFn: () => api.get<{ items: Video[] }>('/api/videos?pageSize=6'),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Dashboard" description="Alles Wichtige auf einen Blick" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-8 w-16" />
            </Card>
          ))}
        </div>
      </>
    );
  }

  const { videos, social, system, activeJobs, upcoming, queues } = data;
  const totalQueued = queues.reduce((sum, queue) => sum + queue.waiting + queue.active + queue.delayed, 0);
  const totalFailed = queues.reduce((sum, queue) => sum + queue.failed, 0);

  return (
    <>
      <PageHeader title="Dashboard" description="Alles Wichtige auf einen Blick" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Videos heute" value={videos.today} icon={<VideoIcon className="h-5 w-5" />} to="/videos" />
        <MetricCard label="Diese Woche" value={videos.week} icon={<Layers className="h-5 w-5" />} to="/videos" />
        <MetricCard
          label="Geplant"
          value={videos.scheduled}
          icon={<CalendarClock className="h-5 w-5" />}
          to="/calendar"
        />
        <MetricCard
          label="Veroeffentlicht"
          value={videos.published}
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5" />}
          to="/videos?status=PUBLISHED"
        />
        <MetricCard
          label="In Bearbeitung"
          value={videos.in_progress}
          tone="brand"
          icon={<Loader2 className="h-5 w-5" />}
          to="/queue"
        />
        <MetricCard
          label="Freigabe noetig"
          value={videos.review}
          tone={videos.review > 0 ? 'warn' : 'default'}
          icon={<AlertTriangle className="h-5 w-5" />}
          to="/drafts"
        />
        <MetricCard
          label="Wartet auf GPU"
          value={videos.waiting_gpu}
          tone={videos.waiting_gpu > 0 ? 'warn' : 'default'}
          icon={<Cpu className="h-5 w-5" />}
          to="/system/gpu"
        />
        <MetricCard
          label="Fehler"
          value={videos.failed + totalFailed}
          tone={videos.failed + totalFailed > 0 ? 'danger' : 'default'}
          icon={<AlertTriangle className="h-5 w-5" />}
          to="/queue"
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Views" value={social.views} icon={<Eye className="h-5 w-5" />} to="/analytics" />
        <MetricCard label="Likes" value={social.likes} icon={<Heart className="h-5 w-5" />} to="/analytics" />
        <MetricCard
          label="Kommentare"
          value={social.comments}
          icon={<MessageCircle className="h-5 w-5" />}
          to="/analytics"
        />
        <MetricCard
          label="Neue Follower"
          value={social.followers}
          icon={<UserPlus className="h-5 w-5" />}
          to="/analytics"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Live-Status"
            subtitle={`${system.workerCount} Worker verbunden, ${system.busyWorkers} arbeiten gerade`}
            action={
              <span className="flex items-center gap-2 text-xs text-ink-muted">
                <StatusDot
                  className={
                    system.online && system.degradedWorkers === 0
                      ? 'bg-state-success'
                      : system.degradedWorkers > 0
                        ? 'bg-state-warn'
                        : 'bg-state-idle'
                  }
                  pulse={system.online}
                />
                {system.online ? (system.degradedWorkers > 0 ? 'Eingeschraenkt' : 'Online') : 'Offline'}
              </span>
            }
          />

          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <SystemGauge
              label="GPU"
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={system.gpu.available ? `${system.gpu.utilization ?? 0}%` : 'Nicht verfuegbar'}
              detail={
                system.gpu.available
                  ? `${system.gpu.name ?? 'GPU'} - ${formatNumber(system.gpu.freeVramMb ?? 0)} MB frei`
                  : 'Jobs warten im Status WAITING_FOR_GPU'
              }
              percent={system.gpu.available ? (system.gpu.utilization ?? 0) : null}
              tone={system.gpu.available ? 'brand' : 'warn'}
            />
            <SystemGauge
              label="CPU"
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={`${system.cpu.loadAvg1.toFixed(2)}`}
              detail={`${system.cpu.cores} Kerne`}
              percent={Math.min(100, (system.cpu.loadAvg1 / Math.max(1, system.cpu.cores)) * 100)}
            />
            <SystemGauge
              label="RAM"
              icon={<Layers className="h-3.5 w-3.5" />}
              value={`${system.memory.usedPercent}%`}
              detail={`${formatBytes(system.memory.totalBytes - system.memory.freeBytes)} von ${formatBytes(system.memory.totalBytes)}`}
              percent={system.memory.usedPercent}
            />
            <SystemGauge
              label="Speicher"
              icon={<HardDrive className="h-3.5 w-3.5" />}
              value={formatBytes(system.storageBytes)}
              detail={`${totalQueued} Jobs in der Queue`}
              percent={null}
            />
          </div>

          <div className="border-t border-edge px-5 py-4">
            <p className="panel-title mb-3">Aktuelle Jobs</p>
            {activeJobs.length === 0 ? (
              <p className="py-4 text-sm text-ink-muted">Keine laufenden Jobs.</p>
            ) : (
              <ul className="space-y-3">
                {activeJobs.map((job) => (
                  <li key={job.id} className="rounded-xl border border-edge bg-surface-raised p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {job.videoTitle ?? 'Ohne Video'}{' '}
                          <span className="text-ink-faint">
                            - {job.label} (Schritt {job.stepIndex + 1} von {job.stepTotal})
                          </span>
                        </p>
                        {job.workerId ? (
                          <p className="truncate text-[11px] text-ink-faint">Worker: {job.workerId}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {job.etaSeconds ? (
                          <span className="flex items-center gap-1 text-xs tabular-nums text-ink-muted">
                            <Timer className="h-3.5 w-3.5" />
                            {formatDuration(job.etaSeconds)}
                          </span>
                        ) : null}
                        <JobStatusBadge status={job.status} />
                      </div>
                    </div>
                    <Progress value={job.progress} className="mt-3" showLabel />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Naechste Veroeffentlichungen" />
            {upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="h-5 w-5" />}
                title="Nichts geplant"
                description="Plane Videos im Kalender oder direkt in der Videoansicht."
              />
            ) : (
              <ul className="divide-y divide-edge">
                {upcoming.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="w-12 shrink-0 text-sm font-medium tabular-nums text-ink-muted">
                      {formatTime(entry.scheduledAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/videos/${entry.videoId}`}
                        className="block truncate text-sm font-medium text-ink hover:text-brand-400"
                      >
                        {entry.title}
                      </Link>
                      <div className="mt-1 flex items-center gap-2">
                        <PlatformChip platform={entry.platform} size="sm" />
                        <span className="text-[11px] text-ink-faint">{formatRelative(entry.scheduledAt)}</span>
                      </div>
                    </div>
                    <PostStatusBadge status={entry.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Zuletzt erstellt" />
            {(recent?.items ?? []).length === 0 ? (
              <EmptyState icon={<VideoIcon className="h-5 w-5" />} title="Noch keine Videos" />
            ) : (
              <ul className="divide-y divide-edge">
                {(recent?.items ?? []).slice(0, 6).map((video) => (
                  <li key={video.id} className="px-5 py-3">
                    <Link to={`/videos/${video.id}`} className="group flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink group-hover:text-brand-400">
                          {video.title}
                        </p>
                        <p className="text-[11px] text-ink-faint">{formatRelative(video.createdAt)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
