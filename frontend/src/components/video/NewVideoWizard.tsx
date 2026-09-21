import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Clapperboard, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Input, Modal, Select, Textarea, Toggle } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn, FORMAT_LABEL, LANGUAGE_LABEL } from '@/lib/format';
import type { Idea, Project, Video } from '@/lib/types';

const STEPS = ['Thema', 'Format', 'Laenge', 'Stil', 'Sprache', 'Generieren'] as const;

const FORMATS = [
  { value: 'youtube_short', aspect: '9:16', hint: 'Bis 60 Sekunden, Hochformat' },
  { value: 'youtube_video', aspect: '16:9', hint: 'Klassisches Querformat' },
  { value: 'tiktok', aspect: '9:16', hint: 'Hochformat, bis 10 Minuten' },
  { value: 'instagram_reel', aspect: '9:16', hint: 'Hochformat, bis 90 Sekunden' },
  { value: 'facebook_reel', aspect: '9:16', hint: 'Hochformat, bis 90 Sekunden' },
] as const;

const ASPECTS = ['9:16', '16:9', '1:1', '4:5'] as const;
const DURATIONS = [15, 30, 60, 90, 300] as const;

const STYLES = [
  'Cinematic',
  'Realistic',
  'Anime',
  'Documentary',
  'Futuristic',
  'News',
  'Educational',
  'Funny',
  'Dark',
  'Minimal',
] as const;

const LANGUAGES = ['de', 'en', 'es', 'fr', 'it'] as const;

interface WizardState {
  projectId: string;
  ideaId: string | null;
  title: string;
  topic: string;
  description: string;
  format: string;
  aspectRatio: string;
  durationSec: number;
  customDuration: string;
  style: string;
  language: string;
  startNow: boolean;
}

const INITIAL: WizardState = {
  projectId: '',
  ideaId: null,
  title: '',
  topic: '',
  description: '',
  format: 'youtube_short',
  aspectRatio: '9:16',
  durationSec: 30,
  customDuration: '',
  style: 'Cinematic',
  language: 'de',
  startNow: true,
};

