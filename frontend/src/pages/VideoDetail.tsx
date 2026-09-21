import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  Film,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorNote, JobStatusBadge, PageHeader, PlatformChip, PostStatusBadge, VideoStatusBadge } from '@/components/common';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Progress,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  Toggle,
} from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, mediaUrl } from '@/lib/api';
import {
  cn,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatRelative,
  FORMAT_LABEL,
  LANGUAGE_LABEL,
  PLATFORM_META,
} from '@/lib/format';
import type { MediaItem, Platform, PlatformStatus, SocialPost, Video, VideoJob } from '@/lib/types';

interface VideoDetail extends Video {
  project: { id: string; name: string; settings: Record<string, unknown> };
  pipeline: Array<{ stage: string; label: string; status: string }>;
  jobs: VideoJob[];
  media: MediaItem[];
  posts: SocialPost[];
  script: {
    id: string;
    title: string;
    hook: string;
    body: string;
    scenes: Array<{ index: number; prompt: string; narration: string; durationSec: number }>;
    word_count: number;
    estimated_duration_sec: number;
    provider: string;
  } | null;
}

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];

interface TargetState {
  enabled: boolean;
  accountId: string | null;
  title: string;
  description: string;
  hashtags: string;
  tags: string;
  privacy: 'public' | 'unlisted' | 'private';
  scheduledAt: string;
}

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'script' | 'jobs' | 'media' | 'publish'>('overview');
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['video', id],
    queryFn: () => api.get<VideoDetail>(`/api/videos/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ['QUEUED', 'GENERATING', 'PROCESSING', 'WAITING_FOR_GPU', 'PUBLISHING'].includes(status)
        ? 5000
        : 30_000;
    },
  });

  const { data: platformsData } = useQuery({
    queryKey: ['social-platforms'],
    queryFn: () => api.get<{ items: PlatformStatus[] }>('/api/social/platforms'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['video', id] });
    void queryClient.invalidateQueries({ queryKey: ['videos'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const action = useMutation({
    mutationFn: ({ path, method = 'POST' }: { path: string; method?: 'POST' | 'DELETE' }) =>
      method === 'DELETE' ? api.delete(`/api/videos/${id}${path}`) : api.post(`/api/videos/${id}${path}`),
    onSuccess: () => invalidate(),
    onError: (err: unknown) =>
      toast.error('Aktion fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  const retryJob = useMutation({
    mutationFn: (jobId: string) => api.post(`/api/jobs/${jobId}/retry`),
    onSuccess: () => {
      toast.success('Job neu eingereiht');
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error('Neustart fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  if (isLoading) {
    return (
      <>
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Skeleton className="aspect-[3/4] lg:col-span-1" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
      </>
    );
  }

  if (error || !data) {
    return <ErrorNote message={error instanceof ApiError ? error.message : 'Video konnte nicht geladen werden'} />;
  }

  const video = data;
  const finalUrl = mediaUrl(video.finalMediaId);
  const isBusy = ['QUEUED', 'GENERATING', 'PROCESSING', 'WAITING_FOR_GPU'].includes(video.status);
  const canApprove = video.status === 'REVIEW_REQUIRED' || (video.status === 'GENERATED' && video.requireApproval);
  const renders = video.media.filter((item) => item.kind === 'video' && item.meta?.stage === 'final');

  return (
    <>
      <PageHeader
        title={video.title}
        description={`${FORMAT_LABEL[video.format] ?? video.format} - ${video.aspectRatio} - ${formatDuration(video.durationSec)} - ${LANGUAGE_LABEL[video.language] ?? video.language}`}
        actions={
          <>
            <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/videos')}>
              Zurueck
            </Button>

            {isBusy ? (
              <Button
                variant="secondary"
                icon={<Square className="h-4 w-4" />}
                loading={action.isPending}
                onClick={() => action.mutate({ path: '/stop' })}
              >
                Stoppen
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<RefreshCw className="h-4 w-4" />}
                loading={action.isPending}
                onClick={() => action.mutate({ path: '/generate' })}
              >
                {video.finalMediaId ? 'Weiter generieren' : 'Generieren'}
              </Button>
            )}

            <Button
              variant="secondary"
              icon={<RotateCcw className="h-4 w-4" />}
              loading={action.isPending}
              onClick={() => action.mutate({ path: '/regenerate' })}
            >
              Neu generieren
            </Button>

            {canApprove ? (
              <Button
                variant="success"
                icon={<Check className="h-4 w-4" />}
                loading={action.isPending}
                onClick={() =>
                  action.mutate(
                    { path: '/approve' },
                    {
                      onSuccess: () => toast.success('Video freigegeben', 'Geplante Veroeffentlichungen werden gestartet.'),
                    },
                  )
                }
              >
                Freigeben
              </Button>
            ) : null}

            <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setPublishOpen(true)}>
              Veroeffentlichen
            </Button>

            <Button variant="danger" size="icon" onClick={() => setDeleteOpen(true)} aria-label="Video loeschen">
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className={cn('bg-black', video.aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]')}>
              {finalUrl ? (
                <video
                  key={finalUrl}
                  src={finalUrl}
                  poster={mediaUrl(video.thumbnailMediaId) ?? undefined}
                  controls
                  playsInline
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-faint">
                  <Film className="h-10 w-10" />
                  <p className="px-6 text-center text-sm">
                    {isBusy ? 'Video wird noch erzeugt' : 'Noch kein fertiges Video vorhanden'}
                  </p>
                  {isBusy ? <Progress value={video.progress} className="w-40" showLabel /> : null}
                </div>
              )}
            </div>

            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <VideoStatusBadge status={video.status} />
                <span className="text-xs text-ink-faint">{formatRelative(video.createdAt)}</span>
              </div>

              {isBusy ? <Progress value={video.progress} showLabel /> : null}

              {video.error ? <ErrorNote message={video.error} /> : null}

              {finalUrl ? (
                <a href={mediaUrl(video.finalMediaId, true) ?? '#'} download>
                  <Button variant="secondary" className="w-full justify-center" icon={<Download className="h-4 w-4" />}>
                    Herunterladen
                  </Button>
                </a>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Pipeline" subtitle="Jeder Schritt laeuft in einem eigenen Container" />
            <ol className="space-y-1 p-4">
              {video.pipeline.map((step, index) => {
                const done = step.status === 'COMPLETED';
                const running = step.status === 'RUNNING' || step.status === 'WAITING_FOR_GPU';
                const failed = step.status === 'FAILED';
                return (
                  <li key={step.stage} className="flex items-center gap-3 rounded-lg px-2 py-2">
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                        done && 'border-state-success/40 bg-state-success/15 text-state-success',
                        running && 'border-brand-500/40 bg-brand-500/15 text-brand-400',
                        failed && 'border-state-danger/40 bg-state-danger/15 text-state-danger',
                        !done && !running && !failed && 'border-edge text-ink-faint',
                      )}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className="flex-1 text-sm text-ink">{step.label}</span>
                    <JobStatusBadge status={step.status as VideoJob['status']} />
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Uebersicht' },
              { value: 'script', label: 'Skript' },
              { value: 'jobs', label: 'Jobs', count: video.jobs.length },
              { value: 'media', label: 'Dateien', count: video.media.length },
              { value: 'publish', label: 'Veroeffentlichungen', count: video.posts.length },
            ]}
          />

          {tab === 'overview' ? (
            <Card>
              <CardHeader title="Details" />
              <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
                {[
                  ['Projekt', video.project.name],
                  ['Thema', video.topic || '-'],
                  ['Stil', video.style],
                  ['Format', FORMAT_LABEL[video.format] ?? video.format],
                  ['Seitenverhaeltnis', video.aspectRatio],
                  ['Ziellaenge', formatDuration(video.durationSec)],
                  ['Sprache', LANGUAGE_LABEL[video.language] ?? video.language],
                  ['Freigabe noetig', video.requireApproval ? 'Ja' : 'Nein'],
                  ['Erstellt', formatDateTime(video.createdAt)],
                  ['Generiert', formatDateTime(video.generatedAt)],
                  ['Freigegeben', formatDateTime(video.approvedAt)],
                  ['Veroeffentlicht', formatDateTime(video.publishedAt)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 border-b border-edge/60 pb-2">
                    <dt className="text-sm text-ink-faint">{label}</dt>
                    <dd className="text-right text-sm font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              {video.description ? (
                <div className="border-t border-edge px-5 py-4">
                  <p className="panel-title mb-2">Beschreibung</p>
                  <p className="whitespace-pre-wrap text-sm text-ink-muted">{video.description}</p>
                </div>
              ) : null}

              {renders.length > 0 ? (
                <div className="border-t border-edge px-5 py-4">
                  <p className="panel-title mb-3">Gerenderte Fassungen</p>
                  <div className="flex flex-wrap gap-2">
                    {renders.map((render) => (
                      <a
                        key={render.id}
                        href={mediaUrl(render.id) ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-edge bg-surface-raised px-3 py-2 text-xs text-ink-muted transition-colors hover:border-brand-500/40 hover:text-ink"
                      >
                        {String(render.meta?.target ?? 'render')} - {render.width}x{render.height} -{' '}
                        {formatBytes(render.sizeBytes)}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          ) : null}

          {tab === 'script' ? (
            <Card>
              <CardHeader
                title="Skript"
                subtitle={
                  video.script
                    ? `${video.script.word_count} Woerter, erzeugt mit ${video.script.provider}`
                    : 'Noch kein Skript vorhanden'
                }
              />
              {video.script ? (
                <div className="space-y-4 p-5">
                  {video.script.hook ? (
                    <p className="rounded-xl border border-brand-500/25 bg-brand-500/10 px-4 py-3 text-sm text-brand-400">
                      {video.script.hook}
                    </p>
                  ) : null}
                  {video.script.scenes.map((scene) => (
                    <div key={scene.index} className="rounded-xl border border-edge bg-surface-raised p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-ink">Szene {scene.index + 1}</span>
                        <span className="text-xs tabular-nums text-ink-faint">{scene.durationSec}s</span>
                      </div>
                      <p className="text-xs uppercase tracking-wide text-ink-faint">Bild</p>
                      <p className="mb-3 text-sm text-ink-muted">{scene.prompt}</p>
                      {scene.narration ? (
                        <>
                          <p className="text-xs uppercase tracking-wide text-ink-faint">Text</p>
                          <p className="text-sm text-ink">{scene.narration}</p>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="Kein Skript"
                  description="Starte die Generierung, damit der Script-Worker ein Skript erstellt."
                />
              )}
            </Card>
          ) : null}

          {tab === 'jobs' ? (
            <Card>
              <CardHeader title="Jobs" subtitle="Verlauf aller Arbeitsschritte" />
              {video.jobs.length === 0 ? (
                <EmptyState title="Noch keine Jobs" description="Starte die Generierung, um Jobs zu erzeugen." />
              ) : (
                <ul className="divide-y divide-edge">
                  {video.jobs.map((job) => (
                    <li key={job.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {job.label}
                            <span className="ml-2 text-xs text-ink-faint">
                              {job.queue} - Versuch {job.attempts}/{job.maxAttempts}
                            </span>
                          </p>
                          {job.workerId ? <p className="text-[11px] text-ink-faint">{job.workerId}</p> : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <JobStatusBadge status={job.status} />
                          {job.status === 'FAILED' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<RotateCcw className="h-3.5 w-3.5" />}
                              loading={retryJob.isPending}
                              onClick={() => retryJob.mutate(job.id)}
                            >
                              Erneut
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {job.status === 'RUNNING' ? <Progress value={job.progress} className="mt-3" showLabel /> : null}

                      {job.statusReason ? (
                        <p className="mt-2 text-xs text-state-warn">{job.statusReason}</p>
                      ) : null}
                      {job.error ? <p className="mt-2 text-xs text-state-danger">{job.error}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {tab === 'media' ? (
            <Card>
              <CardHeader title="Dateien" subtitle="Alle erzeugten Dateien im gemeinsamen Speicher" />
              {video.media.length === 0 ? (
                <EmptyState title="Keine Dateien" />
              ) : (
                <ul className="divide-y divide-edge">
                  {video.media.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="rounded-lg bg-surface-hover px-2 py-1 text-[11px] uppercase text-ink-faint">
                        {item.kind}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{item.fileName}</p>
                        <p className="truncate text-[11px] text-ink-faint">{item.path}</p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                        {formatBytes(item.sizeBytes)}
                      </span>
                      <a href={mediaUrl(item.id, true) ?? '#'} download>
                        <Button size="icon" variant="ghost" aria-label="Datei herunterladen">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {tab === 'publish' ? (
            <Card>
              <CardHeader
                title="Veroeffentlichungen"
                subtitle="Jede Plattform wird von einem eigenen Worker bearbeitet"
                action={
                  <Button variant="primary" size="sm" icon={<Send className="h-4 w-4" />} onClick={() => setPublishOpen(true)}>
                    Ziele bearbeiten
                  </Button>
                }
              />
              {video.posts.length === 0 ? (
                <EmptyState
                  title="Noch keine Ziele"
                  description="Lege fest, auf welchen Plattformen das Video erscheinen soll."
                />
              ) : (
                <ul className="divide-y divide-edge">
                  {video.posts.map((post) => (
                    <li key={post.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <PlatformChip platform={post.platform} />
                          <PostStatusBadge status={post.status} />
                        </div>
                        <span className="text-xs text-ink-muted">
                          {post.publishedAt
                            ? `Veroeffentlicht ${formatDateTime(post.publishedAt)}`
                            : post.scheduledAt
                              ? `Geplant fuer ${formatDateTime(post.scheduledAt)}`
                              : 'Kein Termin'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-ink">{post.title}</p>
                      {post.externalUrl ? (
                        <a
                          href={post.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs text-brand-400 hover:underline"
                        >
                          {post.externalUrl}
                        </a>
                      ) : null}
                      {post.error ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-xs text-state-danger">{post.error}</p>
                          {post.requiresReconnect ? (
                            <Link to="/social">
                              <Button size="sm" variant="secondary">
                                Konto neu verbinden
                              </Button>
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>
      </div>

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        video={video}
        platforms={platformsData?.items ?? []}
        onSaved={invalidate}
      />

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Video loeschen"
        description="Das Video, seine Jobs und alle Metadaten werden entfernt."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="h-4 w-4" />}
              loading={action.isPending}
              onClick={() =>
                action.mutate(
                  { path: '', method: 'DELETE' },
                  {
                    onSuccess: () => {
                      toast.success('Video geloescht');
                      navigate('/videos');
                    },
                  },
                )
              }
            >
              Endgueltig loeschen
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-muted">
          Bereits veroeffentlichte Beitraege auf den Plattformen bleiben bestehen und werden nicht entfernt.
        </p>
      </Modal>
    </>
  );
}

function PublishDialog({
  open,
  onClose,
  video,
  platforms,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  video: VideoDetail;
  platforms: PlatformStatus[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'now' | 'schedule' | 'draft'>('schedule');
  const [targets, setTargets] = useState<Record<Platform, TargetState>>(() => buildTargets(video));
  const [activePlatform, setActivePlatform] = useState<Platform>('youtube');

  useEffect(() => {
    if (open) setTargets(buildTargets(video));
  }, [open, video]);

  const save = useMutation({
    mutationFn: () =>
      api.put<{ results: Array<{ platform: string; status: string; message?: string }> }>(
        `/api/videos/${video.id}/publish`,
        {
          mode,
          targets: PLATFORMS.map((platform) => ({
            platform,
            enabled: targets[platform].enabled,
            accountId: targets[platform].accountId,
            title: targets[platform].title,
            description: targets[platform].description,
            hashtags: targets[platform].hashtags
              .split(/[\s,]+/)
              .map((tag) => tag.replace('#', '').trim())
              .filter(Boolean),
            tags: targets[platform].tags
              .split(/[,]+/)
              .map((tag) => tag.trim())
              .filter(Boolean),
            privacy: targets[platform].privacy,
            scheduledAt: targets[platform].scheduledAt
              ? new Date(targets[platform].scheduledAt).toISOString()
              : null,
          })),
        },
      ),
    onSuccess: (result) => {
      const notConnected = result.results.filter((entry) => entry.status === 'not_connected');
      if (notConnected.length > 0) {
        toast.warning(
          'Teilweise gespeichert',
          `Nicht verbunden: ${notConnected.map((entry) => entry.platform).join(', ')}`,
        );
      } else {
        toast.success('Veroeffentlichung gespeichert');
      }
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      toast.error('Speichern fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  const platformInfo = useMemo(
    () => Object.fromEntries(platforms.map((entry) => [entry.platform, entry])) as Record<Platform, PlatformStatus>,
    [platforms],
  );

  const current = targets[activePlatform];
  const info = platformInfo[activePlatform];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Veroeffentlichung planen"
      description="Pro Plattform eigene Texte, Sichtbarkeit und Zeitpunkt"
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(['now', 'schedule', 'draft'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  mode === value
                    ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                    : 'border-edge text-ink-muted hover:text-ink',
                )}
              >
                {value === 'now' ? 'Sofort' : value === 'schedule' ? 'Geplant' : 'Entwurf'}
              </button>
            ))}
          </div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Speichern
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform];
            const status = platformInfo[platform];
            const connected = (status?.accounts ?? []).some((account) => account.status === 'connected');
            return (
              <button
                key={platform}
                onClick={() => setActivePlatform(platform)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all',
                  activePlatform === platform ? 'border-brand-500 bg-brand-500/10' : 'border-edge bg-surface-raised',
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Toggle
                    checked={targets[platform].enabled}
                    onChange={(value) =>
                      setTargets({ ...targets, [platform]: { ...targets[platform], enabled: value } })
                    }
                    disabled={!connected}
                  />
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className="text-sm font-medium text-ink">{meta.label}</span>
                  </span>
                </span>
                <span className={cn('text-[11px]', connected ? 'text-state-success' : 'text-ink-faint')}>
                  {status?.configured === false
                    ? 'Nicht eingerichtet'
                    : connected
                      ? 'Verbunden'
                      : 'Nicht verbunden'}
                </span>
              </button>
            );
          })}
        </div>

        {info && !info.configured ? (
          <div className="rounded-xl border border-state-warn/30 bg-state-warn/10 p-4 text-sm text-state-warn">
            {PLATFORM_META[activePlatform].label} ist nicht eingerichtet. Fehlende Werte in der .env:{' '}
            {info.missingEnv.join(', ')}. Schritt-fuer-Schritt: docs/SOCIAL_SETUP.md
          </div>
        ) : null}

        <div className="space-y-4 rounded-xl border border-edge bg-surface-raised p-4">
          <p className="panel-title">{PLATFORM_META[activePlatform].label}</p>

          <Field label="Konto">
            <Select
              value={current.accountId ?? ''}
              onChange={(event) =>
                setTargets({
                  ...targets,
                  [activePlatform]: { ...current, accountId: event.target.value || null },
                })
              }
            >
              <option value="">Automatisch waehlen</option>
              {(info?.accounts ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.accountName} ({account.status})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Titel">
            <Input
              value={current.title}
              placeholder={video.title}
              onChange={(event) =>
                setTargets({ ...targets, [activePlatform]: { ...current, title: event.target.value } })
              }
            />
          </Field>

          <Field label="Beschreibung">
            <Textarea
              value={current.description}
              placeholder={video.description}
              onChange={(event) =>
                setTargets({ ...targets, [activePlatform]: { ...current, description: event.target.value } })
              }
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hashtags" hint="Durch Leerzeichen oder Komma trennen">
              <Input
                value={current.hashtags}
                placeholder="space universe facts"
                onChange={(event) =>
                  setTargets({ ...targets, [activePlatform]: { ...current, hashtags: event.target.value } })
                }
              />
            </Field>

            <Field label="Tags" hint="Nur YouTube, durch Komma trennen">
              <Input
                value={current.tags}
                placeholder="space, universe, facts"
                onChange={(event) =>
                  setTargets({ ...targets, [activePlatform]: { ...current, tags: event.target.value } })
                }
              />
            </Field>

            <Field label="Sichtbarkeit">
              <Select
                value={current.privacy}
                onChange={(event) =>
                  setTargets({
                    ...targets,
                    [activePlatform]: { ...current, privacy: event.target.value as TargetState['privacy'] },
                  })
                }
              >
                <option value="private">Privat</option>
                <option value="unlisted">Nicht gelistet</option>
                <option value="public">Oeffentlich</option>
              </Select>
            </Field>

            <Field label="Zeitpunkt" hint={mode === 'schedule' ? 'Pflichtfeld im Modus Geplant' : 'Nur im Modus Geplant'}>
              <Input
                type="datetime-local"
                value={current.scheduledAt}
                disabled={mode !== 'schedule'}
                onChange={(event) =>
                  setTargets({ ...targets, [activePlatform]: { ...current, scheduledAt: event.target.value } })
                }
              />
            </Field>
          </div>
        </div>

        {mode === 'now' && video.requireApproval && !video.approvedAt ? (
          <div className="flex items-start gap-2 rounded-xl border border-state-warn/30 bg-state-warn/10 p-4 text-sm text-state-warn">
            <X className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Dieses Video braucht erst eine Freigabe. Die Ziele werden gespeichert, veroeffentlicht wird erst nach
              dem Klick auf Freigeben.
            </span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function buildTargets(video: VideoDetail): Record<Platform, TargetState> {
  const base = {} as Record<Platform, TargetState>;
  for (const platform of PLATFORMS) {
    const existing = video.posts.find((post) => post.platform === platform);
    base[platform] = {
      enabled: Boolean(existing && existing.status !== 'cancelled'),
      accountId: existing?.accountId ?? null,
      title: existing?.title ?? video.title,
      description: existing?.description ?? video.description,
      hashtags: (existing?.hashtags ?? []).join(' '),
      tags: (existing?.tags ?? []).join(', '),
      privacy: existing?.privacy ?? 'private',
      scheduledAt: toLocalInput(existing?.scheduledAt ?? null),
    };
  }
  return base;
}
