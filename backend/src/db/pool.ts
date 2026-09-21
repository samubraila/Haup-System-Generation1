import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// BIGINT als Zahl statt String zurueckgeben (Views/Likes passen sicher in ein
// JS-Number, wir reden nicht von Werten jenseits von 2^53).
pg.types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));
// NUMERIC ebenfalls als Zahl (engagement_rate).
pg.types.setTypeParser(1700, (value: string) => Number.parseFloat(value));

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'acf-backend',
});

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'Unerwarteter Fehler im Datenbank-Pool');
});

export type QueryParam = string | number | boolean | null | Date | string[] | number[] | object;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParam[] = [],
): Promise<pg.QueryResult<T>> {
  const started = Date.now();
  try {
    return await pool.query<T>(text, params);
  } finally {
    const duration = Date.now() - started;
    if (duration > 1000) {
      logger.warn({ duration, sql: text.slice(0, 160) }, 'Langsame Datenbankabfrage');
    }
  }
}

/** Genau eine Zeile oder null. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParam[] = [],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function queryMany<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParam[] = [],
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Fuehrt mehrere Anweisungen in einer Transaktion aus. Wird fuer alles benutzt,
 * was mehrere Tabellen gleichzeitig veraendert (z.B. Video + Jobs + Posts).
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
