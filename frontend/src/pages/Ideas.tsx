import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { NewVideoWizard } from '@/components/video/NewVideoWizard';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRelative, toneClasses } from '@/lib/format';
import type { Idea, Paged, Project } from '@/lib/types';

const STATUS_TONE: Record<Idea['status'], string> = {
  new: 'info',
  approved: 'success',
  used: 'idle',
  rejected: 'danger',
};

const STATUS_LABEL: Record<Idea['status'], string> = {
  new: 'Neu',
  approved: 'Freigegeben',
  used: 'Verwendet',
  rejected: 'Verworfen',
};

export function IdeasPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wizardIdea, setWizardIdea] = useState<Idea | null>(null);
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [form, setForm] = useState({ projectId: '', title: '', topic: '', description: '', tags: '', score: 50 });

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ items: Project[] }>('/api/projects'),
  });

  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (projectId) query.set('projectId', projectId);

  const { data, isLoading } = useQuery({
    queryKey: ['ideas', query.toString()],
    queryFn: () => api.get<Paged<Idea>>(`/api/ideas?${query.toString()}`),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/ideas', {
        projectId: form.projectId || projectsData?.items[0]?.id,
        title: form.title.trim(),
        topic: form.topic.trim(),
        description: form.description.trim(),
        tags: form.tags.split(/[,\s]+/).filter(Boolean),
        score: form.score,
      }),
    onSuccess: () => {
      toast.success('Idee gespeichert');
      void queryClient.invalidateQueries({ queryKey: ['ideas'] });
      setDialogOpen(false);
      setForm({ projectId: form.projectId, title: '', topic: '', description: '', tags: '', score: 50 });
    },
    onError: (err: unknown) =>
      toast.error('Speichern fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  const patch = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/api/ideas/${id}`, payload),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ideas'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/ideas/${id}`),
    onSuccess: () => {
      toast.success('Idee geloescht');
      void queryClient.invalidateQueries({ queryKey: ['ideas'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Ideen"
        description="Sammle Themen, bewerte sie und mache daraus mit einem Klick ein Video"
        actions={
          <Button
            variant="primary"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setForm({ ...form, projectId: projectsData?.items[0]?.id ?? '' });
              setDialogOpen(true);
            }}
          >
            Neue Idee
          </Button>
        }
      >
        <Card className="flex flex-wrap gap-3 p-3">
          <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-auto min-w-[170px]">
            <option value="">Alle Projekte</option>
            {(projectsData?.items ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-auto min-w-[150px]">
            <option value="">Alle Status</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Card>
      </PageHeader>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-3 h-3 w-full" />
            </Card>
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<Lightbulb className="h-6 w-6" />}
            title="Noch keine Ideen"
            description="Ideen koennen auch automatisch von n8n eingetragen werden."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data!.items.map((idea) => (
            <Card key={idea.id} className="card-hover flex flex-col p-5">
              <div className="mb-2 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold leading-snug text-ink">{idea.title}</h3>
                <Badge tone={toneClasses(STATUS_TONE[idea.status] as 'info')}>{STATUS_LABEL[idea.status]}</Badge>
              </div>

              {idea.topic ? <p className="text-xs text-ink-muted">{idea.topic}</p> : null}
              {idea.description ? (
                <p className="mt-2 line-clamp-3 text-sm text-ink-muted">{idea.description}</p>
              ) : null}

              {idea.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {idea.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-surface-hover px-2 py-0.5 text-[11px] text-ink-muted">
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                <span className="text-[11px] text-ink-faint">
                  Score {idea.score} - {formatRelative(idea.createdAt)}
                </span>
                <div className="flex gap-1">
                  {idea.status === 'new' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patch.mutate({ id: idea.id, payload: { status: 'approved' } })}
                    >
                      Freigeben
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    onClick={() => setWizardIdea(idea)}
                  >
                    Video
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(idea.id)} aria-label="Idee loeschen">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Neue Idee"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!form.title.trim()}
              onClick={() => create.mutate()}
            >
              Speichern
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Projekt" required>
            <Select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
              {(projectsData?.items ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Titel" required>
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <Field label="Thema">
            <Input value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} />
          </Field>
          <Field label="Beschreibung">
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tags" hint="Durch Komma trennen">
              <Input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
            </Field>
            <Field label="Score" hint="0 bis 100">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.score}
                onChange={(event) => setForm({ ...form, score: Number.parseInt(event.target.value, 10) || 0 })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <NewVideoWizard
        open={Boolean(wizardIdea)}
        onClose={() => setWizardIdea(null)}
        presetIdea={wizardIdea}
        presetProjectId={wizardIdea?.projectId}
      />
    </>
  );
}
