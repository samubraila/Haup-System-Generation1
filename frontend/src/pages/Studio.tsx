import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Cpu, FileText, Image as ImageIcon, Mic, Sparkles, Subtitles, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Badge, Button, Card, CardHeader, Skeleton, StatusDot } from '@/components/ui';
import { api } from '@/lib/api';
import { cn, toneClasses } from '@/lib/format';
import type { ServiceState, WorkerHeartbeat } from '@/lib/types';

function useWorker(queue: string) {
  const { data, isLoading } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.get<{ items: WorkerHeartbeat[] }>('/api/system/workers'),
    refetchInterval: 15_000,
  });

  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<{ items: ServiceState[] }>('/api/system/services'),
    refetchInterval: 20_000,
  });

  return {
    isLoading,
    workers: (data?.items ?? []).filter((worker) => worker.queue === queue),
    service: (services?.items ?? []).find((entry) => entry.queue === queue),
  };
}

function CapabilityRow({ label, value, ok }: { label: string; value: ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-edge/60 py-2.5 last:border-0">
      <span className="text-sm text-ink-faint">{label}</span>
      <span className="flex items-center gap-2 text-right text-sm font-medium text-ink">
        {ok !== undefined ? (
          ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-state-success" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0 text-state-warn" />
          )
        ) : null}
        {value}
      </span>
    </div>
  );
}

