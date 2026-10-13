#!/usr/bin/env node

// Deterministic handoff validator for dsh-reasoning-bridge.
// Modes: packet|result <file> · pair <packet> <result> · receipt|complete <json> · hash <file>
// Zero dependencies. Exit 0 = valid, 1 = errors, 2 = usage.

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_IDS } from './targets-table.mjs';
import { STATES, validateTranscript } from './lib/handoff-state.mjs';

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
 * they catch well-known shapes and `key: value` assignments whose value actually
 * looks like key material. They cannot understand business secrets: a clean scan
 * means "no known shape matched", never "safe to send". The semantic privacy
 * review in SKILL.md stays mandatory, and `send` refuses to run until this scan
 * is clean.
 *
 * Design note (learned the hard way): an early version matched *any* non-space
 * right-hand side, which made ordinary packets fail — `const token = getToken();`,
 * `password: the label shown in the form`, `api_key=YOUR_KEY_HERE`,
 * `Authorization: <your-token-here>`. A gate that blocks legitimate runs is worse
 * than the misses it closes, because it teaches operators to pass the override.
 * So the generic rules now require the value to LOOK like key material:
 *   - at least 12 characters of a credential-ish alphabet, and
 *   - enough character diversity (not a single word), and
 *   - not a placeholder / substitution / prose phrase.
 */

/**
 * A value that plausibly IS key material: long enough, mixed enough, and not a
 * single dictionary-ish word. Deliberately conservative — the cost of a false
 * negative is the semantic review, the cost of a false positive is a dead gate.
 */
const SECRET_VALUE = String.raw`(?![^\s]*(?:\.\.\.|…))(?=[^\s]*[A-Za-z])(?=[^\s]*[0-9A-Za-z_\-+/=]{12,})[^\s]{12,}`;

/**
 * Values that are obviously NOT secrets: replacement placeholders, env-var
 * substitutions, redaction markers, descriptions, and code expressions.
 * Checked against the captured value rather than embedded as lookahead soup so
 * the rules stay readable and testable.
 */
const PLACEHOLDER_VALUE = /^(?:<(?:[^>]*)>|\[(?:REDACTED|redacted|…|\.\.\.)\]|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\{\{?[^}]*\}?\}|x{4,}|\*{4,}|\.{3,}|…|YOUR[_-].*|MY[_-].*|CHANGE[_-]?ME|changeme|example|placeholder|dummy|sample|test|none|null|nil|undefined|true|false|n\/a|<not set>)$/i;

/**
 * A value that is a code expression rather than a literal secret: a function
 * call (`getToken()`), an awaited call (`await loadApiKey()`), or a dotted member
 * reference (`config.auth.token`). Deliberately does NOT match a bare identifier
 * — `hunter2hunter2` and `correcthorsebatterystaple` are bare words that are
 * exactly the passphrases this filter must still catch.
 */
const CODE_EXPRESSION = /^(?:await\s+)?[A-Za-z_$][A-Za-z0-9_$]*(?:\([^)]*\)|(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+\(?[^)]*\)?)[;,]?$/;

/**
 * True when a captured right-hand side looks like an actual secret value.
 *
 * `passphraseLike` relaxes the character-diversity requirement for assignments
 * whose *name* is explicitly a password/passphrase: `DB_PASS=correcthorsebattery`
 * is a real secret that no amount of entropy checking will recognize, so the name
 * has to carry the signal there. Everything else must look like key material.
 */
