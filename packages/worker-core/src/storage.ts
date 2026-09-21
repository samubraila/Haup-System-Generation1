import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { BackendApi } from './api-client.js';

/**
 * Einheitlicher Zugriff auf den gemeinsamen Storage.
 *
 * - volume: alle Container teilen sich dasselbe Docker-Volume unter DATA_DIR.
 * - api:    der Worker laeuft auf einem anderen Rechner und holt bzw. schickt
 *           Dateien ueber die interne HTTP-API des Backends.
 *
 * Handler-Code muss den Modus nicht kennen: er arbeitet immer mit lokalen
 * Pfaden, die er ueber pull() bekommt und mit push() zurueckgibt.
 */
export class Storage {
  private readonly tempRoot: string;

  constructor(
    private readonly dataDir: string,
    private readonly mode: 'volume' | 'api',
    private readonly api: BackendApi,
  ) {
    this.tempRoot = mode === 'volume' ? path.join(dataDir, 'temp') : path.join(os.tmpdir(), 'acf');
  }

  /** Verhindert Pfad-Ausbrueche (../) aus dem Datenverzeichnis. */
  private resolveSafe(relativePath: string): string {
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/')).replace(/^\/+/, '');
    if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
      throw new Error(`Ungueltiger Storage-Pfad: ${relativePath}`);
    }
    const absolute = path.resolve(this.dataDir, normalized);
    const root = path.resolve(this.dataDir);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`Storage-Pfad verlaesst das Datenverzeichnis: ${relativePath}`);
    }
    return absolute;
  }

  /** Legt ein leeres Arbeitsverzeichnis fuer einen Job an. */
  async createTempDir(prefix = 'job'): Promise<string> {
    const dir = path.join(this.tempRoot, `${prefix}-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async removeTempDir(dir: string): Promise<void> {
    if (!dir.startsWith(this.tempRoot)) return;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * Stellt sicher, dass eine Storage-Datei lokal als Datei vorliegt, und gibt
   * den lokalen Pfad zurueck.
   */
  async pull(relativePath: string, targetDir?: string): Promise<string> {
    if (this.mode === 'volume') {
      const absolute = this.resolveSafe(relativePath);
      await fs.access(absolute);
      return absolute;
    }
    const dir = targetDir ?? (await this.createTempDir('pull'));
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, path.basename(relativePath));
    const buffer = await this.api.downloadFile(relativePath);
    await fs.writeFile(target, Buffer.from(buffer));
    return target;
  }

  /** Schreibt eine lokal erzeugte Datei in den gemeinsamen Storage. */
  async push(localPath: string, relativePath: string, contentType?: string): Promise<string> {
    if (this.mode === 'volume') {
      const absolute = this.resolveSafe(relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      if (path.resolve(localPath) !== absolute) {
        await fs.copyFile(localPath, absolute);
      }
      return relativePath;
    }
    const data = await fs.readFile(localPath);
    await this.api.uploadFile(relativePath, data, contentType);
    return relativePath;
  }

  async writeText(relativePath: string, content: string, contentType = 'text/plain; charset=utf-8'): Promise<string> {
    if (this.mode === 'volume') {
      const absolute = this.resolveSafe(relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, 'utf8');
      return relativePath;
    }
    await this.api.uploadFile(relativePath, Buffer.from(content, 'utf8'), contentType);
    return relativePath;
  }

  async readText(relativePath: string): Promise<string> {
    if (this.mode === 'volume') {
      return fs.readFile(this.resolveSafe(relativePath), 'utf8');
    }
    const buffer = await this.api.downloadFile(relativePath);
    return Buffer.from(buffer).toString('utf8');
  }

  async size(localPath: string): Promise<number> {
    const stat = await fs.stat(localPath);
    return stat.size;
  }

  /**
   * Erzeugt den Storage-Pfad nach der Projektkonvention:
   *   projects/<projectId>/<bucket>/<dateiname>
   */
  projectPath(projectId: string, bucket: StorageBucket, fileName: string): string {
    return `projects/${projectId}/${bucket}/${fileName}`;
  }
}

export type StorageBucket =
  | 'scripts'
  | 'images'
  | 'audio'
  | 'videos'
  | 'subtitles'
  | 'thumbnails'
  | 'final'
  | 'published'
  | 'exports';

export const STORAGE_BUCKETS: StorageBucket[] = [
  'scripts',
  'images',
  'audio',
  'videos',
  'subtitles',
  'thumbnails',
  'final',
  'published',
  'exports',
];
