import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  normalizeSection,
  parseScalarBool,
  parseScalarSection,
  readSettings,
  SETTINGS_BOUNDS,
  SETTINGS_DEFAULTS,
} from '../skills/reasoning-bridge/scripts/lib/settings-bridge.mjs';

const SAMPLE = [
  '# dsh settings document (managed by the settings UI)',
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'reasoning-bridge:',
  '  target: chatgpt',
  '  composerWaitMs: 15000',
  '  streamTimeoutMs: 240000',
  '  checkNodeRuntime: false',
  'another-plugin:',
  '  someKey: 42',
].join('\n');

test('parseScalarSection extracts exactly our two-level section', () => {
  const parsed = parseScalarSection(SAMPLE, 'reasoning-bridge');
  assert.equal(parsed.target, 'chatgpt');
  assert.equal(parsed.composerWaitMs, '15000');
  assert.equal(parsed.checkNodeRuntime, 'false');
  assert.equal(parsed.streamTimeoutMs, '240000');
  assert.equal('welcomeNoticeVersion' in parsed, false, 'must not leak sibling sections');
  assert.equal('someKey' in parsed, false);
});

test('parseScalarSection tolerates missing section and comments', () => {
  assert.deepEqual(parseScalarSection('# only comments\n', 'reasoning-bridge'), {});
  assert.deepEqual(parseScalarSection('other:\n  x: 1\n', 'reasoning-bridge'), {});
});

test('parseScalarBool covers booleans and common string forms', () => {
  assert.equal(parseScalarBool(true), true);
  assert.equal(parseScalarBool('true'), true);
  assert.equal(parseScalarBool('yes'), true);
  assert.equal(parseScalarBool('1'), true);
  assert.equal(parseScalarBool('false'), false);
  assert.equal(parseScalarBool('no'), false);
  assert.equal(parseScalarBool('0'), false);
});

test('normalizeSection clamps to bounds and drops invalid values', () => {
  const normalized = normalizeSection({ composerWaitMs: '99999999', streamTimeoutMs: '240000', target: 'chatgpt', checkNodeRuntime: 'false' });
  assert.equal(normalized.composerWaitMs, undefined, 'out-of-bounds value must be dropped');
  assert.equal(normalized.streamTimeoutMs, 240000);
  assert.equal(normalized.target, 'chatgpt');
  assert.equal(normalized.checkNodeRuntime, false);
  assert.equal(normalizeSection({ bogus: 'x' }).bogus, undefined, 'unknown keys must be dropped');
});

test('readSettings falls back to defaults on a missing document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-settings-'));
  const settings = await readSettings({ DSH_HOME: dir }, join(dir, 'settings.yaml'));
  assert.equal(settings.target, 'chatgpt');
  assert.equal(settings.composerWaitMs, SETTINGS_DEFAULTS.composerWaitMs);
  assert.equal(settings.checkNodeRuntime, true);
});

test('readSettings merges the document section and honors env overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-settings-'));
  const file = join(dir, 'settings.yaml');
  await writeFile(file, SAMPLE, 'utf8');
  const env = {
    DSH_HOME: dir,
    DSH_REASONING_BRIDGE_TARGET: 'chatgpt',
    DSH_REASONING_BRIDGE_STREAM_TIMEOUT_MS: '300000',
  };
  const settings = await readSettings(env, file);
  assert.equal(settings.target, 'chatgpt');
  assert.equal(settings.composerWaitMs, 15000, 'document value wins over default');
  assert.equal(settings.streamTimeoutMs, 300000, 'env override wins over document');
  assert.equal(settings.checkNodeRuntime, false, 'document boolean parsed');
});

test('every setting default falls inside its declared bounds', () => {
  for (const [field, value] of Object.entries(SETTINGS_DEFAULTS)) {
    if (field === 'target' || field === 'checkNodeRuntime') continue;
    const [min, max] = SETTINGS_BOUNDS[field];
    assert.ok(value >= min && value <= max, `${field} default ${value} outside ${min}..${max}`);
  }
});