function looksLikeSecretValue(value, { passphraseLike = false } = {}) {
  const raw = String(value ?? '').trim().replace(/^["'`]|["'`,;]+$/g, '');
  if (raw.length < 12) return false;
  if (PLACEHOLDER_VALUE.test(raw)) return false;
  if (CODE_EXPRESSION.test(raw)) return false; // `getToken()` / `await loadApiKey()`
  // Prose: several space-separated words with no credential-ish punctuation.
  if (/^[a-z]+(?:[ -][a-z]+){1,6}[.;]?$/.test(raw)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(raw)).length;
  if (passphraseLike) return classes >= 1; // a long word is a plausible passphrase
  // Otherwise require either mixed character classes or a long random-looking run,
  // which keeps bare prose words out while still catching high-entropy strings.
  if (classes >= 2) return true;
  return /[0-9]/.test(raw) || raw.length >= 24;
}

/** Credential-assignment rules, matched on shape then filtered by value.
 *  Group 1 = the credential NAME (decides the passphrase relaxation),
 *  group 2 = the candidate VALUE. */
const ASSIGNMENT_PATTERNS = [
  // `api_key: <value>` / `DB_PASS=<value>` / `client_secret = <value>`.
  /\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|app[_-]?secret|signing[_-]?key|encryption[_-]?key|password|passwd|passphrase|pwd|secret|token|credential)s?\s*[:=]\s*["']?([^\s"']{12,})/gi,
  // .env-style SCREAMING_CASE whose name ends in a secret noun (covers DB_PASS=,
  // which has no lowercase `password`/`passwd`/`pwd` in it).
  /^\s*([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASS(?:WORD|WD|PHRASE)?|CREDENTIAL|AUTH)S?)\s*=\s*["']?([^\s"']{12,})/gm,
];

/** Names that carry a password/passphrase, where a bare long word is a secret. */
const PASSPHRASE_NAME = /pass(?:word|wd|phrase)?|pwd/i;

const SECRET_PATTERNS = [
  // Private key blocks (including PGP / OpenSSH / PKCS#8 variants).
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/i,
  // AWS access key id, and the standalone 40-char secret access key.
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/,
  /\baws_secret_access_key\s*[:=]\s*(?!\[REDACTED\])\S{16,}/i,
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
  // Twilio-style account SID + auth token.
  /\bSK[0-9a-fA-F]{32}\b/,
  // Google / Azure / generic cloud keys.
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bAccountKey\s*=\s*(?!\[REDACTED\])[A-Za-z0-9+/=]{20,}/i,
  /\b(?:LTAI|AKID)[A-Za-z0-9]{12,}\b/,
  // JWTs (three base64url segments) — caught even when embedded in a header.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  // Connection strings that embed a password (skip documentation placeholders).
  /\b[a-z][a-z0-9+.-]{2,}:\/\/[^\s:@/]+:(?!password\b|passwd\b|pass\b|\*{3,}|<[^>]*>|\.\.\.)[^\s:@/]{3,}@/i,
  /https:\/\/hooks\.slack\.com\/services\/\S+/i,
  /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\S+/i,
];

/**
 * Header-shaped rules. `Authorization`/`Cookie` are extremely common in code
 * samples and API docs, so these also require a credential-looking value rather
 * than any non-space run — otherwise `Authorization: <your-token-here>` blocks a
 * perfectly legitimate packet.
 */
const HEADER_PATTERNS = [
  /\bAuthorization\s*:\s*(?:Bearer\s+|Basic\s+|Token\s+)?["']?(?!\[REDACTED\])([^\s"']{12,})/gi,
  /\b(?:Cookie|Set-Cookie)\s*:\s*["']?(?!\[REDACTED\])([^\s"']{12,})/gi,
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
 *
 * Two passes: fixed well-known token shapes, then credential assignments whose
 * right-hand side actually looks like key material (see `looksLikeSecretValue`).
 */
export function scanForSecrets(text) {
  const haystack = typeof text === 'string' ? text : '';
  const hits = [];
  SECRET_PATTERNS.forEach((pattern, index) => {
    // Fresh lastIndex per call: these carry /g or are reused across invocations.
    pattern.lastIndex = 0;
    if (pattern.test(haystack)) hits.push(`secret-pattern-${index + 1}`);
  });
  const assignmentHit = ASSIGNMENT_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    for (const match of haystack.matchAll(pattern)) {
      if (looksLikeSecretValue(match[2], { passphraseLike: PASSPHRASE_NAME.test(match[1] ?? '') })) return true;
    }
    return false;
  });
  if (assignmentHit) hits.push('credential-assignment');
  const headerHit = HEADER_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    for (const match of haystack.matchAll(pattern)) {
      const value = String(match[1] ?? '');
      // `Cookie: session=abc123` is as likely a code sample as a live session, so
      // headers additionally require a high-entropy-looking value. Real session
      // cookies are long opaque strings; `abc123` is not.
      if (looksLikeSecretValue(value) && /[A-Za-z0-9+/=_-]{16,}/.test(value) && !/^[a-z]+=[a-z0-9]{1,12}$/i.test(value)) {
        return true;
      }
    }
    return false;
  });
  if (headerHit) hits.push('credential-header');
  return hits;
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
  if (receipt.handoff !== undefined) {
    if (!Array.isArray(receipt.handoff)) {
      errors.push('handoff must be an array of transcript entries');
    } else if (!receipt.handoff.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && STATES.includes(entry.state))) {
      errors.push('handoff entries must be objects with a known state');
    }
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
  // The transport state machine is part of the completion claim: a run that never
  // reached RESULT_VALIDATED — or that entered UNCERTAIN — cannot claim complete,
  // no matter what the other fields say.
  if (receipt.handoff !== undefined) {
    const transcriptErrors = validateTranscript(receipt.handoff, { packetId: receipt.packet_id }).errors;
    for (const error of transcriptErrors) errors.push(`handoff: ${error}`);
  }
  for (const field of PRIVACY_FIELDS) {
    if (!receipt.privacy_review[field]) errors.push(`privacy_review.${field} is not passed`);
  }
  for (const field of ['packet_validation', 'result_validation', 'pair_validation', 'local_revalidation', 'tests']) {
    if (receipt[field] !== 'passed') errors.push(`${field} is not passed`);
  }
  if (receipt.adoption.status !== 'passed') errors.push('adoption is not passed');
  // The gate must not accept a bare `status: "passed"`. Checks, in order of what
  // they actually buy you:
  //   - at least one proposal classified (a run that decided nothing is not a run)
  //   - at least one local anchor recorded (evidence exists at all)
  //   - every ACCEPTED item carries its own anchor (evidence is per-proposal, not
  //     one global string satisfying the whole record). A bare string is a
  //     proposal with no evidence attached, so the object form is required.
  // What this still cannot do: verify the anchor is real, that the file/symbol
  // exists, or that the agent actually opened it. A determined author can write
  // plausible strings. The record proves intent to comply, not compliance.
  const anchor = (item) => (Array.isArray(item?.local_evidence)
    ? item.local_evidence.some((entry) => String(entry ?? '').trim())
    : typeof item?.local_evidence === 'string' ? item.local_evidence.trim() : '');
  const classified = receipt.adoption.accepted.length
    + receipt.adoption.rejected.length
    + receipt.adoption.deferred.length;
  if (!classified) {
    errors.push('adoption must classify at least one proposal (accepted, rejected or deferred)');
  }
  if (!receipt.adoption.local_evidence.some((item) => String(item ?? '').trim())) {
    errors.push('adoption.local_evidence must record at least one locally reopened anchor');
  }
  receipt.adoption.accepted.forEach((item, index) => {
    if (!anchor(item)) {
      errors.push(`adoption.accepted[${index}] must carry its own local_evidence anchor`);
    }
  });
  if (!['applied', 'no_changes_needed'].includes(receipt.local_changes.status)) {
    errors.push('local_changes is not complete');
  }
  return errors;
}

export async function verifyReceiptArtifacts(receipt, baseDirectory) {
  const errors = [];
  // Artifact paths are attacker-controlled data (a malicious web reply or a
  // tampered receipt). Contain them inside baseDirectory: resolve each path and
  // refuse anything that escapes, plus symlink/device-loop paranoia via lstat.
  const base = resolve(baseDirectory ?? process.cwd());
  for (const field of ['packet', 'result', 'browser_evidence']) {
    const artifact = receipt.artifacts?.[field];
    if (!artifact?.path || !artifact?.sha256) continue;
    const resolved = resolve(base, artifact.path);
    if (resolved !== base && !resolved.startsWith(base + sep)) {
      errors.push(`${field} artifact path escapes the run directory: ${artifact.path}`);
      continue;
    }

    try {
      const info = await lstat(resolved);
      if (!info.isFile()) {
        errors.push(`${field} artifact is not a regular file: ${artifact.path}`);
        continue;
      }
      const content = await readFile(resolved, 'utf8');
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
