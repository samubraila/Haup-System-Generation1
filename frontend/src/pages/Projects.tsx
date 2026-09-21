import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FolderKanban, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote, PageHeader, PlatformChip } from '@/components/common';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
  Toggle,
} from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatBytes, FORMAT_LABEL, LANGUAGE_LABEL } from '@/lib/format';
import type { Platform, Project } from '@/lib/types';

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];
const STYLES = ['Cinematic', 'Realistic', 'Anime', 'Documentary', 'Futuristic', 'News', 'Educational', 'Funny', 'Dark', 'Minimal'];

interface FormState {
  name: string;
  description: string;
  language: string;
  style: string;
  defaultDurationSec: number;
  defaultFormat: string;
  defaultAspect: string;
  platforms: Platform[];
  requireApproval: boolean;
  videoProvider: string;
  scriptProvider: string;
  sceneCount: number;
  voiceEnabled: boolean;
  subtitlesEnabled: boolean;
  burnSubtitles: boolean;
  promptSuffix: string;
  negativePrompt: string;
  hashtagPresets: string;
  defaultPrivacy: string;
}

function toForm(project?: Project): FormState {
  return {
    name: project?.name ?? '',
    description: project?.description ?? '',
    language: project?.language ?? 'de',
    style: project?.style ?? 'Cinematic',
    defaultDurationSec: project?.defaultDurationSec ?? 30,
    defaultFormat: project?.defaultFormat ?? 'youtube_short',
    defaultAspect: project?.defaultAspect ?? '9:16',
    platforms: project?.platforms ?? ['youtube'],
    requireApproval: project?.requireApproval ?? true,
    videoProvider: project?.settings.videoProvider ?? 'placeholder',
    scriptProvider: project?.settings.scriptProvider ?? 'template',
    sceneCount: project?.settings.sceneCount ?? 4,
    voiceEnabled: project?.settings.voiceEnabled ?? false,
    subtitlesEnabled: project?.settings.subtitlesEnabled ?? true,
    burnSubtitles: project?.settings.burnSubtitles ?? true,
    promptSuffix: project?.settings.promptSuffix ?? '',
    negativePrompt: project?.settings.negativePrompt ?? '',
    hashtagPresets: (project?.settings.hashtagPresets ?? []).join(' '),
    defaultPrivacy: project?.settings.defaultPrivacy ?? 'private',
  };
}

