import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  Cpu,
  Database,
  HardDrive,
  RefreshCw,
  ScrollText,
  Server,
  Settings,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Select, Skeleton, StatusDot, Tabs } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn, formatBytes, formatDateTime, formatDuration, formatNumber, toneClasses } from '@/lib/format';
import type { LogEntry, Paged, ServiceState, WorkerHeartbeat } from '@/lib/types';

const STATE_TONE: Record<ServiceState['state'], 'success' | 'danger' | 'warn' | 'idle'> = {
  online: 'success',
  offline: 'danger',
  degraded: 'warn',
  unknown: 'idle',
};

const STATE_DOT: Record<ServiceState['state'], string> = {
  online: 'bg-state-success',
  offline: 'bg-state-danger',
  degraded: 'bg-state-warn',
  unknown: 'bg-state-idle',
};

const STATE_LABEL: Record<ServiceState['state'], string> = {
  online: 'Online',
  offline: 'Offline',
  degraded: 'Eingeschraenkt',
  unknown: 'Unbekannt',
};

export function ServicesPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<{ items: ServiceState[] }>('/api/system/services'),
    refetchInterval: 15_000,
  });

  const { data: workersData } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.get<{ items: WorkerHeartbeat[] }>('/api/system/workers'),
    refetchInterval: 15_000,
  });

  const grouped = (data?.items ?? []).reduce<Record<string, ServiceState[]>>((acc, service) => {
    acc[service.profile] = [...(acc[service.profile] ?? []), service];
    return acc;
  }, {});

  const PROFILE_LABEL: Record<string, string> = {
    core: 'Hauptsystem',
    gpu: 'GPU-Verarbeitung',
    ai: 'Optionale KI-Worker',
    publish: 'Publisher',
  };

  return (
    <>
      <PageHeader
        title="Dienste"
        description="Jede Funktion laeuft in einem eigenen Container. Hier siehst du, welcher Container gerade arbeitet."
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />}
            onClick={() => void refetch()}
          >
            Aktualisieren
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([profile, services]) => (
            <div key={profile}>
              <p className="panel-title mb-3">{PROFILE_LABEL[profile] ?? profile}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {services.map((service) => (
                  <Card key={service.key} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{service.label}</p>
                        <p className="truncate font-mono text-[11px] text-ink-faint">{service.container}</p>
                      </div>
                      <Badge tone={toneClasses(STATE_TONE[service.state])}>
                        <StatusDot className={STATE_DOT[service.state]} pulse={service.state === 'online'} />
                        {STATE_LABEL[service.state]}
                      </Badge>
                    </div>

                    <p className="mt-2 text-xs text-ink-muted">{service.description}</p>

                    {service.reason ? (
                      <p className="mt-2 rounded-lg border border-state-warn/25 bg-state-warn/10 px-2.5 py-2 text-[11px] text-state-warn">
                        {service.reason}
                      </p>
                    ) : null}

                    {service.queue && service.detail.queue ? (
                      <div className="mt-3 grid grid-cols-4 gap-1 border-t border-edge pt-3 text-center">
                        {(['waiting', 'active', 'delayed', 'failed'] as const).map((key) => (
                          <div key={key}>
                            <p className="text-sm font-semibold tabular-nums text-ink">
                              {(service.detail.queue as Record<string, number>)[key] ?? 0}
                            </p>
                            <p className="text-[10px] uppercase text-ink-faint">{key}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Verbundene Worker"
          subtitle="Registrierung ueber Redis, damit auch entfernte Rechner sichtbar sind"
        />
        {(workersData?.items.length ?? 0) === 0 ? (
          <EmptyState icon={<Server className="h-5 w-5" />} title="Kein Worker verbunden" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-5 py-3 font-medium">Worker</th>
                  <th className="px-5 py-3 font-medium">Queue</th>
                  <th className="px-5 py-3 font-medium">Host</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Laufzeit</th>
                  <th className="px-5 py-3 text-right font-medium">Zuletzt gesehen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {(workersData?.items ?? []).map((worker) => (
                  <tr key={worker.id} className="hover:bg-surface-hover">
                    <td className="px-5 py-3 font-mono text-[11px] text-ink-muted">{worker.id}</td>
                    <td className="px-5 py-3">{worker.queue ?? '-'}</td>
                    <td className="px-5 py-3">{worker.host}</td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={toneClasses(
                          worker.status === 'busy' ? 'progress' : worker.status === 'degraded' ? 'warn' : 'success',
                        )}
                      >
                        {worker.status === 'busy' ? 'Arbeitet' : worker.status === 'degraded' ? 'Eingeschraenkt' : 'Bereit'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatDuration(worker.uptimeSec)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {Math.round(worker.lastSeenAgoMs / 1000)} s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export function GpuPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['gpu'],
    queryFn: () =>
      api.get<{
        available: boolean;
        mode: string;
        reason: string | null;
        workers: Array<{
          id: string;
          host: string;
          status: string;
          reason: string | null;
          currentJobId: string | null;
          capabilities: Record<string, unknown>;
        }>;
      }>('/api/system/gpu'),
    refetchInterval: 10_000,
  });

  return (
    <>
      <PageHeader
        title="GPU"
        description="Die Videogenerierung laeuft ausschliesslich lokal. Ohne GPU warten die Jobs, sie gehen nicht verloren."
      />

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-xl',
                    data?.available ? 'bg-state-success/15 text-state-success' : 'bg-state-warn/15 text-state-warn',
                  )}
                >
                  <Cpu className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-lg font-semibold text-ink">
                    {data?.available ? 'GPU verfuegbar' : 'Keine GPU verfuegbar'}
                  </p>
                  <p className="text-sm text-ink-muted">Modus: {data?.mode}</p>
                </div>
              </div>
              <Badge tone={toneClasses(data?.available ? 'success' : 'warn')}>
                <StatusDot className={data?.available ? 'bg-state-success' : 'bg-state-warn'} />
                {data?.available ? 'Bereit' : 'WAITING_FOR_GPU'}
              </Badge>
            </div>

            {data?.reason ? (
              <p className="mt-4 rounded-xl border border-state-warn/25 bg-state-warn/10 p-3.5 text-sm text-state-warn">
                {data.reason}
              </p>
            ) : null}
          </Card>

          {(data?.workers ?? []).map((worker) => {
            const gpu = worker.capabilities.gpu as
              | { name?: string; totalVramMb?: number; freeVramMb?: number; utilization?: number; driver?: string; backend?: string }
              | undefined;

            return (
              <Card key={worker.id}>
                <CardHeader title={worker.host} subtitle={worker.id} />
                <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Modell', gpu?.name ?? 'Keine GPU erkannt'],
                    ['VRAM gesamt', gpu?.totalVramMb ? `${formatNumber(gpu.totalVramMb)} MB` : '-'],
                    ['VRAM frei', gpu?.freeVramMb ? `${formatNumber(gpu.freeVramMb)} MB` : '-'],
                    ['Auslastung', gpu?.utilization !== undefined && gpu.utilization !== null ? `${gpu.utilization} %` : '-'],
                    ['Treiber', gpu?.driver ?? '-'],
                    ['Backend', gpu?.backend ?? 'cpu'],
                    ['Aktueller Job', worker.currentJobId ?? 'keiner'],
                    ['Status', worker.status],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-edge bg-surface-raised p-3">
                      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
                      <p className="mt-1 truncate text-sm font-medium text-ink">{value}</p>
                    </div>
                  ))}
                </div>

                {worker.capabilities.adapters ? (
                  <div className="border-t border-edge p-5">
                    <p className="panel-title mb-3">Adapter</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(worker.capabilities.adapters as Record<string, Record<string, unknown>>).map(
                        ([name, info]) => (
                          <div key={name} className="rounded-xl border border-edge bg-surface-raised p-3">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-ink">{name}</p>
                              <Badge
                                tone={toneClasses(
                                  info.modelPresent === true || info.reachable === true
                                    ? 'success'
                                    : info.producesAiVideo === false
                                      ? 'idle'
                                      : 'warn',
                                )}
                              >
                                {info.modelPresent === true || info.reachable === true
                                  ? 'Bereit'
                                  : info.producesAiVideo === false
                                    ? 'Testmodus'
                                    : 'Nicht eingerichtet'}
                              </Badge>
                            </div>
                            {info.note ? <p className="mt-1.5 text-xs text-ink-muted">{String(info.note)}</p> : null}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}

          <Card className="p-5 text-sm text-ink-muted">
            <p className="mb-2 font-medium text-ink">GPU nachruesten oder auslagern</p>
            <p>
              Der Video-Worker ist vollstaendig vom Hauptsystem getrennt. Du kannst ihn auf einem anderen Rechner mit
              NVIDIA-GPU starten. Er braucht nur Zugriff auf Redis und die interne Backend-API, keine Datenbank.
            </p>
            <p className="mt-2">Anleitung: docs/REMOTE_GPU.md</p>
          </Card>
        </div>
      )}
    </>
  );
}

export function StoragePage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['storage'],
    queryFn: () =>
      api.get<{
        dataDir: string;
        totalBytes: number;
        tempBytes: number;
        byProject: Array<{ projectId: string; name: string; bytes: number }>;
        byKind: Array<{ kind: string; bytes: number; files: number }>;
        host: { totalMemoryBytes: number; freeMemoryBytes: number; cpuCores: number };
      }>('/api/system/storage'),
    refetchInterval: 60_000,
  });

  const { data: backups } = useQuery({
    queryKey: ['backups'],
    queryFn: () =>
      api.get<{ items: Array<{ name: string; sizeBytes: number; createdAt: string; includesMedia: boolean }> }>(
        '/api/system/backups',
      ),
    retry: false,
  });

  const createBackup = useMutation({
    mutationFn: (includeMedia: boolean) => api.post(`/api/system/backups?includeMedia=${includeMedia}`),
    onSuccess: () => {
      toast.success('Backup erstellt');
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (err: unknown) =>
      toast.error('Backup fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  const maintenance = useMutation({
    mutationFn: () => api.post<{ purgedLogs: number; recoveredJobs: number }>('/api/system/maintenance'),
    onSuccess: (result) =>
      toast.success('Wartung ausgefuehrt', `${result.purgedLogs} Logs entfernt, ${result.recoveredJobs} Jobs wiederhergestellt`),
  });

  const maxBytes = Math.max(1, ...(data?.byProject ?? []).map((entry) => entry.bytes));

  return (
    <>
      <PageHeader
        title="Speicher"
        description="Videos liegen im Dateisystem, die Datenbank speichert nur Metadaten und Pfade"
        actions={
          <>
            <Button variant="secondary" icon={<Trash2 className="h-4 w-4" />} loading={maintenance.isPending} onClick={() => maintenance.mutate()}>
              Wartung starten
            </Button>
            <Button variant="secondary" icon={<Archive className="h-4 w-4" />} loading={createBackup.isPending} onClick={() => createBackup.mutate(false)}>
              Backup ohne Videos
            </Button>
            <Button variant="primary" icon={<Archive className="h-4 w-4" />} loading={createBackup.isPending} onClick={() => createBackup.mutate(true)}>
              Vollbackup
            </Button>
          </>
        }
      />

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Belegung nach Projekt" subtitle={data?.dataDir} />
            <div className="space-y-3 p-5">
              {(data?.byProject ?? []).length === 0 ? (
                <EmptyState icon={<HardDrive className="h-5 w-5" />} title="Noch keine Dateien" />
              ) : (
                (data?.byProject ?? []).map((entry) => (
                  <div key={entry.projectId}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="truncate text-ink">{entry.name}</span>
                      <span className="shrink-0 tabular-nums text-ink-muted">{formatBytes(entry.bytes)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className="h-full rounded-full bg-brand-gradient"
                        style={{ width: `${Math.max(2, (entry.bytes / maxBytes) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Nach Dateityp" />
              <ul className="divide-y divide-edge">
                {(data?.byKind ?? []).map((entry) => (
                  <li key={entry.kind} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="capitalize text-ink">{entry.kind}</span>
                    <span className="text-ink-muted">
                      {entry.files} Dateien - {formatBytes(entry.bytes)}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-ink-faint">Arbeitsdateien</span>
                  <span className="text-ink-muted">{formatBytes(data?.tempBytes ?? 0)}</span>
                </li>
              </ul>
            </Card>

            <Card>
              <CardHeader title="Backups" subtitle="PostgreSQL-Dump und Projektdateien" />
              {(backups?.items.length ?? 0) === 0 ? (
                <EmptyState icon={<Database className="h-5 w-5" />} title="Noch kein Backup" />
              ) : (
                <ul className="divide-y divide-edge">
                  {(backups?.items ?? []).slice(0, 8).map((backup) => (
                    <li key={backup.name} className="px-5 py-3">
                      <p className="truncate font-mono text-[11px] text-ink-muted">{backup.name}</p>
                      <p className="text-xs text-ink-faint">
                        {formatDateTime(backup.createdAt)} - {formatBytes(backup.sizeBytes)}
                        {backup.includesMedia ? ' - inkl. Videos' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

export function LogsPage() {
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');

  const params = new URLSearchParams({ pageSize: '150' });
  if (level) params.set('level', level);
  if (source) params.set('source', source);
  if (applied) params.set('q', applied);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['logs', params.toString()],
    queryFn: () => api.get<Paged<LogEntry>>(`/api/system/logs?${params.toString()}`),
    refetchInterval: 15_000,
  });

  const LEVEL_COLOR: Record<string, string> = {
    debug: 'text-ink-faint',
    info: 'text-state-info',
    warn: 'text-state-warn',
    error: 'text-state-danger',
  };

  return (
    <>
      <PageHeader
        title="Logs"
        description="Strukturierte Meldungen aus dem Hauptsystem und allen Worker-Containern"
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />}
            onClick={() => void refetch()}
          >
            Aktualisieren
          </Button>
        }
      >
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <form
            className="min-w-[200px] flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
            }}
          >
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Meldung suchen..." />
          </form>
          <Input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Quelle, z.B. video-worker"
            className="w-auto min-w-[180px]"
          />
          <Select value={level} onChange={(event) => setLevel(event.target.value)} className="w-auto min-w-[140px]">
            <option value="">Alle Stufen</option>
            <option value="error">Nur Fehler</option>
            <option value="warn,error">Warnung und Fehler</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </Select>
        </Card>
      </PageHeader>

      <Card>
        {isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 10 }).map((_, index) => (
              <Skeleton key={index} className="h-8" />
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="Keine Eintraege" />
        ) : (
          <div className="scroll-thin max-h-[70vh] overflow-y-auto">
            <ul className="divide-y divide-edge/60 font-mono text-xs">
              {data!.items.map((entry) => (
                <li key={entry.id} className="flex gap-3 px-4 py-2 hover:bg-surface-hover">
                  <span className="w-36 shrink-0 text-ink-faint">{formatDateTime(entry.created_at)}</span>
                  <span className={cn('w-12 shrink-0 uppercase', LEVEL_COLOR[entry.level])}>{entry.level}</span>
                  <span className="w-40 shrink-0 truncate text-ink-muted">{entry.source}</span>
                  <span className="min-w-0 flex-1 break-words text-ink">{entry.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </>
  );
}

export function SettingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api.get<{ settings: Record<string, unknown>; runtime: Record<string, unknown> }>('/api/system/settings'),
  });

  const [tab, setTab] = useState<'runtime' | 'info'>('runtime');

  return (
    <>
      <PageHeader
        title="Einstellungen"
        description="Laufzeitwerte stammen aus der .env und gelten fuer das gesamte System"
      />

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { value: 'runtime', label: 'Laufzeit' },
          { value: 'info', label: 'Hinweise' },
        ]}
      />

      {tab === 'runtime' ? (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Settings className="h-4 w-4" /> Aktive Konfiguration</span>}
            subtitle="Aenderungen erfolgen in der .env und werden nach einem Neustart wirksam"
          />
          {isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-8" />
              ))}
            </div>
          ) : (
            <dl className="divide-y divide-edge">
              {Object.entries(data?.runtime ?? {}).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-4 px-5 py-3">
                  <dt className="font-mono text-xs text-ink-muted">{key}</dt>
                  <dd className="text-right text-sm font-medium text-ink">
                    {typeof value === 'boolean' ? (value ? 'aktiv' : 'inaktiv') : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      ) : (
        <Card className="space-y-4 p-6 text-sm text-ink-muted">
          <div>
            <p className="mb-1 font-medium text-ink">Sicherheit</p>
            <p>
              Zugangsdaten stehen ausschliesslich in der .env und werden nie an den Browser ausgeliefert. OAuth-Tokens
              liegen AES-256-GCM verschluesselt in der Datenbank.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-ink">Freigabe</p>
            <p>
              Solange ein Projekt eine Freigabe verlangt, wird kein Video automatisch veroeffentlicht, auch nicht durch
              n8n. Die Automatisierung erhaelt in dem Fall eine klare Fehlermeldung.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-ink">Container</p>
            <p>
              Optionale Profile startest du mit <span className="font-mono">docker compose --profile ai up -d</span>{' '}
              beziehungsweise <span className="font-mono">--profile gpu</span>.
            </p>
          </div>
          <div className="flex items-center gap-2 border-t border-edge pt-4 text-xs">
            <Activity className="h-4 w-4" />
            API-Dokumentation unter{' '}
            <a href="/api/docs" target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
              /api/docs
            </a>
          </div>
        </Card>
      )}
    </>
  );
}
