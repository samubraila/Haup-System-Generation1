import { useQuery } from '@tanstack/react-query';
import { LogOut, Menu, Plus, Radio, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { MobileSidebar, Sidebar } from './Sidebar';
import { NewVideoWizard } from '@/components/video/NewVideoWizard';
import { Button, StatusDot } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import type { DashboardData } from '@/lib/types';

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const { connected } = useLiveEvents(Boolean(user));

  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/api/dashboard'),
    refetchInterval: connected ? 30_000 : 8000,
  });

  const online = Boolean(data?.system.online);
  const degraded = (data?.system.degradedWorkers ?? 0) > 0;

  return (
    <div className="flex h-full min-h-screen">
      <Sidebar />
      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-edge bg-canvas/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-ink-muted hover:bg-surface-hover lg:hidden"
            aria-label="Menue oeffnen"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2.5 rounded-full border border-edge bg-surface px-3 py-1.5">
            <StatusDot
              className={cn(online && !degraded ? 'bg-state-success' : degraded ? 'bg-state-warn' : 'bg-state-idle')}
              pulse={online && !degraded}
            />
            <span className="text-xs font-medium text-ink-muted">
              {online ? (degraded ? 'System eingeschraenkt' : 'System online') : 'Keine Worker verbunden'}
            </span>
          </div>

          <div
            className="hidden items-center gap-1.5 rounded-full border border-edge bg-surface px-3 py-1.5 text-xs text-ink-muted sm:flex"
            title={connected ? 'Live-Aktualisierung aktiv' : 'Keine Live-Verbindung, es wird regelmaessig neu geladen'}
          >
            {connected ? (
              <Radio className="h-3.5 w-3.5 text-state-success" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 text-ink-faint" />
            )}
            {connected ? 'Live' : 'Polling'}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="primary" size="md" icon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
              <span className="hidden sm:inline">Neues Video</span>
            </Button>

            <div className="hidden items-center gap-3 border-l border-edge pl-3 sm:flex">
              <div className="text-right">
                <p className="text-sm font-medium leading-tight text-ink">{user?.name || user?.email}</p>
                <p className="text-[11px] capitalize text-ink-faint">{user?.role}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  void logout().then(() => navigate('/login'));
                }}
                aria-label="Abmelden"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1600px] animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>

      <NewVideoWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
