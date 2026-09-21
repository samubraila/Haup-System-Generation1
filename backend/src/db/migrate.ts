import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Einfacher, vorwaertsgerichteter Migrationslauf.
 *
 * Absichtlich ohne ORM-Werkzeug: die .sql-Dateien sind lesbar, versionierbar
 * und lassen sich im Zweifel per psql von Hand anwenden. Eine Advisory Lock
 * verhindert, dass zwei gleichzeitig startende Backend-Container kollidieren.
 */

const LOCK_ID = 873_214_551;

async function migrationsDir(): Promise<string> {
  // Im Container laufen wir aus dist/, die .sql-Dateien werden mitkopiert.
  const candidates = [path.join(here, 'migrations'), path.join(here, '..', '..', 'src', 'db', 'migrations')];
  for (const dir of candidates) {
    try {
      await fs.access(dir);
      return dir;
    } catch {
      /* naechster Kandidat */
    }
  }
  throw new Error(`Migrationsverzeichnis nicht gefunden. Gesucht in: ${candidates.join(', ')}`);
}

export async function runMigrations(): Promise<{ applied: string[] }> {
  const dir = await migrationsDir();
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const known = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = known.get(file);

      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${file} wurde nach dem Anwenden veraendert. ` +
              'Bereits angewendete Migrationen duerfen nicht editiert werden -- bitte eine neue Datei anlegen.',
          );
        }
        continue;
      }

      logger.info({ migration: file }, 'Migration wird angewendet');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} fehlgeschlagen: ${(err as Error).message}`);
      }
    }

    if (applied.length === 0) logger.info('Datenbankschema ist aktuell');
    else logger.info({ applied }, 'Migrationen angewendet');

    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
