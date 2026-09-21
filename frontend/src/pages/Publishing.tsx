import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, RotateCcw, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader, PlatformChip, PostStatusBadge } from '@/components/common';
import { Button, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { Paged, Platform, PostStatus } from '@/lib/types';

interface PublishingJob {
  id: string;
  postId: string;
  videoId: string;
  videoTitle: string;
  platform: Platform;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  postStatus: PostStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  externalUrl: string | null;
  requiresReconnect: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export function PublishingPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['publishing'],
    queryFn: () => api.get<Paged<PublishingJob>>('/api/jobs/publishing?pageSize=60'),
    refetchInterval: 10_000,
  });

  const retry = useMutation({
    mutationFn: (postId: string) => api.post(`/api/jobs/publishing/${postId}/retry`),
    onSuccess: () => {
      toast.success('Upload erneut eingereiht');
      void queryClient.invalidateQueries({ queryKey: ['publishing'] });
    },
    onError: (err: unknown) =>
      toast.error('Neustart fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  return (
    <>
      <PageHeader
        title="Publishing Queue"
        description="Jede Plattform hat einen eigenen Worker. Ein Fehler bei einer Plattform blockiert die anderen nicht."
      />

      <Card>
        <CardHeader title="Uploads" subtitle="Neueste zuerst" />
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Send className="h-6 w-6" />}
            title="Keine Uploads"
            description="Plane eine Veroeffentlichung in der Detailansicht eines Videos."
          />
        ) : (
          <ul className="divide-y divide-edge">
            {data!.items.map((job) => (
              <li key={job.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="w-24 shrink-0 text-xs tabular-nums text-ink-muted">
                      {job.scheduledAt ? formatDateTime(job.scheduledAt) : formatRelative(job.startedAt)}
                    </span>
                    <PlatformChip platform={job.platform} size="sm" />
                    <Link
                      to={`/videos/${job.videoId}`}
                      className="truncate text-sm font-medium text-ink hover:text-brand-400"
                    >
                      {job.videoTitle}
                    </Link>
                  </div>

                  <div className="flex items-center gap-2">
                    <PostStatusBadge status={job.postStatus} />
                    {job.externalUrl ? (
                      <a
                        href={job.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand-400 hover:underline"
                      >
                        Ansehen
                      </a>
                    ) : null}
                    {job.postStatus === 'failed' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RotateCcw className="h-3.5 w-3.5" />}
                        loading={retry.isPending}
                        onClick={() => retry.mutate(job.postId)}
                      >
                        Retry
                      </Button>
                    ) : null}
                    {job.requiresReconnect ? (
                      <Link to="/social">
                        <Button size="sm" variant="secondary" icon={<Link2 className="h-3.5 w-3.5" />}>
                          Reconnect
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                </div>

                {job.error ? (
                  <p className="mt-2 rounded-lg border border-state-danger/25 bg-state-danger/10 px-3 py-2 text-xs text-state-danger">
                    {job.error} (Versuch {job.attempts} von {job.maxAttempts})
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
