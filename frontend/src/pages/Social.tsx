import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, Unlink } from 'lucide-react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Badge, Button, Card, CardHeader, Skeleton, StatusDot } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn, formatDateTime, PLATFORM_META, toneClasses } from '@/lib/format';
import type { PlatformStatus } from '@/lib/types';

export function SocialPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ['social-platforms'],
    queryFn: () => api.get<{ items: PlatformStatus[] }>('/api/social/platforms'),
  });

  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;
    const platform = searchParams.get('platform') ?? '';
    const message = searchParams.get('message') ?? '';
    const account = searchParams.get('account') ?? '';

    if (status === 'connected') toast.success(`${platform} verbunden`, account);
    else if (status === 'error') toast.error(`${platform} konnte nicht verbunden werden`, message);

    void queryClient.invalidateQueries({ queryKey: ['social-platforms'] });
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [searchParams, setSearchParams, toast, queryClient]);

  const connect = useMutation({
    mutationFn: (platform: string) =>
      api.post<{ authorizeUrl: string }>('/api/social/connect', { platform, redirectTo: '/social' }),
    onSuccess: (result) => {
      window.location.href = result.authorizeUrl;
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === 'not_configured') {
        toast.warning('Plattform nicht eingerichtet', err.message);
      } else {
        toast.error('Verbindung fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler');
      }
    },
  });

  const disconnect = useMutation({
    mutationFn: (accountId: string) => api.delete(`/api/social/accounts/${accountId}`),
    onSuccess: () => {
      toast.success('Konto getrennt');
      void queryClient.invalidateQueries({ queryKey: ['social-platforms'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Social Media Konten"
        description="Verbindung ausschliesslich ueber die offiziellen OAuth-Verfahren der Plattformen. Tokens werden verschluesselt gespeichert und nie an den Browser ausgeliefert."
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-3 h-3 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(data?.items ?? []).map((platform) => {
            const meta = PLATFORM_META[platform.platform];
            const connected = platform.accounts.filter((account) => account.status === 'connected');
            const broken = platform.accounts.filter((account) => account.status !== 'connected');

            return (
              <Card key={platform.platform} className="flex flex-col">
                <CardHeader
                  title={
                    <span className="flex items-center gap-2.5">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: meta.color }} />
                      {platform.label}
                    </span>
                  }
                  subtitle={
                    platform.configured
                      ? connected.length > 0
                        ? `${connected.length} Konto${connected.length === 1 ? '' : 's'} verbunden`
                        : 'Noch kein Konto verbunden'
                      : 'Zugangsdaten fehlen in der .env'
                  }
                  action={
                    platform.configured ? (
                      <Badge tone={toneClasses(connected.length > 0 ? 'success' : 'idle')}>
                        <StatusDot className={connected.length > 0 ? 'bg-state-success' : 'bg-state-idle'} />
                        {connected.length > 0 ? 'Connected' : 'Not connected'}
                      </Badge>
                    ) : (
                      <Badge tone={toneClasses('warn')}>
                        <StatusDot className="bg-state-warn" />
                        Not configured
                      </Badge>
                    )
                  }
                />

                <div className="flex-1 space-y-3 p-5">
                  {!platform.configured ? (
                    <div className="space-y-2 rounded-xl border border-state-warn/25 bg-state-warn/10 p-3.5 text-sm text-state-warn">
                      <p className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Diese Plattform braucht eine eigene App-Registrierung. Trage die Werte in die .env ein und
                          starte das Backend neu.
                        </span>
                      </p>
                      <ul className="ml-6 list-disc font-mono text-xs">
                        {platform.missingEnv.map((key) => (
                          <li key={key}>{key}</li>
                        ))}
                      </ul>
                      <a
                        href={platform.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-6 inline-flex items-center gap-1 text-xs underline"
                      >
                        Developer-Portal oeffnen <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ) : null}

                  {platform.accounts.length > 0 ? (
                    <ul className="space-y-2">
                      {[...connected, ...broken].map((account) => (
                        <li
                          key={account.id}
                          className="flex items-center gap-3 rounded-xl border border-edge bg-surface-raised p-3"
                        >
                          {account.avatarUrl ? (
                            <img src={account.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-ink-muted">
                              {meta.short}
                            </span>
                          )}

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">{account.accountName}</p>
                            <p className="truncate text-[11px] text-ink-faint">
                              {account.status === 'connected'
                                ? `Verbunden ${formatDateTime(account.connectedAt)}`
                                : (account.lastError ?? account.status)}
                            </p>
                          </div>

                          {account.requiresReconnect ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Link2 className="h-3.5 w-3.5" />}
                              onClick={() => connect.mutate(platform.platform)}
                            >
                              Reconnect
                            </Button>
                          ) : (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-state-success" />
                          )}

                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => disconnect.mutate(account.id)}
                            aria-label="Konto trennen"
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="rounded-xl border border-edge bg-canvas/40 p-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                      Angeforderte Berechtigungen
                    </p>
                    <p className="break-words font-mono text-[11px] leading-relaxed text-ink-muted">
                      {platform.scopes.join(', ')}
                    </p>
                  </div>
                </div>

                <div className="border-t border-edge p-4">
                  <Button
                    variant={connected.length > 0 ? 'secondary' : 'primary'}
                    className={cn('w-full justify-center')}
                    icon={<Link2 className="h-4 w-4" />}
                    disabled={!platform.configured}
                    loading={connect.isPending}
                    onClick={() => connect.mutate(platform.platform)}
                  >
                    {connected.length > 0 ? 'Weiteres Konto verbinden' : 'Connect account'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-4 p-5 text-sm text-ink-muted">
        <p className="mb-2 font-medium text-ink">Wie die Verbindung funktioniert</p>
        <ol className="list-inside list-decimal space-y-1">
          <li>Du registrierst eine App im Developer-Portal der Plattform und traegst Client-ID und Secret in die .env ein.</li>
          <li>Ein Klick auf Connect leitet dich zur Plattform, wo du die Freigabe erteilst.</li>
          <li>Das Backend tauscht den Code gegen Tokens und legt sie AES-256-GCM verschluesselt in der Datenbank ab.</li>
          <li>Beim Upload holt sich nur der zustaendige Publisher-Container das Token ueber die interne API.</li>
        </ol>
        <p className="mt-3">Die vollstaendige Anleitung je Plattform steht in docs/SOCIAL_SETUP.md.</p>
      </Card>
    </>
  );
}