export function NewVideoWizard({
  open,
  onClose,
  presetProjectId,
  presetIdea,
}: {
  open: boolean;
  onClose: () => void;
  presetProjectId?: string;
  presetIdea?: Idea | null;
}) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL);
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ items: Project[] }>('/api/projects'),
    enabled: open,
  });

  const projects = projectsData?.items ?? [];

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setState((current) => ({
      ...INITIAL,
      projectId: presetProjectId ?? projects[0]?.id ?? current.projectId,
      ideaId: presetIdea?.id ?? null,
      title: presetIdea?.title ?? '',
      topic: presetIdea?.topic ?? presetIdea?.title ?? '',
      description: presetIdea?.description ?? '',
    }));
  }, [open, presetProjectId, presetIdea, projects.length]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === state.projectId),
    [projects, state.projectId],
  );

  useEffect(() => {
    if (!activeProject) return;
    setState((current) => ({
      ...current,
      format: current.format === INITIAL.format ? activeProject.defaultFormat : current.format,
      aspectRatio: current.aspectRatio === INITIAL.aspectRatio ? activeProject.defaultAspect : current.aspectRatio,
      durationSec:
        current.durationSec === INITIAL.durationSec ? activeProject.defaultDurationSec : current.durationSec,
      style: current.style === INITIAL.style ? activeProject.style : current.style,
      language: current.language === INITIAL.language ? activeProject.language : current.language,
    }));
  }, [activeProject]);

  const createVideo = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<Video>('/api/videos', payload),
    onSuccess: (video) => {
      void queryClient.invalidateQueries({ queryKey: ['videos'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(
        state.startNow ? 'Video eingereiht' : 'Entwurf gespeichert',
        state.startNow ? 'Die Generierung laeuft jetzt in der Warteschlange.' : undefined,
      );
      onClose();
      navigate(`/videos/${video.id}`);
    },
    onError: (error: unknown) => {
      const message = error instanceof ApiError ? error.message : 'Unbekannter Fehler';
      toast.error('Video konnte nicht angelegt werden', message);
    },
  });

  const canContinue = useMemo(() => {
    switch (step) {
      case 0:
        return state.projectId.length > 0 && state.title.trim().length > 0;
      case 2:
        return state.durationSec > 0;
      default:
        return true;
    }
  }, [step, state]);

  const submit = () => {
    createVideo.mutate({
      projectId: state.projectId,
      ideaId: state.ideaId,
      title: state.title.trim(),
      topic: state.topic.trim() || state.title.trim(),
      description: state.description.trim(),
      format: state.format,
      aspectRatio: state.aspectRatio,
      durationSec: state.durationSec,
      style: state.style,
      language: state.language,
      startNow: state.startNow,
    });
  };

  const isLast = step === STEPS.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Neues Video"
      description={`Schritt ${step + 1} von ${STEPS.length}: ${STEPS[step]}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0 || createVideo.isPending}
          >
            Zurueck
          </Button>

          <div className="flex items-center gap-1.5">
            {STEPS.map((label, index) => (
              <span
                key={label}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  index === step ? 'w-6 bg-brand-500' : index < step ? 'w-1.5 bg-brand-500/50' : 'w-1.5 bg-edge-strong',
                )}
              />
            ))}
          </div>

          {isLast ? (
            <Button
              variant="primary"
              icon={<Sparkles className="h-4 w-4" />}
              onClick={submit}
              loading={createVideo.isPending}
              disabled={!state.projectId}
            >
              {state.startNow ? 'Video generieren' : 'Entwurf anlegen'}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<ArrowRight className="h-4 w-4" />}
              onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
              disabled={!canContinue}
            >
              Weiter
            </Button>
          )}
        </div>
      }
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18 }}
          className="space-y-5"
        >
          {step === 0 ? (
            <>
              <Field label="Projekt" required hint="Das Projekt bestimmt Stil, Sprache und Zielplattformen.">
                <Select
                  value={state.projectId}
                  onChange={(event) => setState({ ...state, projectId: event.target.value })}
                >
                  {projects.length === 0 ? <option value="">Kein Projekt vorhanden</option> : null}
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Titel" required>
                <Input
                  autoFocus
                  value={state.title}
                  placeholder="5 unglaubliche Fakten ueber schwarze Loecher"
                  onChange={(event) => setState({ ...state, title: event.target.value })}
                />
              </Field>

              <Field label="Thema" hint="Wird als Grundlage fuer Skript und Bild-Prompts verwendet.">
                <Input
                  value={state.topic}
                  placeholder="Schwarze Loecher, Astrophysik, Weltall"
                  onChange={(event) => setState({ ...state, topic: event.target.value })}
                />
              </Field>

              <Field label="Beschreibung">
                <Textarea
                  value={state.description}
                  placeholder="Worum geht es genau? Welche Kernaussage soll ankommen?"
                  onChange={(event) => setState({ ...state, description: event.target.value })}
                />
              </Field>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {FORMATS.map((format) => (
                  <button
                    key={format.value}
                    onClick={() => setState({ ...state, format: format.value, aspectRatio: format.aspect })}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-4 text-left transition-all',
                      state.format === format.value
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-edge bg-surface-raised hover:border-edge-strong',
                    )}
                  >
                    <Clapperboard
                      className={cn('mt-0.5 h-5 w-5', state.format === format.value ? 'text-brand-400' : 'text-ink-faint')}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{FORMAT_LABEL[format.value]}</span>
                      <span className="block text-xs text-ink-muted">{format.hint}</span>
                    </span>
                  </button>
                ))}
              </div>

              <Field label="Seitenverhaeltnis">
                <div className="flex flex-wrap gap-2">
                  {ASPECTS.map((aspect) => (
                    <button
                      key={aspect}
                      onClick={() => setState({ ...state, aspectRatio: aspect })}
                      className={cn(
                        'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                        state.aspectRatio === aspect
                          ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                          : 'border-edge text-ink-muted hover:border-edge-strong hover:text-ink',
                      )}
                    >
                      {aspect}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {DURATIONS.map((duration) => (
                  <button
                    key={duration}
                    onClick={() => setState({ ...state, durationSec: duration, customDuration: '' })}
                    className={cn(
                      'rounded-xl border px-4 py-4 text-center transition-all',
                      state.durationSec === duration && !state.customDuration
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-edge bg-surface-raised hover:border-edge-strong',
                    )}
                  >
                    <span className="block text-lg font-semibold text-ink">
                      {duration >= 60 ? `${duration / 60} Min` : `${duration} Sek`}
                    </span>
                    <span className="block text-xs text-ink-faint">{duration} Sekunden</span>
                  </button>
                ))}
              </div>

              <Field label="Eigene Laenge (Sekunden)" hint="5 bis 3600 Sekunden">
                <Input
                  type="number"
                  min={5}
                  max={3600}
                  value={state.customDuration}
                  placeholder="z.B. 45"
                  onChange={(event) => {
                    const value = event.target.value;
                    const parsed = Number.parseInt(value, 10);
                    setState({
                      ...state,
                      customDuration: value,
                      durationSec: Number.isFinite(parsed) && parsed >= 5 ? parsed : state.durationSec,
                    });
                  }}
                />
              </Field>
            </>
          ) : null}

          {step === 3 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {STYLES.map((style) => (
                <button
                  key={style}
                  onClick={() => setState({ ...state, style })}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                    state.style === style
                      ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                      : 'border-edge bg-surface-raised text-ink-muted hover:border-edge-strong hover:text-ink',
                  )}
                >
                  {style}
                </button>
              ))}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {LANGUAGES.map((language) => (
                <button
                  key={language}
                  onClick={() => setState({ ...state, language })}
                  className={cn(
                    'flex items-center justify-between rounded-xl border px-4 py-3 transition-all',
                    state.language === language
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'border-edge bg-surface-raised hover:border-edge-strong',
                  )}
                >
                  <span className="text-sm font-medium text-ink">{LANGUAGE_LABEL[language]}</span>
                  {state.language === language ? <Check className="h-4 w-4 text-brand-400" /> : null}
                </button>
              ))}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-edge bg-surface-raised p-4">
                <p className="panel-title mb-3">Zusammenfassung</p>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  {[
                    ['Projekt', activeProject?.name ?? '-'],
                    ['Titel', state.title || '-'],
                    ['Format', FORMAT_LABEL[state.format] ?? state.format],
                    ['Seitenverhaeltnis', state.aspectRatio],
                    ['Laenge', `${state.durationSec} Sekunden`],
                    ['Stil', state.style],
                    ['Sprache', LANGUAGE_LABEL[state.language] ?? state.language],
                    ['Video-KI', activeProject?.settings.videoProvider ?? '-'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 border-b border-edge/60 py-1.5 last:border-0">
                      <dt className="text-ink-faint">{label}</dt>
                      <dd className="truncate text-right font-medium text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {activeProject?.settings.videoProvider === 'placeholder' ? (
                <div className="rounded-xl border border-state-warn/30 bg-state-warn/10 p-4 text-sm text-state-warn">
                  Dieses Projekt nutzt den Platzhalter-Adapter. Es entsteht ein technischer Testclip, kein KI-Video.
                  Stelle den Adapter in den Projekteinstellungen auf LTX, Wan oder ComfyUI um.
                </div>
              ) : null}

              <Toggle
                checked={state.startNow}
                onChange={(value) => setState({ ...state, startNow: value })}
                label="Generierung sofort starten"
                description="Andernfalls wird nur ein Entwurf angelegt, den du spaeter startest."
              />

              {activeProject?.requireApproval ? (
                <p className="text-xs text-ink-muted">
                  Dieses Projekt erfordert eine manuelle Freigabe. Das Video wird nach der Generierung zur Pruefung
                  vorgelegt und nicht automatisch veroeffentlicht.
                </p>
              ) : null}
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
}
