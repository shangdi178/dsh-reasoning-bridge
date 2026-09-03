import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaultStatePath, readState, writeTarget } from '../skills/reasoning-bridge/scripts/target.mjs';

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
