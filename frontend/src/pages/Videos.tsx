import { useQuery } from '@tanstack/react-query';
import { Film, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorNote, LoadingGrid, PageHeader, SectionGrid, VideoCard } from '@/components/common';
import { NewVideoWizard } from '@/components/video/NewVideoWizard';
import { Button, Card, EmptyState, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { VIDEO_STATUS } from '@/lib/format';
import type { Paged, Project, Video, VideoStatus } from '@/lib/types';

const STATUS_OPTIONS: VideoStatus[] = [
  'DRAFT',
  'QUEUED',
  'WAITING_FOR_GPU',
  'GENERATING',
  'PROCESSING',
  'GENERATED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
];

export function VideosPage({
  fixedStatus,
  title,
  description,
}: {
  fixedStatus?: string;
  title?: string;
  description?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const status = fixedStatus ?? searchParams.get('status') ?? '';
  const projectId = searchParams.get('projectId') ?? '';
  const page = Number.parseInt(searchParams.get('page') ?? '1', 10) || 1;

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ items: Project[] }>('/api/projects'),
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', '24');
    if (status) params.set('status', status);
    if (projectId) params.set('projectId', projectId);
    const q = searchParams.get('q');
    if (q) params.set('q', q);
    return params.toString();
  }, [page, status, projectId, searchParams]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['videos', queryString],
    queryFn: () => api.get<Paged<Video>>(`/api/videos?${queryString}`),
    refetchInterval: 20_000,
  });

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next);
  };

  return (
    <>
      <PageHeader
        title={title ?? 'Videos'}
        description={description ?? 'Alle Videos mit Status, Fortschritt und Zielplattformen'}
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
            Neues Video
          </Button>
        }
      >
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <form
            className="relative min-w-[220px] flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              update('q', search.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Videos durchsuchen..."
              className="pl-9"
            />
          </form>

          <Select
            value={projectId}
            onChange={(event) => update('projectId', event.target.value)}
            className="w-auto min-w-[160px]"
          >
            <option value="">Alle Projekte</option>
            {(projectsData?.items ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>

          {fixedStatus ? null : (
            <Select
              value={status}
              onChange={(event) => update('status', event.target.value)}
              className="w-auto min-w-[160px]"
            >
              <option value="">Alle Status</option>
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {VIDEO_STATUS[value].label}
                </option>
              ))}
            </Select>
          )}
        </Card>
      </PageHeader>

      {isLoading ? (
        <LoadingGrid />
      ) : error ? (
        <ErrorNote message={error instanceof ApiError ? error.message : 'Die Videos konnten nicht geladen werden'} />
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<Film className="h-6 w-6" />}
            title="Keine Videos gefunden"
            description="Lege ein neues Video an oder passe die Filter an."
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
                Neues Video
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <SectionGrid>
            {data!.items.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </SectionGrid>

          {data!.pages > 1 ? (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set('page', String(page - 1));
                  setSearchParams(next);
                }}
              >
                Zurueck
              </Button>
              <span className="px-3 text-sm text-ink-muted">
                Seite {data!.page} von {data!.pages} - {data!.total} Videos
              </span>
              <Button
                variant="secondary"
                disabled={page >= data!.pages}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set('page', String(page + 1));
                  setSearchParams(next);
                }}
              >
                Weiter
              </Button>
            </div>
          ) : null}
        </>
      )}

      <NewVideoWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </>
  );
}

export function DraftsPage() {
  return (
    <VideosPage
      fixedStatus="DRAFT,GENERATED,REVIEW_REQUIRED,FAILED"
      title="Entwuerfe und Freigaben"
      description="Videos, die noch geprueft, freigegeben oder neu gestartet werden muessen"
    />
  );
}

