// Issue #2 Phase 2/3: artifact-path hardening + version migration/back-compat.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyReceiptArtifacts, safeParseReceipt } from '../skills/reasoning-bridge/scripts/validate.mjs';
import { consentStatus } from '../skills/reasoning-bridge/scripts/consent.mjs';

import { createHash } from 'node:crypto';
const hash = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

const PACKET = 'BEGIN_CONTEXT_PACKET\npacket_id: p1\nrequested_reasoner: x\n\n## Objective\no\n\n## Acceptance\n- a\n\n## Repository State\n- s\n\n## Evidence\n- e\n\n## Constraints\n- c\n\n## Questions\n1. q\nEND_CONTEXT_PACKET\n';

function receiptFor(paths) {
  return {
    artifacts: {
      packet: { path: paths.packet, sha256: hash(PACKET), approximate_tokens: 40 },
    },
  };
}

test('verifyReceiptArtifacts: honest in-run artifact passes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rb-arts-'));
  try {
    await writeFile(join(dir, 'packet.md'), PACKET, 'utf8');
    const errors = await verifyReceiptArtifacts(receiptFor({ packet: 'packet.md' }), dir);
    assert.deepEqual(errors, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verifyReceiptArtifacts: traversal outside the run dir is refused without reading', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rb-arts-'));
  const outside = await mkdtemp(join(tmpdir(), 'rb-outside-'));
  try {
    const secretPath = join(outside, 'secret.txt');
    await writeFile(secretPath, hash(PACKET), 'utf8'); // content would hash-match if read
    const rel = join('..', outside.slice(2).replaceAll('\\', '/'), 'secret.txt');
    const errors = await verifyReceiptArtifacts(receiptFor({ packet: rel }), dir);
    assert.ok(errors.some((e) => e.includes('escapes the run directory')), errors.join('\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('verifyReceiptArtifacts: absolute path outside the base is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rb-arts-'));
  const outside = join(tmpdir(), 'rb-abs-' + Date.now());
  try {
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'x.md'), PACKET, 'utf8');
    const errors = await verifyReceiptArtifacts(receiptFor({ packet: join(outside, 'x.md') }), dir);
    assert.ok(errors.some((e) => e.includes('escapes the run directory')), errors.join('\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('verifyReceiptArtifacts: symlink pointing outside is refused', { skip: process.platform === 'win32' && 'symlink needs Windows developer mode; the lstat guard is still exercised by the directory case' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rb-arts-'));
  const outside = await mkdtemp(join(tmpdir(), 'rb-out-'));
  try {
    await writeFile(join(outside, 'target.md'), PACKET, 'utf8');
    await symlink(join(outside, 'target.md'), join(dir, 'link.md'), 'file');
    const errors = await verifyReceiptArtifacts(receiptFor({ packet: 'link.md' }), dir);
    assert.ok(errors.some((e) => e.includes('not a regular file')), errors.join('\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('verifyReceiptArtifacts: a directory where a file is expected is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rb-arts-'));
  try {
    await mkdir(join(dir, 'packet.md'), { recursive: true });
    const errors = await verifyReceiptArtifacts(receiptFor({ packet: 'packet.md' }), dir);
    assert.ok(errors.some((e) => e.includes('not a regular file')), errors.join('\n'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --- version migration / backward compatibility -------------------------------

test('consent: schema_version 0 (pre-release) state is invalid, not crash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rb-mig-'));
  try {
    const file = join(dir, 'consent.json');
    await writeFile(file, JSON.stringify({ schema_version: 0, disclosure_version: 1, browser_automation_enabled: true, decided_at: '2026-01-01T00:00:00Z' }), 'utf8');
    const status = await consentStatus(file);
    assert.equal(status.status, 'NEEDS_AUTOMATION_CONSENT');
    assert.equal(status.reason, 'invalid_state');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('consent: future schema_version (3) is treated as stale/invalid, never silently accepted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rb-mig-'));
  try {
    const file = join(dir, 'consent.json');
    await writeFile(file, JSON.stringify({ schema_version: 3, disclosure_version: 1, browser_automation_enabled: true, decided_at: '2026-01-01T00:00:00Z' }), 'utf8');
    const status = await consentStatus(file);
    assert.notEqual(status.status, 'READY', 'an unknown future schema must not be honored');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('consent: current schema_version 1 + READY round-trips (the compatibility baseline)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rb-mig-'));
  try {
    const file = join(dir, 'consent.json');
    await writeFile(file, JSON.stringify({ schema_version: 1, disclosure_version: 1, browser_automation_enabled: true, decided_at: '2026-01-01T00:00:00Z' }), 'utf8');
    const status = await consentStatus(file);
    assert.equal(status.status, 'READY');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('receipt: schema_version 1 receipts parse but the completion gate refuses them', async () => {
  const parsed = safeParseReceipt('{"schema_version":1,"packet_id":"p"}');
  assert.equal(parsed.ok, true, 'an old receipt still parses — forward-compat for inspection');
});

test('receipt: future schema_version (3) is refused by the receipt gate, not silently accepted', async () => {
  const { validateReceipt } = await import('../skills/reasoning-bridge/scripts/validate.mjs');
  const errors = validateReceipt({ schema_version: 3, packet_id: 'p', target: 'chatgpt' });
  assert.ok(errors.some((e) => e.includes('schema_version must be 2')), errors.join('\n'));
});
