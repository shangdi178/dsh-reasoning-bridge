#!/usr/bin/env node

// Deterministic handoff validator for dsh-reasoning-bridge.
// Modes: packet|result <file> · pair <packet> <result> · receipt|complete <json> · hash <file>
// Zero dependencies. Exit 0 = valid, 1 = errors, 2 = usage.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_IDS } from './targets-table.mjs';

export { TARGET_IDS };

const PACKET_SECTIONS = [
  '## Objective',
  '## Acceptance',
  '## Repository State',
  '## Evidence',
  '## Constraints',
  '## Questions',
];

const RESULT_SECTIONS = [
  '## Verdict',
  '## Assumptions',
  '## Evidence Used',
  '## Proposed Changes',
  '## Tests',
  '## Risks',
  '## Unknowns',
];

/**
 * Credential-shape heuristics. These are a necessary-but-insufficient barrier:
 * they catch well-known shapes and obvious `key: value` assignments, they cannot
 * understand business secrets. The semantic privacy review in SKILL.md stays
 * mandatory, and `send` refuses to run until this scan is clean.
 */
const SECRET_PATTERNS = [
  // Private key blocks (including PGP / OpenSSH / PKCS#8 variants).
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/i,
  // AWS access key id, and the standalone 40-char secret access key.
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/,
  /aws_secret_access_key\s*[:=]\s*(?!\[REDACTED\])\S+/i,
  // VCS / CI / chat / infra tokens.
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bhf_[A-Za-z0-9]{30,}\b/,
  /\bsk-(?:live|test|proj|ant|or)?-?[A-Za-z0-9_-]{20,}\b/,
  // Stripe-style `sk_live_…` / `rk_test_…` (underscore separators).
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  // Google / Azure / generic cloud keys.
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bAccountKey\s*=\s*(?!\[REDACTED\])[A-Za-z0-9+/=]{20,}/i,
  /\b(?:LTAI|AKID)[A-Za-z0-9]{12,}\b/,
  // JWTs (three base64url segments) — caught even when embedded in a header.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  // Connection strings that embed a password.
  /\b[a-z][a-z0-9+.-]{2,}:\/\/[^\s:@/]+:[^\s:@/]{3,}@/i,
  // Authorization / cookie headers and webhook URLs.
  /\bAuthorization\s*:\s*(?!\[REDACTED\])\S+/i,
  /\b(?:Cookie|Set-Cookie)\s*:\s*(?!\[REDACTED\])\S+/i,
  /https:\/\/hooks\.slack\.com\/services\/\S+/i,
  /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\S+/i,
  // Generic `key: value` / `key = value` credential assignments, including the
  // .env shapes the earlier list missed (bare secret/token/passwd, DB_PASS...).
  /\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|password|passwd|pwd|secret|token|credential)s?\s*[:=]\s*(?!\[REDACTED\])\S+/i,
  // .env-style SCREAMING_CASE assignments whose name ends in a secret noun.
  /^\s*[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)S?\s*=\s*(?!\[REDACTED\])\S+/m,
];


const MODEL_STATUSES = new Set(['verified', 'unverified']);
const CHECK_STATUSES = new Set(['passed', 'failed', 'not_run']);
const LOCAL_CHANGE_STATUSES = new Set(['applied', 'no_changes_needed', 'failed', 'not_run']);
const PRIVACY_FIELDS = [
  'scope_minimized',
  'credentials_scan_passed',
  'semantic_privacy_reviewed',
  'raw_diff_excluded',
  'unrelated_files_excluded',
];

export function estimateTokens(text) {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const nonCjk = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '');
  return cjk + Math.ceil(nonCjk.length / 4);
}

/**
 * Credential-shape scan, exported so the transport driver can enforce it on the
 * send path instead of trusting a separately-run CLI step.
 * Returns the list of matched shapes (empty = clean); never throws.
 */
