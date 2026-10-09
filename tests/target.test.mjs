import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { configuredTarget, defaultStatePath, readState, writeTarget } from '../skills/reasoning-bridge/scripts/target.mjs';
import { TARGET_IDS, TARGETS, modelsFor, siteFor } from '../skills/reasoning-bridge/scripts/targets-table.mjs';

test('default state path lives under ~/.dsh/dsh-reasoning-bridge', () => {
  assert.match(defaultStatePath(), /dsh-reasoning-bridge[\\/]state\.json$/);
});

test('readState falls back to chatgpt when absent', async () => {
  const state = await readState(join(tmpdir(), `bridge-state-missing-${Date.now()}`, 'state.json'));
  assert.equal(state.target, 'chatgpt');
});

test('writeTarget round-trips and rejects unknown ids', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-state-'));
  try {
    const stateFile = join(dir, 'state.json');
    await writeTarget('chatgpt', stateFile);
    assert.equal((await readState(stateFile)).target, 'chatgpt');
    await assert.rejects(writeTarget('claude', stateFile), /unknown target/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('targets table maps ids to https sites', () => {
  assert.deepEqual([...TARGET_IDS], ['chatgpt', 'arena']);
  assert.deepEqual(TARGETS, [
    { id: 'chatgpt', site: 'https://chatgpt.com/', models: 'selectable' },
    { id: 'arena', site: 'https://arena.ai/', models: 'battle' },
  ]);
  assert.equal(siteFor('chatgpt'), 'https://chatgpt.com/');
  assert.equal(siteFor('arena'), 'https://arena.ai/');
  assert.equal(siteFor('claude'), null);
});

test('every target records how it treats model identity', () => {
  // The receipt contract needs an honest model status per target: a battle
  // arena randomizes anonymous models and can never be verified.
  assert.equal(modelsFor('chatgpt'), 'selectable');
  assert.equal(modelsFor('arena'), 'battle');
  assert.equal(modelsFor('claude'), null);
  for (const target of TARGETS) {
    assert.ok(['selectable', 'battle'].includes(target.models), `${target.id} declares a model policy`);
  }
});

test('arena is selectable through state.json and the settings document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-arena-'));
  try {
    const stateFile = join(dir, 'state.json');
    const settingsFile = join(dir, 'settings.yaml');
    // no settings, no state -> default
    assert.equal(await configuredTarget({ DSH_HOME: dir }, stateFile), 'chatgpt');
    // state.json alone selects arena (the legacy `target.mjs set` surface)
    await writeTarget('arena', stateFile);
    assert.equal((await readState(stateFile)).target, 'arena');
    assert.equal(await configuredTarget({ DSH_HOME: dir }, stateFile), 'arena');
    // an unknown settings target is ignored, so state.json still wins
    await writeFile(settingsFile, 'reasoning-bridge:\n  target: agora\n', 'utf8');
    assert.equal(await configuredTarget({ DSH_HOME: dir }, stateFile), 'arena');
    // a valid settings target is the visible GUI surface and outranks state.json
    await writeFile(settingsFile, 'reasoning-bridge:\n  target: chatgpt\n', 'utf8');
    assert.equal(await configuredTarget({ DSH_HOME: dir }, stateFile), 'chatgpt');
    await writeFile(settingsFile, 'reasoning-bridge:\n  target: arena\n', 'utf8');
    assert.equal(await configuredTarget({ DSH_HOME: dir }, stateFile), 'arena');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('configuredTarget prefers the settings document over state.json and defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  try {
    const stateFile = join(dir, 'state.json');
    const settingsFile = join(dir, 'settings.yaml');
    const env = { DSH_HOME: dir };
    // no settings, no state -> default
    assert.equal(await configuredTarget(env, stateFile), 'chatgpt');
    // legacy state.json honored when the settings document has no target
    await writeTarget('chatgpt', stateFile);
    assert.equal(await configuredTarget(env, stateFile), 'chatgpt');
    // settings document wins over state.json (GUI is the primary surface)
    await writeFile(settingsFile, 'reasoning-bridge:\n  target: chatgpt\n', 'utf8');
    assert.equal(await configuredTarget(env, stateFile), 'chatgpt');
    // an invalid settings target falls back to the default
    await writeFile(settingsFile, 'reasoning-bridge:\n  target: claude\n', 'utf8');
    assert.equal(await configuredTarget(env, stateFile), 'chatgpt');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
