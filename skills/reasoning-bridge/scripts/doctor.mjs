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
  'scripts/validate.mjs',
  'scripts/consent.mjs',
  'scripts/target.mjs',
].map((relative) => ({ id: `file:${relative}`, path: join(skillDir, relative) }));

const EXPECTED_PACKAGE_NAME = 'dsh-reasoning-bridge';

async function checkRuntime() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  return major >= 18
    ? { id: 'runtime', status: 'READY', detail: `node ${process.versions.node}` }
    : { id: 'runtime', status: 'MISSING_RUNTIME', detail: `node ${process.versions.node} is older than 18` };
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
      detail: status.reason ?? `decided_at handled by consent.mjs (${defaultConsentPath()})`,
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
  const result = {
    ready: checks.every((check) => check.status === 'READY'),
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
