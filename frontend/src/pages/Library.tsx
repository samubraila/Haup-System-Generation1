import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileAudio, FileText, FileVideo, Image as ImageIcon, Search, Subtitles, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { PageHeader } from '@/components/common';
import { Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Skeleton, Tabs } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, mediaUrl } from '@/lib/api';
import { cn, formatBytes, formatDuration, formatRelative } from '@/lib/format';
import type { MediaItem, Paged, Project } from '@/lib/types';

type Kind = '' | 'video' | 'image' | 'audio' | 'subtitle' | 'script' | 'thumbnail';

const KIND_ICON: Record<string, React.ReactNode> = {
  video: <FileVideo className="h-4 w-4" />,
  image: <ImageIcon className="h-4 w-4" />,
  thumbnail: <ImageIcon className="h-4 w-4" />,
  audio: <FileAudio className="h-4 w-4" />,
  subtitle: <Subtitles className="h-4 w-4" />,
  script: <FileText className="h-4 w-4" />,
};

export function LibraryPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>('');
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState('image');
  const [dragActive, setDragActive] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ items: Project[] }>('/api/projects'),
  });

  const params = new URLSearchParams({ pageSize: '48' });
  if (kind) params.set('kind', kind);
  if (projectId) params.set('projectId', projectId);
  if (appliedSearch) params.set('q', appliedSearch);

  const { data, isLoading } = useQuery({
    queryKey: ['media', params.toString()],
    queryFn: () => api.get<Paged<MediaItem>>(`/api/media?${params.toString()}`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('projectId', projectId || (projectsData?.items[0]?.id ?? ''));
      form.append('kind', uploadKind);
      return api.upload<MediaItem>('/api/media/upload', form);
    },
    onSuccess: () => {
      toast.success('Datei hochgeladen');
      void queryClient.invalidateQueries({ queryKey: ['media'] });
      setUploadOpen(false);
      setPendingFile(null);
    },
    onError: (err: unknown) =>
      toast.error('Upload fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/media/${id}`),
    onSuccess: () => {
      toast.success('Datei geloescht');
      void queryClient.invalidateQueries({ queryKey: ['media'] });
    },
  });

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      setPendingFile(file);
      setUploadOpen(true);
    }
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
      className={cn('relative rounded-2xl', dragActive && 'ring-2 ring-brand-500 ring-offset-4 ring-offset-canvas')}
    >
      <PageHeader
        title="Medienbibliothek"
        description="Alle Dateien liegen im gemeinsamen Speicher. Die Datenbank kennt nur die Pfade."
        actions={
          <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
            Datei hochladen
          </Button>
        }
      >
        <div className="space-y-3">
          <Tabs
            value={kind}
            onChange={(value) => setKind(value as Kind)}
            tabs={[
              { value: '' as Kind, label: 'Alle' },
              { value: 'video' as Kind, label: 'Videos' },
              { value: 'image' as Kind, label: 'Bilder' },
              { value: 'audio' as Kind, label: 'Audio' },
              { value: 'subtitle' as Kind, label: 'Untertitel' },
              { value: 'script' as Kind, label: 'Skripte' },
            ]}
          />

          <Card className="flex flex-wrap items-center gap-3 p-3">
            <form
              className="relative min-w-[220px] flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedSearch(search.trim());
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Dateien durchsuchen..."
                className="pl-9"
              />
            </form>

            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-auto min-w-[170px]">
              <option value="">Alle Projekte</option>
              {(projectsData?.items ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Card>
        </div>
      </PageHeader>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<Upload className="h-6 w-6" />}
            title="Keine Dateien"
            description="Ziehe eine Datei auf dieses Fenster oder nutze den Upload-Knopf."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data!.items.map((item) => {
            const url = mediaUrl(item.id);
            const isImage = item.kind === 'image' || item.kind === 'thumbnail';
            const isVideo = item.kind === 'video';

            return (
              <Card key={item.id} className="card-hover overflow-hidden">
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-canvas">
                  {isImage && url ? (
                    <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : isVideo && url ? (
                    <video src={url} preload="metadata" className="h-full w-full object-cover" muted />
                  ) : (
                    <span className="text-ink-faint">{KIND_ICON[item.kind] ?? <FileText className="h-6 w-6" />}</span>
                  )}
                </div>

                <div className="space-y-2 p-3">
                  <p className="truncate text-sm font-medium text-ink">{item.fileName}</p>
                  <div className="flex items-center justify-between text-[11px] text-ink-faint">
                    <span className="flex items-center gap-1.5">
                      {KIND_ICON[item.kind]}
                      {item.kind}
                    </span>
                    <span>{formatBytes(item.sizeBytes)}</span>
                  </div>
                  {item.durationMs ? (
                    <p className="text-[11px] text-ink-faint">Laenge {formatDuration(item.durationMs / 1000)}</p>
                  ) : null}
                  <div className="flex items-center justify-between border-t border-edge pt-2">
                    <span className="text-[11px] text-ink-faint">{formatRelative(item.createdAt)}</span>
                    <div className="flex gap-1">
                      <a href={mediaUrl(item.id, true) ?? '#'} download>
                        <Button size="icon" variant="ghost" aria-label="Herunterladen">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => remove.mutate(item.id)}
                        aria-label="Loeschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          setPendingFile(null);
        }}
        title="Datei hochladen"
        description="Bilder, Audio, Videos, Untertitel oder Textdateien"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              disabled={!pendingFile}
              loading={upload.isPending}
              onClick={() => pendingFile && upload.mutate(pendingFile)}
            >
              Hochladen
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Projekt" required>
            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {(projectsData?.items ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Kategorie">
            <Select value={uploadKind} onChange={(event) => setUploadKind(event.target.value)}>
              <option value="image">Bild</option>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
              <option value="subtitle">Untertitel</option>
              <option value="other">Sonstiges</option>
            </Select>
          </Field>

          <div
            onClick={() => fileInput.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-edge-strong p-8 text-center transition-colors hover:border-brand-500/50 hover:bg-surface-hover"
          >
            <Upload className="mx-auto h-8 w-8 text-ink-faint" />
            <p className="mt-2 text-sm text-ink">
              {pendingFile ? pendingFile.name : 'Datei auswaehlen oder hierher ziehen'}
            </p>
            {pendingFile ? <p className="text-xs text-ink-faint">{formatBytes(pendingFile.size)}</p> : null}
          </div>

          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(event) => setPendingFile(event.target.files?.[0] ?? null)}
          />
        </div>
      </Modal>
    </div>
  );
}