export function scanForSecrets(text) {
  const haystack = typeof text === 'string' ? text : '';
  return SECRET_PATTERNS
    .map((pattern, index) => (pattern.test(haystack) ? `secret-pattern-${index + 1}` : null))
    .filter(Boolean);
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n');
}

function exactLineCount(lines, value) {
  return lines.filter((line) => line.trim() === value).length;
}

function validateContract(text, { start, end, sections }) {
  const errors = [];
  const lines = normalizeText(text).trim().split('\n');
  if (exactLineCount(lines, start) !== 1) errors.push(`opening marker must appear exactly once: ${start}`);
  if (exactLineCount(lines, end) !== 1) errors.push(`closing marker must appear exactly once: ${end}`);
  if (lines[0]?.trim() !== start || lines.at(-1)?.trim() !== end) {
    errors.push('non-empty text exists outside the contract markers');
  }
  const packetIdCount = lines.filter((line) => /^packet_id:\s*\S+\s*$/.test(line)).length;
  if (packetIdCount !== 1) errors.push('packet_id must appear exactly once');
  let previous = -1;
  for (const section of sections) {
    const count = exactLineCount(lines, section);
    const index = lines.findIndex((line) => line.trim() === section);
    if (count === 0) errors.push(`missing required section: ${section}`);
    else if (count > 1) errors.push(`required section must appear exactly once: ${section}`);
    else if (index < previous) errors.push(`section out of order: ${section}`);
    previous = Math.max(previous, index);
  }
  return errors;
}

export function validatePacket(text) {
  const errors = validateContract(text, {
    start: 'BEGIN_CONTEXT_PACKET',
    end: 'END_CONTEXT_PACKET',
    sections: PACKET_SECTIONS,
  });
  const lines = normalizeText(text).split('\n');
  const reasonerCount = lines.filter((line) => /^requested_reasoner:\s*\S.+$/.test(line)).length;
  if (reasonerCount !== 1) errors.push('requested_reasoner must appear exactly once');
  const tokens = estimateTokens(text);
  if (tokens > 3000) errors.push(`packet exceeds 3000 approximate tokens: ${tokens}`);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    errors.push('packet contains a likely secret; redact it before browser transmission');
  }
  return errors;
}

export function validateResult(text) {
  const errors = validateContract(text, {
    start: 'BEGIN_REASONING_RESULT',
    end: 'END_REASONING_RESULT',
    sections: RESULT_SECTIONS,
  });
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    errors.push('result contains a likely secret; do not persist or execute it');
  }
  return errors;
}

function packetId(text) {
  return text.match(/^packet_id:\s*(\S+)/m)?.[1];
}

export function validatePair(packet, result) {
  const errors = [
    ...validatePacket(packet).map((error) => `packet: ${error}`),
    ...validateResult(result).map((error) => `result: ${error}`),
  ];
  const sentId = packetId(packet);
  const returnedId = packetId(result);
  if (sentId && returnedId && sentId !== returnedId) {
    errors.push(`packet_id mismatch: sent ${sentId}, returned ${returnedId}`);
  }
  return errors;
}

function validateModelRecord(receipt, field, errors) {
  const model = receipt[field];
  if (!model || typeof model !== 'object') {
    errors.push(`missing model record: ${field}`);
    return;
  }
  if (typeof model.requested !== 'string' || !model.requested.trim()) {
    errors.push(`${field}.requested must be a non-empty string`);
  }
  if (!MODEL_STATUSES.has(model.status)) {
    errors.push(`${field}.status must be verified or unverified`);
  }
  if (typeof model.evidence !== 'string' || !model.evidence.trim()) {
    errors.push(`${field}.evidence must be a non-empty local evidence note`);
  }
  if (model.status === 'verified' && (typeof model.observed !== 'string' || !model.observed.trim())) {
    errors.push(`${field}.observed is required when status is verified`);
  }
  if (field === 'web_model') {
    for (const evidenceField of ['preflight_visible', 'postflight_visible']) {
      if (typeof model[evidenceField] !== 'boolean') {
        errors.push(`${field}.${evidenceField} must be boolean`);
      }
    }
  }
}

