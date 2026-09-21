import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config } from '../config/index.js';
import { writeLog } from './log-store.js';
import { DATA_DIR } from './storage.js';

export interface BackupEntry {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: Date;
  includesMedia: boolean;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function ensureBackupDir(): Promise<string> {
  await fs.mkdir(config.BACKUP_DIR, { recursive: true });
  return config.BACKUP_DIR;
}

export async function listBackups(): Promise<BackupEntry[]> {
  const dir = await ensureBackupDir();
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const results: BackupEntry[] = [];

  for (const name of entries) {
    if (!name.startsWith('acf-backup-')) continue;
    const full = path.join(dir, name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile()) continue;
    results.push({
      name,
      path: full,
      sizeBytes: stat.size,
      createdAt: stat.mtime,
      includesMedia: name.includes('-full'),
    });
  }

  return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function dumpDatabase(target: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pg_dump', ['--no-owner', '--no-privileges', '--format=plain', config.DATABASE_URL], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) =>
      reject(new Error(`pg_dump konnte nicht gestartet werden: ${err.message}. Ist postgresql-client installiert?`)),
    );

    const gzip = createGzip();
    const out = createWriteStream(target);
    pipeline(child.stdout, gzip, out)
      .then(() => {
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`pg_dump beendet mit Code ${code}: ${stderr.slice(0, 500)}`));
        });
      })
      .catch(reject);
  });
}

async function archiveMetadata(target: string, includeMedia: boolean): Promise<void> {
  const args = ['-czf', target, '-C', DATA_DIR];
  if (includeMedia) {
    args.push('projects');
  } else {
    args.push('--exclude=*.mp4', '--exclude=*.mov', '--exclude=*.webm', '--exclude=*.mkv');
    args.push('--exclude=*.wav', '--exclude=*.mp3', '--exclude=*.m4a');
    args.push('projects');
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(new Error(`tar konnte nicht gestartet werden: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar beendet mit Code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

export async function createBackup(includeMedia = config.BACKUP_INCLUDE_MEDIA): Promise<BackupEntry> {
  const dir = await ensureBackupDir();
  const stamp = timestamp();
  const suffix = includeMedia ? 'full' : 'meta';
  const dbFile = path.join(dir, `acf-backup-${stamp}-${suffix}-db.sql.gz`);
  const filesFile = path.join(dir, `acf-backup-${stamp}-${suffix}-files.tar.gz`);

  await dumpDatabase(dbFile);
  await archiveMetadata(filesFile, includeMedia).catch(async (err) => {
    await writeLog('warn', 'backup', `Dateiarchiv fehlgeschlagen: ${(err as Error).message}`);
  });

  await pruneBackups();

  const stat = await fs.stat(dbFile);
  await writeLog('info', 'backup', `Backup erstellt: ${path.basename(dbFile)}`, {
    includeMedia,
    sizeBytes: stat.size,
  });

  return {
    name: path.basename(dbFile),
    path: dbFile,
    sizeBytes: stat.size,
    createdAt: stat.mtime,
    includesMedia: includeMedia,
  };
}

async function pruneBackups(): Promise<void> {
  const retention = config.BACKUP_RETENTION;
  const backups = await listBackups();
  const stale = backups.slice(retention * 2);
  for (const entry of stale) {
    await fs.rm(entry.path, { force: true }).catch(() => undefined);
  }
}
