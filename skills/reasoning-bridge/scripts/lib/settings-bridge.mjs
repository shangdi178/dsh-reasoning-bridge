// Settings bridge for dsh-reasoning-bridge. The host's settings panel writes
// a `reasoning-bridge` section into the harness settings document
// (~/.dsh/settings.yaml by default, `$DSH_HOME` overrides). The CLI scripts
// (target.mjs, transport.mjs, doctor.mjs) cannot use the host's
// ctx.settings service, so this module reads that same section with a tiny
// zero-dependency scalar parser, applies environment-variable overrides, and
// validates every value semantically. Defaults here must mirror the schema
// registered by lib/index.js (a test asserts the field names match).
//
// Precedence: environment override > settings document section > default.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

export const SETTINGS_DEFAULTS = Object.freeze({
  target: 'chatgpt',
  composerWaitMs: 12000,
  sendWaitMs: 4000,
  urlWaitMs: 15000,
  appearTimeoutMs: 30000,
  streamTimeoutMs: 150000,
  stabilityMs: 2500,
  checkNodeRuntime: true,
});

export const SETTINGS_BOUNDS = Object.freeze({
  composerWaitMs: [1000, 60000],
  sendWaitMs: [500, 30000],
  urlWaitMs: [3000, 120000],
  appearTimeoutMs: [5000, 120000],
  streamTimeoutMs: [15000, 600000],
  stabilityMs: [100, 60000],
});

const NUMBER_FIELDS = new Set([
  'composerWaitMs',
  'sendWaitMs',
  'urlWaitMs',
  'appearTimeoutMs',
  'streamTimeoutMs',
  'stabilityMs',
]);
const BOOLEAN_FIELDS = new Set(['checkNodeRuntime']);
const STRING_FIELDS = new Set(['target']);

const ENV_PREFIX = 'DSH_REASONING_BRIDGE_';

export function harnessSettingsPath(environment = process.env) {
  const home = environment.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return join(home, 'settings.yaml');
}

/**
 * Minimal YAML parser for one two-level scalar section — enough to read our
 * `reasoning-bridge:` block the way the host's settings-file persists it
 * (top-level key, two-space-indented `key: scalar` children). Anything else
 * (nested objects, lists, comments-only lines) is left to the defaults.
 * Zero dependencies on purpose.
 */
export function parseScalarSection(text, section) {
  const found = {};
  let inSection = false;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const topMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
      if (!topMatch) continue;
      inSection = topMatch[1] === section;
      continue;
    }
    if (!inSection || indent < 2) continue;
    const pair = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    let value = pair[2].trim();
    if (value === '' || value === 'null' || value === '~') continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    found[pair[1]] = value;
  }
  return found;
}

export function parseScalarBool(value) {
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === 'yes' || value === '1';
}

export function normalizeSection(raw) {
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (NUMBER_FIELDS.has(key)) {
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
      if (!Number.isInteger(parsed)) continue;
      const [min, max] = SETTINGS_BOUNDS[key] ?? [-Infinity, Infinity];
      if (parsed < min || parsed > max) continue;
      normalized[key] = parsed;
    } else if (BOOLEAN_FIELDS.has(key)) {
      normalized[key] = parseScalarBool(value);
    } else if (STRING_FIELDS.has(key)) {
      normalized[key] = String(value).trim();
    }
  }
  return normalized;
}

function envOverrides(environment = process.env) {
  const overrides = {};
  for (const field of Object.keys(SETTINGS_DEFAULTS)) {
    // Env names use UPPER_SNAKE: DSH_REASONING_BRIDGE_STREAM_TIMEOUT_MS
    const envName = `${ENV_PREFIX}${field.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()}`;
    const raw = environment[envName];
    if (raw === undefined) continue;
    const probe = { [field]: raw };
    const normalized = normalizeSection(probe);
    if (field in normalized) overrides[field] = normalized[field];
  }
  return overrides;
}

/**
 * Read the effective settings document section plus environment overrides.
 * Never throws: a missing/unreadable document, an absent section, or invalid
 * values all fall back to defaults.
 */
export async function readSettings(environment = process.env, settingsFile = harnessSettingsPath(environment)) {
  const document = {};
  try {
    const text = await readFile(settingsFile, 'utf8');
    Object.assign(document, normalizeSection(parseScalarSection(text, 'reasoning-bridge')));
  } catch { /* absent or unreadable document: defaults */ }
  Object.assign(document, envOverrides(environment));
  return { ...SETTINGS_DEFAULTS, ...document };
}

/** The configured target id (defaults to chatgpt), or null when invalid. */
export async function readConfiguredTarget(environment = process.env, settingsFile = harnessSettingsPath(environment)) {
  const settings = await readSettings(environment, settingsFile);
  const { TARGET_IDS } = await import('../targets-table.mjs');
  return TARGET_IDS.has(settings.target) ? settings.target : SETTINGS_DEFAULTS.target;
}