function validateArtifact(receipt, field, errors) {
  const artifact = receipt.artifacts?.[field];
  if (!artifact || typeof artifact !== 'object') {
    errors.push(`missing artifact record: ${field}`);
    return;
  }
  if (typeof artifact.path !== 'string' || !artifact.path.trim()) {
    errors.push(`artifacts.${field}.path must be a non-empty string`);
  }
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    errors.push(`artifacts.${field}.sha256 must be 64 lowercase hex characters`);
  }
}

export function validateReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return ['receipt must be a JSON object'];
  }
  if (receipt.schema_version !== 2) errors.push('schema_version must be 2');
  if (typeof receipt.packet_id !== 'string' || !receipt.packet_id.trim()) {
    errors.push('missing packet_id');
  }
  if (typeof receipt.target !== 'string' || !TARGET_IDS.has(receipt.target)) {
    errors.push(`target must be one of: ${[...TARGET_IDS].join(', ')}`);
  }
  validateModelRecord(receipt, 'local_model', errors);
  validateModelRecord(receipt, 'web_model', errors);
  for (const field of ['packet', 'result', 'browser_evidence']) {
    validateArtifact(receipt, field, errors);
  }
  const tokens = receipt.artifacts?.packet?.approximate_tokens;
  if (!Number.isInteger(tokens) || tokens < 1) {
    errors.push('artifacts.packet.approximate_tokens must be a positive integer');
  }
  if (!receipt.privacy_review || typeof receipt.privacy_review !== 'object') {
    errors.push('missing privacy_review');
  } else {
    for (const field of PRIVACY_FIELDS) {
      if (typeof receipt.privacy_review[field] !== 'boolean') {
        errors.push(`privacy_review.${field} must be boolean`);
      }
    }
  }
  if (!new Set(['verified', 'failed']).has(receipt.browser_transport)) {
    errors.push('browser_transport must be verified or failed');
  }
  for (const field of ['packet_validation', 'result_validation', 'pair_validation', 'local_revalidation', 'tests']) {
    if (!CHECK_STATUSES.has(receipt[field])) {
      errors.push(`${field} must be passed, failed, or not_run`);
    }
  }
  if (!receipt.adoption || typeof receipt.adoption !== 'object') {
    errors.push('missing adoption record');
  } else {
    if (!CHECK_STATUSES.has(receipt.adoption.status)) {
      errors.push('adoption.status must be passed, failed, or not_run');
    }
    for (const field of ['accepted', 'rejected', 'deferred', 'local_evidence']) {
      if (!Array.isArray(receipt.adoption[field])) errors.push(`adoption.${field} must be an array`);
    }
  }
  if (!receipt.local_changes || typeof receipt.local_changes !== 'object') {
    errors.push('missing local_changes record');
  } else {
    if (!LOCAL_CHANGE_STATUSES.has(receipt.local_changes.status)) {
      errors.push('local_changes.status is invalid');
    }
    if (typeof receipt.local_changes.reason !== 'string' || !receipt.local_changes.reason.trim()) {
      errors.push('local_changes.reason must be non-empty');
    }
  }
  return errors;
}