function StudioShell({
  title,
  description,
  queue,
  icon,
  children,
  docs,
}: {
  title: string;
  description: string;
  queue: string;
  icon: ReactNode;
  children?: ReactNode;
  docs?: string;
}) {
  const { workers, service, isLoading } = useWorker(queue);
  const online = workers.length > 0;
  const degraded = workers.some((worker) => worker.status === 'degraded');

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Badge tone={toneClasses(online ? (degraded ? 'warn' : 'success') : 'idle')}>
            <StatusDot className={online ? (degraded ? 'bg-state-warn' : 'bg-state-success') : 'bg-state-idle'} />
            {online ? (degraded ? 'Eingeschraenkt' : 'Worker online') : 'Worker offline'}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={<span className="flex items-center gap-2">{icon} Worker-Status</span>}
            subtitle={service?.container ?? queue}
          />
          <div className="p-5">
            {isLoading ? (
              <Skeleton className="h-24" />
            ) : !online ? (
              <div className="rounded-xl border border-state-warn/25 bg-state-warn/10 p-4 text-sm text-state-warn">
                <p className="font-medium">Dieser Worker-Container laeuft nicht.</p>
                <p className="mt-1">
                  {service?.optional
                    ? 'Er gehoert zu einem optionalen Profil. Starte ihn mit: docker compose --profile ai up -d'
                    : 'Starte ihn mit: docker compose up -d'}
                </p>
                {service?.reason ? <p className="mt-1">{service.reason}</p> : null}
              </div>
            ) : (
              <div className="space-y-5">
                {workers.map((worker) => (
                  <div key={worker.id} className="rounded-xl border border-edge bg-surface-raised p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs text-ink-faint">{worker.id}</p>
                        <p className="text-sm font-medium text-ink">
                          {worker.host} - Version {worker.version}
                        </p>
                      </div>
                      <Badge tone={toneClasses(worker.status === 'degraded' ? 'warn' : worker.status === 'busy' ? 'progress' : 'success')}>
                        {worker.status === 'busy' ? 'Arbeitet' : worker.status === 'degraded' ? 'Eingeschraenkt' : 'Bereit'}
                      </Badge>
                    </div>

                    {worker.reason ? <p className="mb-3 text-sm text-state-warn">{worker.reason}</p> : null}

                    <div>
                      {Object.entries(worker.capabilities).map(([key, value]) => (
                        <CapabilityRow
                          key={key}
                          label={key}
                          value={
                            typeof value === 'object' && value !== null ? (
                              <span className="font-mono text-[11px] text-ink-muted">
                                {JSON.stringify(value).slice(0, 120)}
                              </span>
                            ) : typeof value === 'boolean' ? (
                              value ? 'ja' : 'nein'
                            ) : (
                              String(value ?? '-')
                            )
                          }
                          ok={typeof value === 'boolean' ? value : undefined}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="So funktioniert dieser Schritt" />
          <div className="space-y-3 p-5 text-sm text-ink-muted">
            {children}
            {docs ? <p className="border-t border-edge pt-3 text-xs">Ausfuehrliche Anleitung: {docs}</p> : null}
          </div>
        </Card>
      </div>
    </>
  );
}

export function StudioScriptPage() {
  return (
    <StudioShell
      title="AI Studio - Script"
      description="Der Script-Worker erzeugt Skript und Szenen-Prompts fuer jedes Video"
      queue="script"
      icon={<FileText className="h-4 w-4" />}
      docs="docs/ARCHITECTURE.md"
    >
      <p>
        Standardmaessig arbeitet dieser Worker mit einer lokalen Vorlage und erzeugt ein Geruest aus Szenen und
        Bild-Prompts. Das ist bewusst kein KI-Text.
      </p>
      <p>
        Fuer echte Texte stelle im Projekt die Skript-Quelle auf <span className="font-mono">ollama</span> und lasse
        Ollama auf dem Host laufen. Der Worker spricht dann{' '}
        <span className="font-mono">http://host.docker.internal:11434</span> an.
      </p>
      <Link to="/projects">
        <Button variant="secondary" size="sm" className="mt-2">
          Projekteinstellungen oeffnen
        </Button>
      </Link>
    </StudioShell>
  );
}

export function StudioImagePage() {
  return (
    <StudioShell
      title="AI Studio - Bilder"
      description="Optionaler Worker fuer Startbilder und Thumbnails"
      queue="image"
      icon={<ImageIcon className="h-4 w-4" />}
      docs="docs/VIDEO_MODELS.md"
    >
      <p>
        Der Image-Worker laeuft im Profil <span className="font-mono">ai</span> und benoetigt ein Diffusers-Modell
        unter <span className="font-mono">/models/sdxl</span>.
      </p>
      <p>Ohne GPU bleiben Bildjobs im Status WAITING_FOR_GPU in der Warteschlange stehen.</p>
    </StudioShell>
  );
}

export function StudioVideoPage() {
  const { data } = useQuery({
    queryKey: ['gpu'],
    queryFn: () =>
      api.get<{
        available: boolean;
        mode: string;
        reason: string | null;
        workers: Array<{ id: string; host: string; status: string; reason: string | null; capabilities: Record<string, unknown> }>;
      }>('/api/system/gpu'),
    refetchInterval: 15_000,
  });

  return (
    <StudioShell
      title="AI Studio - Video"
      description="Die lokale Video-KI laeuft im eigenen Container und kann auf einem anderen Rechner betrieben werden"
      queue="video"
      icon={<Sparkles className="h-4 w-4" />}
      docs="docs/VIDEO_MODELS.md"
    >
      <p>
        Verfuegbare Adapter: <span className="font-mono">ltx</span>, <span className="font-mono">wan</span>,{' '}
        <span className="font-mono">comfyui</span> und <span className="font-mono">placeholder</span>. Der Adapter wird
        pro Projekt gewaehlt.
      </p>
      <div
        className={cn(
          'rounded-xl border p-3',
          data?.available ? 'border-state-success/25 bg-state-success/10' : 'border-state-warn/25 bg-state-warn/10',
        )}
      >
        <p className="flex items-center gap-2 font-medium">
          <Cpu className="h-4 w-4" />
          {data?.available ? 'GPU verfuegbar' : 'Keine GPU verfuegbar'}
        </p>
        <p className="mt-1 text-xs">
          {data?.available
            ? 'Generierungsjobs starten sofort.'
            : (data?.reason ?? 'Jobs bleiben im Status WAITING_FOR_GPU und starten automatisch, sobald eine GPU verbunden ist.')}
        </p>
      </div>
      <Link to="/system/gpu">
        <Button variant="secondary" size="sm">
          GPU-Details ansehen
        </Button>
      </Link>
    </StudioShell>
  );
}

export function StudioVoicePage() {
  return (
    <StudioShell
      title="AI Studio - Voice"
      description="Sprachausgabe ueber ein lokales TTS-Modell"
      queue="voice"
      icon={<Mic className="h-4 w-4" />}
      docs="docs/VOICE_SETUP.md"
    >
      <p>
        Der Voice-Worker nutzt Piper. Ohne eingerichtete Stimme lehnt er Auftraege mit einer klaren Meldung ab, statt
        stille Audiodateien zu erzeugen.
      </p>
      <p>
        Aktiviere die Sprachausgabe pro Projekt erst, wenn <span className="font-mono">TTS_PROVIDER=piper</span> gesetzt
        und ein Modell unter <span className="font-mono">/models/piper</span> hinterlegt ist.
      </p>
    </StudioShell>
  );
}

export function StudioSubtitlePage() {
  return (
    <StudioShell
      title="AI Studio - Untertitel"
      description="Spracherkennung mit faster-whisper, laeuft auch ohne GPU"
      queue="subtitle"
      icon={<Subtitles className="h-4 w-4" />}
      docs="docs/ARCHITECTURE.md"
    >
      <p>
        Der Subtitle-Worker extrahiert die Tonspur, transkribiert sie und erzeugt SRT- und VTT-Dateien. Der FFmpeg-Worker
        brennt die Untertitel danach optional ins Bild.
      </p>
      <p>
        Schriftart, Groesse, Position, Farbe und Hintergrund stellst du pro Projekt ein. Das Modell waehlst du ueber{' '}
        <span className="font-mono">WHISPER_MODEL</span> in der .env.
      </p>
      <p className="text-xs text-ink-faint">
        Ohne Tonspur kann kein Untertitel entstehen. Aktiviere dafuer die Sprachausgabe oder lade eine Audiodatei hoch.
      </p>
    </StudioShell>
  );
}

