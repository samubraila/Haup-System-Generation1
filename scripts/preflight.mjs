#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const results = [];

function check(name, fn, { optional = false } = {}) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail, optional });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message, optional });
  }
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

check('Docker installiert', () => run('docker', ['--version']));

check('Docker laeuft', () => {
  run('docker', ['info', '--format', '{{.ServerVersion}}']);
  return 'Docker Daemon erreichbar';
});

check('Docker Compose', () => {
  const version = run('docker', ['compose', 'version', '--short']);
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
  if (!Number.isFinite(major) || major < 2) {
    throw new Error(`Compose ${version} gefunden, benoetigt wird mindestens v2`);
  }
  return `Compose ${version}`;
});

check('.env vorhanden', () => {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('Datei fehlt. Erzeugen mit: node scripts/generate-secrets.mjs');
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const placeholders = content
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=CHANGE_ME/.test(line))
    .map((line) => line.split('=')[0]);

  if (placeholders.length > 0) {
    throw new Error(`Noch Platzhalter enthalten: ${placeholders.join(', ')}`);
  }

  const key = /^ENCRYPTION_KEY=(.*)$/m.exec(content)?.[1] ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('ENCRYPTION_KEY muss genau 64 Hex-Zeichen lang sein');
  }

  return 'Alle Pflichtwerte gesetzt';
});

check('Datenverzeichnis beschreibbar', () => {
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const probe = path.join(dataDir, '.write-test');
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
  return dataDir;
});

check(
  'NVIDIA GPU verfuegbar',
  () => {
    const output = run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
    if (!output) throw new Error('nvidia-smi lieferte keine GPU zurueck');
    return output.split('\n')[0];
  },
  { optional: true },
);

check(
  'NVIDIA Container Toolkit',
  () => {
    const gpuDetected = results.find((entry) => entry.name === 'NVIDIA GPU verfuegbar')?.ok;
    if (!gpuDetected) {
      throw new Error('uebersprungen, da keine GPU erkannt wurde');
    }
    run('docker', ['run', '--rm', '--gpus', 'all', 'nvidia/cuda:12.1.1-base-ubuntu22.04', 'nvidia-smi', '-L']);
    return 'GPU im Container sichtbar';
  },
  { optional: true },
);

check(
  'Freier Speicherplatz',
  () => {
    const stat = fs.statfsSync(root);
    const freeGb = (stat.bfree * stat.bsize) / 1024 ** 3;
    if (freeGb < 20) throw new Error(`Nur ${freeGb.toFixed(1)} GB frei, empfohlen sind mindestens 20 GB`);
    return `${freeGb.toFixed(1)} GB frei`;
  },
  { optional: true },
);

const width = Math.max(...results.map((entry) => entry.name.length)) + 2;
let failed = 0;

console.log('');
console.log('AI Content Factory - Systempruefung');
console.log('-'.repeat(60));

for (const entry of results) {
  const mark = entry.ok ? 'OK  ' : entry.optional ? 'INFO' : 'FEHL';
  if (!entry.ok && !entry.optional) failed += 1;
  console.log(`${mark}  ${entry.name.padEnd(width)}${entry.detail}`);
}

console.log('-'.repeat(60));

if (failed > 0) {
  console.log(`${failed} Pflichtpruefung(en) fehlgeschlagen. Bitte zuerst beheben.`);
  process.exit(1);
}

console.log('Alles bereit. Starten mit: docker compose up -d --build');
if (results.some((entry) => entry.optional && !entry.ok && entry.name.includes('GPU'))) {
  console.log('Hinweis: Ohne GPU laeuft die Plattform vollstaendig, Videojobs warten im Status WAITING_FOR_GPU.');
}
