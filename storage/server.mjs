import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DATA_DIR = process.env.DATA_DIR ?? '/data';
const BACKUP_DIR = process.env.BACKUP_DIR ?? '/backups';
const OWNER_UID = Number.parseInt(process.env.OWNER_UID ?? '1000', 10);
const OWNER_GID = Number.parseInt(process.env.OWNER_GID ?? '1000', 10);
const TEMP_MAX_AGE_HOURS = Number.parseInt(process.env.TEMP_MAX_AGE_HOURS ?? '24', 10);
const CLEANUP_INTERVAL_MS = Number.parseInt(process.env.CLEANUP_INTERVAL_MS ?? '3600000', 10);
const HEALTH_PORT = Number.parseInt(process.env.HEALTH_PORT ?? '9000', 10);

const BASE_DIRS = ['projects', 'temp', 'logs', 'exports'];

const state = {
  ready: false,
  lastCleanupAt: null,
  removedLastRun: 0,
  error: null,
};

function log(level, message, extra = {}) {
  process.stdout.write(
    `${JSON.stringify({ level, time: new Date().toISOString(), service: 'storage', msg: message, ...extra })}\n`,
  );
}

async function ensureLayout() {
  for (const dir of BASE_DIRS) {
    await fs.mkdir(path.join(DATA_DIR, dir), { recursive: true });
  }
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  for (const target of [DATA_DIR, BACKUP_DIR]) {
    try {
      await fs.chown(target, OWNER_UID, OWNER_GID);
      for (const dir of BASE_DIRS) {
        await fs.chown(path.join(target === DATA_DIR ? DATA_DIR : BACKUP_DIR, dir), OWNER_UID, OWNER_GID).catch(
          () => undefined,
        );
      }
    } catch (err) {
      log('warn', 'Besitzer konnte nicht gesetzt werden', { target, error: err.message });
    }
  }

  await fs.writeFile(
    path.join(DATA_DIR, 'README.txt'),
    [
      'AI Content Factory - Datenverzeichnis',
      '',
      'projects/<projekt-id>/scripts    Skripte',
      'projects/<projekt-id>/images     Bilder',
      'projects/<projekt-id>/audio      Sprachausgabe und Musik',
      'projects/<projekt-id>/videos     Rohe KI-Clips',
      'projects/<projekt-id>/subtitles  Untertitel (SRT/VTT)',
      'projects/<projekt-id>/thumbnails Vorschaubilder',
      'projects/<projekt-id>/final      Fertige Renderfassungen',
      'projects/<projekt-id>/published  Archiv veroeffentlichter Dateien',
      'temp/                            Arbeitsdateien, werden automatisch aufgeraeumt',
      'logs/                            Ablagen fuer Worker-Logdateien',
      '',
      'Diese Dateien gehoeren zur Anwendung. Die Datenbank speichert nur die Pfade.',
    ].join('\n'),
    'utf8',
  );

  state.ready = true;
  log('info', 'Speicherstruktur bereit', { dataDir: DATA_DIR });
}

async function cleanupTemp() {
  const tempDir = path.join(DATA_DIR, 'temp');
  const cutoff = Date.now() - TEMP_MAX_AGE_HOURS * 3600 * 1000;
  let removed = 0;

  let entries = [];
  try {
    entries = await fs.readdir(tempDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(tempDir, entry.name);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(full, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      continue;
    }
  }

  state.lastCleanupAt = new Date().toISOString();
  state.removedLastRun = removed;
  if (removed > 0) log('info', 'Arbeitsdateien aufgeraeumt', { removed });
}

async function diskUsage() {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', DATA_DIR]);
    const line = stdout.trim().split('\n').at(-1) ?? '';
    const parts = line.split(/\s+/);
    const totalKb = Number.parseInt(parts[1] ?? '0', 10);
    const usedKb = Number.parseInt(parts[2] ?? '0', 10);
    const freeKb = Number.parseInt(parts[3] ?? '0', 10);
    return {
      totalBytes: totalKb * 1024,
      usedBytes: usedKb * 1024,
      freeBytes: freeKb * 1024,
      usedPercent: totalKb > 0 ? Number(((usedKb / totalKb) * 100).toFixed(1)) : 0,
    };
  } catch (err) {
    return { error: err.message };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const disk = await diskUsage();
    const ok = state.ready && !state.error;
    const body = JSON.stringify({
      status: ok ? 'ok' : 'degraded',
      service: 'storage',
      dataDir: DATA_DIR,
      lastCleanupAt: state.lastCleanupAt,
      removedLastRun: state.removedLastRun,
      error: state.error,
      disk,
    });
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{"error":"not_found"}');
});

async function main() {
  try {
    await ensureLayout();
    await cleanupTemp();
  } catch (err) {
    state.error = err.message;
    log('error', 'Initialisierung fehlgeschlagen', { error: err.message });
  }

  setInterval(() => {
    cleanupTemp().catch((err) => log('warn', 'Aufraeumen fehlgeschlagen', { error: err.message }));
  }, CLEANUP_INTERVAL_MS).unref?.();

  server.listen(HEALTH_PORT, '0.0.0.0', () => log('info', 'Storage-Dienst bereit', { port: HEALTH_PORT }));
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log('info', 'Storage-Dienst wird beendet');
    server.close(() => process.exit(0));
  });
}

main();
