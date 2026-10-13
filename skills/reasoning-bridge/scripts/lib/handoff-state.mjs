#!/usr/bin/env node

// Deterministic transport state machine for dsh-reasoning-bridge (Issue #2 Phase 2).
//
// A handoff is a transcript of observed states. This module is the single source
// of truth for which transitions are legal; `validate.mjs receipt|complete`
// refuses a receipt whose transcript is not RESULT_VALIDATED or that entered the
// terminal UNCERTAIN state. Zero dependencies. Exit 0 = valid, 1 = errors, 2 = usage.
//
//   PRECHECKED → COMPOSER_VERIFIED → SEND_INTENT → SUBMITTED → RESULT_OBSERVED → RESULT_VALIDATED
//                                       └────────────┴─→ UNCERTAIN (terminal)
//
// SEND_INTENT records the human confirmation to transmit; SUBMITTED requires the
// packet echo or conversation URL observed after exactly one send action;
// RESULT_OBSERVED requires an answer bound to this run (packet_id echo or the
// newest assistant turn), never a detached first-turn Copy button.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const HANDOFF_SCHEMA_VERSION = 1;

export const STATES = [
  'PRECHECKED',
  'COMPOSER_VERIFIED',
  'SEND_INTENT',
  'SUBMITTED',
  'RESULT_OBSERVED',
  'RESULT_VALIDATED',
  'UNCERTAIN',
];

const ORDER = new Map(STATES.map((state, index) => [state, index]));

/**
 * Legal transitions. Any transition not listed (including backwards or skipping
 * COMPOSER_VERIFIED) is refused. UNCERTAIN is terminal: nothing may follow it,
 * because the run must not guess whether a send actually landed.
 */
const TRANSITIONS = new Map([
  ['PRECHECKED', ['COMPOSER_VERIFIED', 'UNCERTAIN']],
  ['COMPOSER_VERIFIED', ['SEND_INTENT', 'UNCERTAIN']],
  ['SEND_INTENT', ['SUBMITTED', 'UNCERTAIN']],
  ['SUBMITTED', ['RESULT_OBSERVED', 'UNCERTAIN']],
  ['RESULT_OBSERVED', ['RESULT_VALIDATED', 'UNCERTAIN']],
  ['RESULT_VALIDATED', []],
  ['UNCERTAIN', []],
]);

/**
 * Evidence required to claim a state. Each entry: the transcript entry must
 * carry the listed fields non-empty. `packet_id` binding is checked separately.
 */
const REQUIRED_EVIDENCE = {
  PRECHECKED: ['site'],
  COMPOSER_VERIFIED: ['site'],
  SEND_INTENT: ['confirmed_by'],
  SUBMITTED: ['evidence'],
  RESULT_OBSERVED: ['evidence', 'bound_by'],
  RESULT_VALIDATED: ['validator'],
  UNCERTAIN: [],
};

export function isLegalTransition(from, to) {
  return (TRANSITIONS.get(from) ?? []).includes(to);
}

/**
 * Validate one transcript entry. Returns a list of errors for this entry.
 * Shape: { state, at?, site?, evidence?, confirmed_by?, bound_by?, validator?, note? }
 */
export function validateEntry(entry, { previous } = {}) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['transcript entry must be an object'];
  }
  const state = entry.state;
  if (!STATES.includes(state)) {
    errors.push(`unknown state: ${JSON.stringify(state)}; known: ${STATES.join(', ')}`);
    return errors;
  }
  if (previous) {
    if (!isLegalTransition(previous.state, state)) {
      errors.push(`illegal transition ${previous.state} -> ${state}`);
    }
    if (previous.state === 'UNCERTAIN') {
      errors.push('UNCERTAIN is terminal; no entry may follow it');
    }
  }
  for (const field of REQUIRED_EVIDENCE[state] ?? []) {
    const value = entry[field];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${state} requires non-empty "${field}"`);
    }
  }
  if (typeof entry.at !== 'undefined' && Number.isNaN(Date.parse(entry.at ?? ''))) {
    errors.push('entry.at must be an ISO timestamp when present');
  }
  if (entry.note !== undefined && typeof entry.note !== 'string') {
    errors.push('entry.note must be a string when present');
  }
  return errors;
}

/**
 * Validate a whole transcript. Beyond per-entry checks this enforces the two
 * run-level invariants that make the machine honest:
 *   1. packet_id is bound at RESULT_OBSERVED/RESULT_VALIDATED by an echo of the
 *      same id that the run started with, not by a detached marker alone;
 *   2. a transcript that reached UNCERTAIN can never be completed.
 * Returns { ok, errors, finalState }.
 */
export function validateTranscript(transcript, { packetId } = {}) {
  const errors = [];
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return { ok: false, errors: ['transcript must be a non-empty array'], finalState: null };
  }
  let previous = null;
  transcript.forEach((entry, index) => {
    const entryErrors = validateEntry(entry, { previous });
    for (const error of entryErrors) errors.push(`transcript[${index}]: ${error}`);
    if (!entryErrors.some((e) => e.startsWith('unknown state'))) previous = entry;
  });
  const finalState = previous?.state ?? null;
  if (finalState === 'UNCERTAIN') {
    errors.push('transcript ended in UNCERTAIN: the send outcome was never confirmed; the run cannot proceed or complete');
  } else if (finalState !== 'RESULT_VALIDATED') {
    errors.push(`transcript ends at ${finalState ?? '(none)'}; completion requires RESULT_VALIDATED`);
  }
  if (packetId) {
    for (const [index, entry] of transcript.entries()) {
      if (!['RESULT_OBSERVED', 'RESULT_VALIDATED'].includes(entry.state)) continue;
      const echoed = entry.packet_id ?? entry.bound_packet_id;
      if (echoed !== packetId) {
        errors.push(`transcript[${index}]: ${entry.state} must bind the run's packet_id (expected ${packetId}, got ${JSON.stringify(echoed ?? null)})`);
      }
    }
  }
  return { ok: errors.length === 0, errors, finalState };
}

/** Parse transcript text without throwing: { ok, transcript } or { ok:false, error }. */
export function safeParseTranscript(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return { ok: false, error: 'transcript must be a JSON array' };
    return { ok: true, transcript: parsed };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function out(value) { console.log(JSON.stringify(value, null, 2)); }

async function main() {
  const [mode, path] = process.argv.slice(2);
  if (mode !== 'handoff' || !path || process.argv.slice(2).includes('--help') || process.argv.slice(2).includes('-h')) {
    console.error('usage: transport.mjs handoff <transcript.json> [--packet-id <id>]');
    console.error('   validates a handoff state transcript against the deterministic machine;');
    console.error('   transcript must end at RESULT_VALIDATED and never enter UNCERTAIN.');
    process.exitCode = 2;
    return;
  }
  const wantsPacketId = process.argv.indexOf('--packet-id');
  const packetId = wantsPacketId !== -1 ? process.argv[wantsPacketId + 1] : undefined;
  let parsed;
  try {
    parsed = safeParseTranscript(await readFile(path, 'utf8'));
  } catch (error) {
    console.error(`ERROR: cannot read ${path}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (!parsed.ok) {
    console.error(`ERROR: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }
  const result = validateTranscript(parsed.transcript, { packetId });
  out({
    ok: result.ok,
    final_state: result.finalState,
    schema_version: HANDOFF_SCHEMA_VERSION,
    ...(result.errors.length ? { errors: result.errors } : {}),
  });
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
