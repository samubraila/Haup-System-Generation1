#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

const hex = (bytes) => randomBytes(bytes).toString('hex');
const password = (bytes = 24) =>
  randomBytes(bytes).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 28) + 'A1';

const GENERATORS = {
  POSTGRES_PASSWORD: () => password(24),
  REDIS_PASSWORD: () => password(24),
  JWT_SECRET: () => hex(32),
  ENCRYPTION_KEY: () => hex(32),
  INTERNAL_API_KEY: () => hex(24),
  ADMIN_PASSWORD: () => password(18),
  N8N_BASIC_AUTH_PASSWORD: () => password(18),
  N8N_ENCRYPTION_KEY: () => hex(24),
};

function parseEnv(content) {
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

function main() {
  const force = process.argv.includes('--force');

  if (!fs.existsSync(examplePath)) {
    console.error('.env.example wurde nicht gefunden.');
    process.exit(1);
  }

  const template = fs.readFileSync(examplePath, 'utf8');
  const existing = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : new Map();

  if (fs.existsSync(envPath) && !force) {
    const stale = Object.keys(GENERATORS).filter((key) => {
      const value = existing.get(key);
      return !value || value.startsWith('CHANGE_ME');
    });

    if (stale.length === 0) {
      console.log('.env existiert bereits und enthaelt keine Platzhalter mehr. Nichts zu tun.');
      console.log('Zum Neuerzeugen aller Secrets: node scripts/generate-secrets.mjs --force');
      return;
    }
    console.log(`Ergaenze fehlende Werte in der bestehenden .env: ${stale.join(', ')}`);
  }

  const generated = new Map();
  for (const [key, generate] of Object.entries(GENERATORS)) {
    const current = existing.get(key);
    const keep = !force && current && !current.startsWith('CHANGE_ME');
    generated.set(key, keep ? current : generate());
  }

  const lines = template.split(/\r?\n/).map((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) return line;
    const key = match[1];

    if (generated.has(key)) return `${key}=${generated.get(key)}`;
    if (existing.has(key) && !existing.get(key).startsWith('CHANGE_ME')) return `${key}=${existing.get(key)}`;
    return line;
  });

  let content = lines.join('\n');

  const postgresUser = generated.get('POSTGRES_USER') ?? existing.get('POSTGRES_USER') ?? 'aistudio';
  const postgresDb = existing.get('POSTGRES_DB') ?? 'aistudio';
  content = content.replace(
    /^DATABASE_URL=.*$/m,
    `DATABASE_URL=postgresql://${postgresUser}:${generated.get('POSTGRES_PASSWORD')}@postgres:5432/${postgresDb}`,
  );
  content = content.replace(/^REDIS_URL=.*$/m, `REDIS_URL=redis://:${generated.get('REDIS_PASSWORD')}@redis:6379`);

  fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });

  console.log('.env wurde geschrieben.');
  console.log('');
  console.log('Zugangsdaten fuer die Weboberflaeche:');
  console.log(`  URL:      http://localhost:${existing.get('FRONTEND_PORT') ?? '3000'}`);
  console.log(`  E-Mail:   ${existing.get('ADMIN_EMAIL') ?? 'admin@localhost'}`);
  console.log(`  Passwort: ${generated.get('ADMIN_PASSWORD')}`);
  console.log('');
  console.log('n8n:');
  console.log(`  URL:      http://localhost:${existing.get('N8N_PORT') ?? '5678'}`);
  console.log(`  Benutzer: ${existing.get('N8N_BASIC_AUTH_USER') ?? 'admin'}`);
  console.log(`  Passwort: ${generated.get('N8N_BASIC_AUTH_PASSWORD')}`);
  console.log('');
  console.log('Bewahre diese Werte sicher auf. Die .env gehoert nie in ein Repository.');
}

main();
