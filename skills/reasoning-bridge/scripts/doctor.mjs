#!/usr/bin/env node

// Local installation Doctor for dsh-reasoning-bridge.
// Checks Node runtime, required skill files, package identity, and consent state.
// Zero dependencies. Exit 0 = READY, 1 = check failures, 2 = usage error.

import { access, constants, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = dirname(scriptDir);
const packageRoot = join(skillDir, '..', '..');

const REQUIRED_FILES = [
  'SKILL.md',
  'references/doctor.md',
  'references/context-packet.md',
  'references/reasoning-request.md',
  'references/reasoning-result.md',
  'references/adoption-gate.md',
  'references/run-receipt.md',
  'references/transport.md',
  'references/transport-chatgpt.md',
  'references/transport-arena.md',
  'references/transport-browser-use.md',
  'scripts/validate.mjs',
  'scripts/consent.mjs',
  'scripts/target.mjs',
  'scripts/targets-table.mjs',
  'scripts/transport.mjs',
  'scripts/lib/cdp.mjs',
  'scripts/lib/handoff-state.mjs',
  'scripts/lib/page-chatgpt.mjs',
  'scripts/lib/page-arena.mjs',
  'scripts/lib/settings-bridge.mjs',
].map((relative) => ({ id: `file:${relative}`, path: join(skillDir, relative) }));

const EXPECTED_PACKAGE_NAME = 'dsh-reasoning-bridge';

async function checkRuntime() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    return { id: 'runtime', status: 'MISSING_RUNTIME', detail: `node ${process.versions.node} is older than 18` };
  }
  // Install-level scripts run on Node 18+, but the transport driver attaches
  // to the debug browser over the native WebSocket global (Node >= 22).
  const detail = major >= 22
    ? `node ${process.versions.node} (transport driver ok)`
    : `node ${process.versions.node} — install-level ok, but the transport driver needs Node >= 22`;
  return { id: 'runtime', status: 'READY', detail };
}

async function checkFile(item) {
  try {
    await access(item.path, constants.R_OK);
    return { id: item.id, status: 'READY', detail: item.path };
  } catch {
    return { id: item.id, status: 'INVALID_INSTALLATION', detail: `missing or unreadable: ${item.path}` };
  }
}

async function checkPackage() {
  try {
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    return pkg.name === EXPECTED_PACKAGE_NAME
      ? { id: 'package-name', status: 'READY', detail: pkg.name }
      : { id: 'package-name', status: 'INVALID_INSTALLATION', detail: `expected ${EXPECTED_PACKAGE_NAME}, found ${pkg.name}` };
  } catch (error) {
    return { id: 'package-name', status: 'INVALID_INSTALLATION', detail: error.message };
  }
}

async function checkConsent() {
  try {
    const { consentStatus, defaultConsentPath } = await import('./consent.mjs');
    const status = await consentStatus(defaultConsentPath());
    return {
      id: 'consent',
      status: status.status,
      detail: status.reason ?? 'explicitly accepted',
    };
  } catch (error) {
    return { id: 'consent', status: 'NEEDS_AUTOMATION_CONSENT', detail: error.message };
  }
}

async function main() {
  const json = process.argv.includes('--json');
  const checks = [
    await checkRuntime(),
    await checkPackage(),
    ...(await Promise.all(REQUIRED_FILES.map(checkFile))),
    await checkConsent(),
  ];
  const consent = checks.find((check) => check.id === 'consent');
  // ready = installation-level readiness only; the versioned consent gate is
  // reported separately (a fresh install without a decision is still valid).
  const result = {
    ready: checks.every((check) => check.status === 'READY' || check.id === 'consent'),
    consent_status: consent ? consent.status : null,
    checks,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const check of checks) console.log(`${check.status.padEnd(26)} ${check.id} — ${check.detail}`);
    console.log(result.ready ? 'Doctor: READY' : 'Doctor: NOT READY');
  }
  process.exitCode = result.ready ? 0 : 1;
}

await main();
