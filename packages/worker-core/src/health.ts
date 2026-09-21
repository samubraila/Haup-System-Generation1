import http from 'node:http';

export interface HealthState {
  ok: boolean;
  detail: Record<string, unknown>;
}

/**
 * Minimaler HTTP-Server, den der Docker-Healthcheck abfragt.
 * Bewusst ohne Framework -- ein Worker soll keine Web-Abhaengigkeiten haben.
 */
export function startHealthServer(port: number, probe: () => HealthState): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/healthz' || req.url === '/') {
      let state: HealthState;
      try {
        state = probe();
      } catch (err) {
        state = { ok: false, detail: { error: (err as Error).message } };
      }
      const body = JSON.stringify({ status: state.ok ? 'ok' : 'degraded', ...state.detail });
      res.writeHead(state.ok ? 200 : 503, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not_found"}');
  });

  server.listen(port, '0.0.0.0');
  server.unref();
  return server;
}
