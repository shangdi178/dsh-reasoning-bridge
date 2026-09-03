#!/usr/bin/env node

// Target selection state for dsh-reasoning-bridge (multi-target transport).
// State file: ~/.dsh/dsh-reasoning-bridge/state.json ($DSH_REASONING_BRIDGE_HOME overrides).
// Commands: get --json | set <id> --json | list --json. Zero dependencies.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);

// Single source of truth for target ids; validate.mjs keeps its own copy for CLI independence.
const TARGETS = [{ id: 'chatgpt', site: 'https://chatgpt.com/' }];
const TARGET_IDS = new Set(TARGETS.map((t) => t.id));
const STATE_SCHEMA_VERSION = 1;

export function defaultStatePath(environment = process.env) {
  const home = environment.DSH_REASONING_BRIDGE_HOME?.trim() || join(homedir(), '.dsh', 'dsh-reasoning-bridge');
  return join(home, 'state.json');
}

export async function readState(stateFile = defaultStatePath()) {
  try {
    const state = JSON.parse(await readFile(resolve(stateFile), 'utf8'));
    if (state?.schema_version === STATE_SCHEMA_VERSION && typeof state.target === 'string') {
      return state;
    }
  } catch { /* fall through to default */ }
  return { schema_version: STATE_SCHEMA_VERSION, target: 'chatgpt', updated_at: null };
}

export async function writeTarget(targetId, stateFile = defaultStatePath()) {
  if (!TARGET_IDS.has(targetId)) {
    throw new Error(`unknown target: ${targetId}; known: ${[...TARGET_IDS].join(', ')}`);
  }
  const target = resolve(stateFile);
  const state = {
    schema_version: STATE_SCHEMA_VERSION,
    target: targetId,
    updated_at: new Date().toISOString(),
  };
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return state;
}

function out(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  try {
    if (command === 'get') {
      const state = await readState();
      out({ ...state, known_targets: [...TARGET_IDS] });
      return;
    }
    if (command === 'list') {
      out({ targets: TARGETS });
      return;
    }
    if (command === 'set') {
      out(await writeTarget(argument));
      return;
    }
    throw new Error('expected command: get, set <id>, or list');
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error('usage: target.mjs <get|list> --json | target.mjs set <target-id> --json');
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
