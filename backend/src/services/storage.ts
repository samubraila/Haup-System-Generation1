import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { STORAGE_BUCKETS } from '@acf/worker-core';
import { config } from '../config/index.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

export const DATA_DIR = path.resolve(config.DATA_DIR);

export function resolveStoragePath(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized.startsWith('..')) {
    throw new BadRequestError(`Ungueltiger Pfad: ${relativePath}`);
  }
  const absolute = path.resolve(DATA_DIR, normalized);
  if (absolute !== DATA_DIR && !absolute.startsWith(DATA_DIR + path.sep)) {
    throw new BadRequestError(`Pfad liegt ausserhalb des Datenverzeichnisses: ${relativePath}`);
  }
  return absolute;
}

export async function ensureStorageLayout(): Promise<void> {
  const dirs = [path.join(DATA_DIR, 'projects'), path.join(DATA_DIR, 'temp'), path.join(DATA_DIR, 'logs')];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function ensureProjectLayout(projectId: string): Promise<string> {
  const root = path.join(DATA_DIR, 'projects', projectId);
  for (const bucket of STORAGE_BUCKETS) {
    await fs.mkdir(path.join(root, bucket), { recursive: true });
  }
  return path.relative(DATA_DIR, root).split(path.sep).join('/');
}

export async function removeProjectFiles(projectId: string): Promise<void> {
  const root = resolveStoragePath(`projects/${projectId}`);
  await fs.rm(root, { recursive: true, force: true });
}

export async function statFile(relativePath: string) {
  const absolute = resolveStoragePath(relativePath);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new NotFoundError('Datei');
    return { absolute, size: stat.size, mtime: stat.mtime };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('Datei');
    throw err;
  }
}

export function openFileStream(absolutePath: string, range?: { start: number; end: number }) {
  return createReadStream(absolutePath, range);
}

export async function writeStorageFile(relativePath: string, data: Buffer): Promise<void> {
  const absolute = resolveStoragePath(relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, data);
}

export async function deleteStorageFile(relativePath: string): Promise<void> {
  const absolute = resolveStoragePath(relativePath);
  await fs.rm(absolute, { force: true });
}

export async function directorySize(relativePath: string): Promise<number> {
  const absolute = resolveStoragePath(relativePath);
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) total += stat.size;
      }
    }
  };
  await walk(absolute);
  return total;
}

export function mimeFromExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const table: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.srt': 'application/x-subrip',
    '.vtt': 'text/vtt',
    '.ass': 'text/plain',
    '.txt': 'text/plain',
    '.json': 'application/json',
  };
  return table[ext] ?? 'application/octet-stream';
}

export function safeFileName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120)
    .toLowerCase() || 'datei';
}
