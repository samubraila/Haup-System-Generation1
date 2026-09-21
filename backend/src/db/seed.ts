import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import { query, queryOne } from './pool.js';
import { logger } from '../utils/logger.js';

export async function seedAdminUser(): Promise<void> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM users LIMIT 1');
  if (existing) return;

  const hash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
    [config.ADMIN_EMAIL, hash, config.ADMIN_NAME],
  );

  logger.info({ email: config.ADMIN_EMAIL }, 'Administratorkonto angelegt');

  if (user) {
    await query(
      `INSERT INTO projects (user_id, name, slug, description, language, style, platforms, settings)
       VALUES ($1, 'Mein erstes Projekt', 'mein-erstes-projekt',
               'Startprojekt mit Standardeinstellungen. Passe Stil, Sprache und Plattformen jederzeit an.',
               'de', 'cinematic', ARRAY['youtube']::text[], $2)`,
      [user.id, JSON.stringify({})],
    );
  }
}
