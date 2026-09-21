import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, RotateCcw, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { JobStatusBadge, PageHeader } from '@/components/common';
import { Button, Card, CardHeader, EmptyState, Progress, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn, formatDuration, formatRelative } from '@/lib/format';
import type { Paged, QueueStats, VideoJob } from '@/lib/types';

export function QueuePage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: queues } = useQuery({
    queryKey: ['queues'],
    queryFn: () => api.get<{ items: QueueStats[] }>('/api/jobs/queues'),
    refetchInterval: 8000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.get<Paged<VideoJob>>('/api/jobs?pageSize=60'),
    refetchInterval: 6000,
  });

  const retry = useMutation({
    mutationFn: (jobId: string) => api.post(`/api/jobs/${jobId}/retry`),
    onSuccess: () => {
      toast.success('Job neu eingereiht');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: unknown) =>
      toast.error('Neustart fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  const cancel = useMutation({
    mutationFn: (jobId: string) => api.post(`/api/jobs/${jobId}/cancel`),
    onSuccess: () => {
      toast.success('Job abgebrochen');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const activeQueues = (queues?.items ?? []).filter(
    (queue) => queue.waiting + queue.active + queue.delayed + queue.failed > 0,
  );

  return (
    <>
      <PageHeader
        title="Warteschlange"
        description="Alle Arbeitsschritte laufen in eigenen Worker-Containern. Jobs ueberstehen Neustarts."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {(activeQueues.length > 0 ? activeQueues : (queues?.items ?? []).slice(0, 5)).map((queue) => (
          <Card key={queue.queue} className="p-4">
            <p className="truncate font-mono text-xs text-ink-faint">{queue.queue}</p>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ['Wartet', queue.waiting, 'text-ink'],
                ['Aktiv', queue.active, 'text-brand-400'],
                ['Spaeter', queue.delayed, 'text-state-warn'],
                ['Fehler', queue.failed, queue.failed > 0 ? 'text-state-danger' : 'text-ink-faint'],
              ].map(([label, value, tone]) => (
                <div key={label as string}>
                  <p className={cn('text-lg font-semibold tabular-nums', tone as string)}>{value as number}</p>
                  <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label as string}</p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Jobs" subtitle="Neueste zuerst, laufende Jobs oben" />
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<ListChecks className="h-6 w-6" />}
            title="Keine Jobs"
            description="Sobald du ein Video generierst, erscheinen die Arbeitsschritte hier."
          />
        ) : (
          <ul className="divide-y divide-edge">
            {data!.items.map((job) => (
              <li key={job.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-surface-hover px-2 py-0.5 font-mono text-[11px] text-ink-faint">
                        {job.queue}
                      </span>
                      {job.videoId ? (
                        <Link
                          to={`/videos/${job.videoId}`}
                          className="truncate text-sm font-medium text-ink hover:text-brand-400"
                        >
                          {job.videoTitle ?? 'Video'}
                        </Link>
                      ) : (
                        <span className="text-sm text-ink">{job.label}</span>
                      )}
                      <span className="text-xs text-ink-faint">
                        {job.label} - Schritt {job.stepIndex + 1}/{job.stepTotal}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {job.projectName} - Versuch {job.attempts}/{job.maxAttempts} - {formatRelative(job.createdAt)}
                      {job.workerId ? ` - ${job.workerId}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {job.etaSeconds ? (
                      <span className="text-xs tabular-nums text-ink-muted">ETA {formatDuration(job.etaSeconds)}</span>
                    ) : null}
                    <JobStatusBadge status={job.status} />
                    {job.status === 'FAILED' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RotateCcw className="h-3.5 w-3.5" />}
                        loading={retry.isPending}
                        onClick={() => retry.mutate(job.id)}
                      >
                        Erneut
                      </Button>
                    ) : null}
                    {['PENDING', 'RUNNING', 'WAITING_FOR_GPU'].includes(job.status) ? (
                      <Button size="icon" variant="ghost" onClick={() => cancel.mutate(job.id)} aria-label="Job abbrechen">
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                {job.status === 'RUNNING' ? <Progress value={job.progress} className="mt-3" showLabel /> : null}
                {job.statusReason ? <p className="mt-2 text-xs text-state-warn">{job.statusReason}</p> : null}
                {job.error ? <p className="mt-2 text-xs text-state-danger">{job.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
