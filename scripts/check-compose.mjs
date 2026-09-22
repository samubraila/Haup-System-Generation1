#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SERVICES_WITH_OWN_HEALTHCHECK = new Set(['postgres', 'redis']);
const SERVICES_WITHOUT_HEALTHCHECK = new Set(['n8n']);

function loadConfig() {
  const json = execFileSync(
    'docker',
    ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.ai.yml', '--profile', 'ai', 'config', '--format', 'json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(json);
}

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('docker compose config konnte nicht gelesen werden:');
    console.error(err.stderr?.toString() ?? err.message);
    process.exit(1);
  }

  const services = config.services ?? {};
  const problems = [];
  const names = Object.keys(services).sort();

  for (const name of names) {
    const service = services[name];

    const limits = service.deploy?.resources?.limits;
    if (!limits || (!limits.cpus && !limits.memory)) {
      problems.push(`${name}: kein Ressourcenlimit (deploy.resources.limits)`);
    }

    const hasInlineHealthcheck = Boolean(service.healthcheck?.test);
    const buildsOwnImage = Boolean(service.build);
    if (!hasInlineHealthcheck && !buildsOwnImage && !SERVICES_WITHOUT_HEALTHCHECK.has(name)) {
      problems.push(`${name}: kein Healthcheck und kein eigenes Image`);
    }
    if (SERVICES_WITH_OWN_HEALTHCHECK.has(name) && !hasInlineHealthcheck) {
      problems.push(`${name}: erwarteter Healthcheck fehlt`);
    }

    if (!service.security_opt?.some((entry) => entry.includes('no-new-privileges'))) {
      problems.push(`${name}: no-new-privileges fehlt`);
    }

    if (!service.restart) {
      problems.push(`${name}: keine restart-Regel`);
    }

    const exposesPort = (service.ports ?? []).length > 0;
    const publicServices = new Set(['frontend', 'n8n']);
    if (exposesPort && !publicServices.has(name)) {
      problems.push(`${name}: veroeffentlicht Ports, obwohl es nur intern erreichbar sein sollte`);
    }
  }

  const workerNames = names.filter((name) => name.includes('worker') || name.startsWith('publisher-'));
  for (const name of workerNames) {
    const networks = Object.keys(services[name].networks ?? {});
    if (networks.includes('data')) {
      problems.push(`${name}: haengt am Datenbanknetz, Worker duerfen PostgreSQL nicht erreichen`);
    }
  }

  for (const name of names.filter((n) => n.startsWith('publisher-'))) {
    const volumes = services[name].volumes ?? [];
    const dataMount = volumes.find((v) => (typeof v === 'string' ? v.includes(':/data') : v.target === '/data'));
    const readOnly = typeof dataMount === 'string' ? dataMount.endsWith(':ro') : dataMount?.read_only === true;
    if (dataMount && !readOnly) {
      problems.push(`${name}: bindet /data schreibbar ein, Publisher brauchen nur Lesezugriff`);
    }
  }

  if (problems.length > 0) {
    console.error(`Compose-Pruefung fehlgeschlagen (${problems.length}):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  console.log(`Compose-Pruefung bestanden: ${names.length} Dienste`);
  console.log(`  Worker ohne Datenbankzugriff: ${workerNames.length}`);
}

main();
