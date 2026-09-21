import { ExternalLink, ShieldCheck, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/common';
import { Button, Card, CardHeader } from '@/components/ui';

const FLOWS = [
  {
    title: 'Idee zu fertigem Video',
    steps: ['Neue Idee', 'Skript erzeugen', 'Video generieren', 'Untertitel', 'Rendern', 'Warteschlange', 'Freigabe'],
  },
  {
    title: 'Taeglicher Lauf um 09:00',
    steps: ['Ideen abrufen', 'Video anlegen', 'Generierung starten', 'Termin planen'],
  },
  {
    title: 'Analytics-Abgleich',
    steps: ['Veroeffentlichte Beitraege lesen', 'Kennzahlen abrufen', 'In Datenbank schreiben'],
  },
];

const ENDPOINTS = [
  ['GET', '/api/automation/projects', 'Projekte mit Voreinstellungen lesen'],
  ['GET', '/api/automation/ideas?status=new', 'Offene Ideen abrufen'],
  ['POST', '/api/automation/ideas', 'Neue Idee anlegen'],
  ['POST', '/api/automation/videos', 'Video anlegen und optional sofort generieren'],
  ['GET', '/api/automation/videos/{id}', 'Status, Jobs und Veroeffentlichungen abfragen'],
  ['POST', '/api/automation/videos/{id}/generate', 'Generierung erneut starten'],
  ['POST', '/api/automation/videos/{id}/publish', 'Geplante Veroeffentlichungen ausloesen'],
];

export function AutomationsPage() {
  const n8nUrl = `${window.location.protocol}//${window.location.hostname}:5678`;

  return (
    <>
      <PageHeader
        title="Automatisierungen"
        description="n8n laeuft als eigener Container und steuert die Plattform ueber die interne API"
        actions={
          <a href={n8nUrl} target="_blank" rel="noreferrer">
            <Button variant="primary" icon={<ExternalLink className="h-4 w-4" />}>
              n8n oeffnen
            </Button>
          </a>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Typische Ablaeufe" subtitle="Vorlagen liegen unter n8n/workflows im Repository" />
          <div className="space-y-4 p-5">
            {FLOWS.map((flow) => (
              <div key={flow.title} className="rounded-xl border border-edge bg-surface-raised p-4">
                <p className="mb-3 text-sm font-medium text-ink">{flow.title}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {flow.steps.map((step, index) => (
                    <span key={step} className="flex items-center gap-2">
                      <span className="rounded-lg border border-edge bg-canvas/60 px-2.5 py-1.5 text-xs text-ink-muted">
                        {step}
                      </span>
                      {index < flow.steps.length - 1 ? <span className="text-ink-faint">&rarr;</span> : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Freigabe bleibt aktiv
              </span>
            }
          />
          <div className="space-y-3 p-5 text-sm text-ink-muted">
            <p>
              Automatisierungen duerfen Videos erzeugen und Termine setzen. Verlangt ein Projekt eine Freigabe, lehnt
              die API die Veroeffentlichung mit dem Code <span className="font-mono">approval_required</span> ab.
            </p>
            <p>Jeder Schritt bleibt auch manuell ausfuehrbar. Automatisierung ist immer optional.</p>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Workflow className="h-4 w-4" /> Verfuegbare Endpunkte
            </span>
          }
          subtitle="Authentifizierung ueber den Header X-API-Key mit dem Wert aus INTERNAL_API_KEY"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-5 py-3 font-medium">Methode</th>
                <th className="px-5 py-3 font-medium">Pfad</th>
                <th className="px-5 py-3 font-medium">Zweck</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {ENDPOINTS.map(([method, path, purpose]) => (
                <tr key={path} className="hover:bg-surface-hover">
                  <td className="px-5 py-3">
                    <span className="rounded-md bg-surface-hover px-2 py-0.5 font-mono text-[11px] text-brand-400">
                      {method}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-ink">{path}</td>
                  <td className="px-5 py-3 text-ink-muted">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