export function ProjectsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Project | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(toForm());

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ items: Project[] }>('/api/projects'),
  });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.patch(`/api/projects/${editing.id}`, payload) : api.post('/api/projects', payload),
    onSuccess: () => {
      toast.success(editing ? 'Projekt gespeichert' : 'Projekt angelegt');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDialogOpen(false);
      setEditing(null);
    },
    onError: (err: unknown) =>
      toast.error('Speichern fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/api/projects/${id}/archive`),
    onSuccess: () => {
      toast.success('Projekt archiviert');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm(toForm());
    setDialogOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditing(project);
    setForm(toForm(project));
    setDialogOpen(true);
  };

  const submit = () => {
    save.mutate({
      name: form.name.trim(),
      description: form.description.trim(),
      language: form.language,
      style: form.style,
      defaultDurationSec: form.defaultDurationSec,
      defaultFormat: form.defaultFormat,
      defaultAspect: form.defaultAspect,
      platforms: form.platforms,
      requireApproval: form.requireApproval,
      settings: {
        videoProvider: form.videoProvider,
        scriptProvider: form.scriptProvider,
        sceneCount: form.sceneCount,
        voiceEnabled: form.voiceEnabled,
        subtitlesEnabled: form.subtitlesEnabled,
        burnSubtitles: form.burnSubtitles,
        promptSuffix: form.promptSuffix,
        negativePrompt: form.negativePrompt,
        hashtagPresets: form.hashtagPresets.split(/[\s,]+/).map((tag) => tag.replace('#', '')).filter(Boolean),
        defaultPrivacy: form.defaultPrivacy,
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Projekte"
        description="Jedes Projekt hat eigene Voreinstellungen fuer Stil, Sprache, Plattformen und KI-Adapter"
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
            Neues Projekt
          </Button>
        }
      />

      {error ? <ErrorNote message={error instanceof ApiError ? error.message : 'Fehler beim Laden'} /> : null}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-3 h-3 w-full" />
            </Card>
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="h-6 w-6" />}
            title="Noch kein Projekt"
            description="Ein Projekt buendelt Videos mit gleichen Einstellungen, zum Beispiel Space Facts."
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
                Projekt anlegen
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data!.items.map((project) => (
            <Card key={project.id} className="card-hover flex flex-col">
              <CardHeader
                title={project.name}
                subtitle={project.description || 'Keine Beschreibung'}
                action={
                  <Button size="icon" variant="ghost" onClick={() => openEdit(project)} aria-label="Projekt bearbeiten">
                    <Settings2 className="h-4 w-4" />
                  </Button>
                }
              />
              <div className="flex-1 space-y-3 p-5">
                <div className="flex flex-wrap gap-1.5">
                  {project.platforms.map((platform) => (
                    <PlatformChip key={platform} platform={platform} size="sm" />
                  ))}
                </div>

                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['Sprache', LANGUAGE_LABEL[project.language] ?? project.language],
                    ['Stil', project.style],
                    ['Format', FORMAT_LABEL[project.defaultFormat] ?? project.defaultFormat],
                    ['Laenge', `${project.defaultDurationSec}s`],
                    ['Video-KI', project.settings.videoProvider],
                    ['Freigabe', project.requireApproval ? 'Pflicht' : 'Automatisch'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-ink-faint">{label}</dt>
                      <dd className="font-medium text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="flex items-center justify-between border-t border-edge pt-3 text-xs text-ink-muted">
                  <span>{project.videoCount ?? 0} Videos</span>
                  <span>{project.publishedCount ?? 0} veroeffentlicht</span>
                  {project.storageBytes ? <span>{formatBytes(project.storageBytes)}</span> : null}
                </div>
              </div>

              <div className="border-t border-edge p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center"
                  icon={<Archive className="h-3.5 w-3.5" />}
                  onClick={() => archive.mutate(project.id)}
                >
                  Archivieren
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Projekt bearbeiten' : 'Neues Projekt'}
        description="Diese Werte werden bei neuen Videos als Voreinstellung verwendet."
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!form.name.trim()} onClick={submit}>
              Speichern
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="Name" required>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Space Facts" />
          </Field>

          <Field label="Beschreibung">
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Kurzvideos ueber Astronomie und Weltraumfakten"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sprache">
              <Select value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>
                {Object.entries(LANGUAGE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Stil">
              <Select value={form.style} onChange={(event) => setForm({ ...form, style: event.target.value })}>
                {STYLES.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Standardformat">
              <Select
                value={form.defaultFormat}
                onChange={(event) => setForm({ ...form, defaultFormat: event.target.value })}
              >
                {Object.entries(FORMAT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Seitenverhaeltnis">
              <Select
                value={form.defaultAspect}
                onChange={(event) => setForm({ ...form, defaultAspect: event.target.value })}
              >
                {['9:16', '16:9', '1:1', '4:5'].map((aspect) => (
                  <option key={aspect} value={aspect}>
                    {aspect}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Standardlaenge (Sekunden)">
              <Input
                type="number"
                min={5}
                max={3600}
                value={form.defaultDurationSec}
                onChange={(event) =>
                  setForm({ ...form, defaultDurationSec: Number.parseInt(event.target.value, 10) || 30 })
                }
              />
            </Field>

            <Field label="Szenen pro Video" hint="Jede Szene wird einzeln von der Video-KI erzeugt">
              <Input
                type="number"
                min={1}
                max={20}
                value={form.sceneCount}
                onChange={(event) => setForm({ ...form, sceneCount: Number.parseInt(event.target.value, 10) || 4 })}
              />
            </Field>

            <Field label="Video-KI Adapter" hint="placeholder erzeugt nur einen Testclip">
              <Select
                value={form.videoProvider}
                onChange={(event) => setForm({ ...form, videoProvider: event.target.value })}
              >
                <option value="placeholder">Platzhalter (kein KI-Video)</option>
                <option value="ltx">LTX-Video (GPU)</option>
                <option value="wan">Wan (GPU)</option>
                <option value="comfyui">ComfyUI</option>
              </Select>
            </Field>

            <Field label="Skript-Quelle" hint="ollama benoetigt eine lokale Ollama-Installation">
              <Select
                value={form.scriptProvider}
                onChange={(event) => setForm({ ...form, scriptProvider: event.target.value })}
              >
                <option value="template">Vorlage (ohne KI)</option>
                <option value="ollama">Ollama (lokales Sprachmodell)</option>
              </Select>
            </Field>

            <Field label="Standard-Sichtbarkeit">
              <Select
                value={form.defaultPrivacy}
                onChange={(event) => setForm({ ...form, defaultPrivacy: event.target.value })}
              >
                <option value="private">Privat</option>
                <option value="unlisted">Nicht gelistet</option>
                <option value="public">Oeffentlich</option>
              </Select>
            </Field>
          </div>

          <Field label="Zielplattformen">
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((platform) => {
                const active = form.platforms.includes(platform);
                return (
                  <button
                    key={platform}
                    onClick={() =>
                      setForm({
                        ...form,
                        platforms: active
                          ? form.platforms.filter((value) => value !== platform)
                          : [...form.platforms, platform],
                      })
                    }
                    className={
                      active
                        ? 'rounded-lg border border-brand-500 bg-brand-500/10 px-3 py-2 text-sm text-brand-400'
                        : 'rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:text-ink'
                    }
                  >
                    {platform}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Prompt-Zusatz" hint="Wird an jeden Bild-Prompt angehaengt">
            <Input
              value={form.promptSuffix}
              onChange={(event) => setForm({ ...form, promptSuffix: event.target.value })}
              placeholder="8k, volumetric lighting, highly detailed"
            />
          </Field>

          <Field label="Negativer Prompt">
            <Input
              value={form.negativePrompt}
              onChange={(event) => setForm({ ...form, negativePrompt: event.target.value })}
              placeholder="blurry, watermark, text, distorted"
            />
          </Field>

          <Field label="Standard-Hashtags">
            <Input
              value={form.hashtagPresets}
              onChange={(event) => setForm({ ...form, hashtagPresets: event.target.value })}
              placeholder="space universe facts"
            />
          </Field>

          <div className="space-y-3 rounded-xl border border-edge bg-surface-raised p-4">
            <Toggle
              checked={form.requireApproval}
              onChange={(value) => setForm({ ...form, requireApproval: value })}
              label="Manuelle Freigabe erforderlich"
              description="Videos werden nie ohne deine Bestaetigung veroeffentlicht."
            />
            <Toggle
              checked={form.subtitlesEnabled}
              onChange={(value) => setForm({ ...form, subtitlesEnabled: value })}
              label="Untertitel erzeugen"
              description="Der Subtitle-Worker transkribiert die Tonspur und erstellt eine SRT-Datei."
            />
            <Toggle
              checked={form.burnSubtitles}
              onChange={(value) => setForm({ ...form, burnSubtitles: value })}
              label="Untertitel ins Bild brennen"
            />
            <Toggle
              checked={form.voiceEnabled}
              onChange={(value) => setForm({ ...form, voiceEnabled: value })}
              label="Sprachausgabe erzeugen"
              description="Benoetigt einen eingerichteten Voice-Worker (siehe docs/VOICE_SETUP.md)."
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