export function receiptCompletionErrors(receipt) {
  const errors = validateReceipt(receipt);
  if (errors.length) return errors;
  if (receipt.local_model.status !== 'verified') errors.push('local_model is not verified');
  if (receipt.web_model.status !== 'verified') errors.push('web_model is not verified');
  if (!receipt.web_model.preflight_visible) errors.push('web_model preflight evidence is not verified');
  if (!receipt.web_model.postflight_visible) errors.push('web_model postflight evidence is not verified');
  if (receipt.browser_transport !== 'verified') errors.push('browser transport is not verified');
  for (const field of PRIVACY_FIELDS) {
    if (!receipt.privacy_review[field]) errors.push(`privacy_review.${field} is not passed`);
  }
  for (const field of ['packet_validation', 'result_validation', 'pair_validation', 'local_revalidation', 'tests']) {
    if (receipt[field] !== 'passed') errors.push(`${field} is not passed`);
  }
  if (receipt.adoption.status !== 'passed') errors.push('adoption is not passed');
  // The gate must not accept a bare `status: "passed"`: a run that accepted
  // nothing still has to say why, and every accepted proposal needs the local
  // evidence that justified it. Otherwise `complete` is pure self-attestation.
  if (!receipt.adoption.local_evidence.length) {
    errors.push('adoption.local_evidence must record at least one locally reopened anchor');
  }
  const classified = receipt.adoption.accepted.length
    + receipt.adoption.rejected.length
    + receipt.adoption.deferred.length;
  if (!classified) {
    errors.push('adoption must classify at least one proposal (accepted, rejected or deferred)');
  }
  if (!['applied', 'no_changes_needed'].includes(receipt.local_changes.status)) {
    errors.push('local_changes is not complete');
  }
  return errors;
}

export async function verifyReceiptArtifacts(receipt, baseDirectory) {
  const errors = [];
  for (const field of ['packet', 'result', 'browser_evidence']) {
    const artifact = receipt.artifacts?.[field];
    if (!artifact?.path || !artifact?.sha256) continue;
    try {
      const content = await readFile(resolve(baseDirectory, artifact.path), 'utf8');
      const actual = sha256Text(content);
      if (actual !== artifact.sha256) {
        errors.push(`${field} sha256 mismatch: expected ${artifact.sha256}, actual ${actual}`);
      }
      // Re-scan the artifact we just hashed. `privacy_review.credentials_scan_passed`
      // is a self-declared boolean; the completion gate must not rest on it.
      if (scanForSecrets(content).length) {
        errors.push(`${field} artifact still contains a likely secret; redact it and re-hash`);
      }
    } catch (error) {
      errors.push(`${field} artifact cannot be read: ${error.message}`);
    }
  }
  return errors;
}

/** Parse receipt text without throwing: { ok: true, receipt } or { ok: false, error }. */
export function safeParseReceipt(text) {
  try {
    return { ok: true, receipt: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function main() {
  const [mode, firstPath, secondPath] = process.argv.slice(2);
  if (!['packet', 'result', 'pair', 'receipt', 'complete', 'hash'].includes(mode) || !firstPath || (mode === 'pair' && !secondPath)) {
    console.error('usage: validate.mjs <packet|result> <markdown-file>');
    console.error('   or: validate.mjs pair <packet-file> <result-file>');
    console.error('   or: validate.mjs <receipt|complete> <receipt-json>');
    console.error('   or: validate.mjs hash <artifact-file>');
    process.exitCode = 2;
    return;
  }
  const text = await readFile(firstPath, 'utf8');
  if (mode === 'hash') {
    console.log(`${sha256Text(text)}  ${firstPath}`);
    return;
  }
  const result = mode === 'pair' ? await readFile(secondPath, 'utf8') : undefined;
  let parsedReceipt;
  if (['receipt', 'complete'].includes(mode)) {
    const parsed = safeParseReceipt(text);
    if (!parsed.ok) {
      console.error(`ERROR: receipt is not valid JSON: ${parsed.error}`);
      process.exitCode = 1;
      return;
    }
    parsedReceipt = parsed.receipt;
  }
  const errors = mode === 'packet'
    ? validatePacket(text)
    : mode === 'result'
      ? validateResult(text)
      : mode === 'pair'
        ? validatePair(text, result)
        : mode === 'receipt'
          ? validateReceipt(parsedReceipt)
          : receiptCompletionErrors(parsedReceipt);
  if (mode === 'complete') {
    errors.push(...await verifyReceiptArtifacts(parsedReceipt, process.cwd()));
  }
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  const suffix = mode === 'packet'
    ? ` (~${estimateTokens(text)} tokens)`
    : mode === 'receipt' && receiptCompletionErrors(parsedReceipt).length
      ? ' (incomplete)'
      : '';
  console.log(`OK: valid ${mode}${suffix}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
