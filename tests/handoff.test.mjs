import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  HANDOFF_SCHEMA_VERSION,
  STATES,
  isLegalTransition,
  safeParseTranscript,
  validateEntry,
  validateTranscript,
} from '../skills/reasoning-bridge/scripts/lib/handoff-state.mjs';
import { main } from '../skills/reasoning-bridge/scripts/transport.mjs';
import { receiptCompletionErrors } from '../skills/reasoning-bridge/scripts/validate.mjs';

const RESULT_VALIDATED = (packetId) => ([
  { state: 'PRECHECKED', site: 'https://chatgpt.com/' },
  { state: 'COMPOSER_VERIFIED', site: 'https://chatgpt.com/' },
  { state: 'SEND_INTENT', confirmed_by: 'user in chat' },
  { state: 'SUBMITTED', evidence: 'user turn visible; conversation /c/abc' },
  { state: 'RESULT_OBSERVED', evidence: 'newest assistant turn read', bound_by: 'packet_id echo', packetId: packetId, packet_id: packetId },
  { state: 'RESULT_VALIDATED', validator: 'validate.mjs result+pair', packet_id: packetId },
]);

test('the machine declares the documented states and terminal UNCERTAIN', () => {
  assert.deepEqual(STATES, [
    'PRECHECKED', 'COMPOSER_VERIFIED', 'SEND_INTENT', 'SUBMITTED',
    'RESULT_OBSERVED', 'RESULT_VALIDATED', 'UNCERTAIN',
  ]);
  assert.equal(isLegalTransition('SUBMITTED', 'RESULT_OBSERVED'), true);
  assert.equal(isLegalTransition('SUBMITTED', 'UNCERTAIN'), true);
  assert.equal(isLegalTransition('UNCERTAIN', 'RESULT_OBSERVED'), false, 'UNCERTAIN is terminal');
  assert.equal(isLegalTransition('RESULT_VALIDATED', 'SUBMITTED'), false, 'no backwards moves');
  assert.equal(isLegalTransition('PRECHECKED', 'SEND_INTENT'), false, 'no skipping the composer check');
  assert.equal(HANDOFF_SCHEMA_VERSION, 1);
});

test('entries require their evidence fields', () => {
  assert.ok(validateEntry({ state: 'SEND_INTENT' }).some((e) => e.includes('confirmed_by')),
    'SEND_INTENT without a confirmer is refused');
  assert.ok(validateEntry({ state: 'SUBMITTED' }).some((e) => e.includes('evidence')),
    'SUBMITTED without evidence is refused');
  assert.deepEqual(validateEntry({ state: 'UNCERTAIN' }), [], 'UNCERTAIN carries no required evidence');
  assert.ok(validateEntry({ state: 'BOGUS' }).some((e) => e.includes('unknown state')));
  assert.ok(validateEntry({ state: 'SUBMITTED', evidence: 'x', at: 'not-a-date' }).some((e) => e.includes('at')));
});

test('transcripts: happy path validates, uncertainty and skipping are refused', () => {
  const happy = validateTranscript(RESULT_VALIDATED('rb-1'), { packetId: 'rb-1' });
  assert.deepEqual(happy.errors, []);
  assert.equal(happy.finalState, 'RESULT_VALIDATED');

  const uncertain = validateTranscript([
    { state: 'PRECHECKED', site: 's' },
    { state: 'COMPOSER_VERIFIED', site: 's' },
    { state: 'SEND_INTENT', confirmed_by: 'u' },
    { state: 'UNCERTAIN' },
  ]);
  assert.equal(uncertain.ok, false);
  assert.ok(uncertain.errors.some((e) => e.includes('UNCERTAIN')));

  const skipped = validateTranscript([
    { state: 'PRECHECKED', site: 's' },
    { state: 'SEND_INTENT', confirmed_by: 'u' },
    { state: 'SUBMITTED', evidence: 'e' },
  ]);
  assert.equal(skipped.ok, false);
  assert.ok(skipped.errors.some((e) => e.includes('PRECHECKED -> SEND_INTENT')));

  const empty = validateTranscript([]);
  assert.equal(empty.ok, false);
});

test('RESULT states must bind the run packet_id, not a detached marker', () => {
  const wrong = validateTranscript(RESULT_VALIDATED('other-id'), { packetId: 'rb-1' });
  assert.equal(wrong.ok, false);
  assert.ok(wrong.errors.some((e) => e.includes('must bind')));
  // Without a packetId expectation the shape check still runs, binding is not judged.
  const unjudged = validateTranscript(RESULT_VALIDATED('rb-1'));
  assert.deepEqual(unjudged.errors, []);
});

test('handoff subcommand: usage, valid and invalid transcripts', async () => {
  assert.equal(await main(['handoff']), 2);
  const dir = await mkdtemp(join(tmpdir(), 'bridge-handoff-'));
  try {
    const good = join(dir, 'good.json');
    await writeFile(good, JSON.stringify(RESULT_VALIDATED('rb-1')), 'utf8');
    assert.equal(await main(['handoff', good, '--packet-id', 'rb-1']), 0);

    const bad = join(dir, 'bad.json');
    await writeFile(bad, JSON.stringify([{ state: 'PRECHECKED', site: 's' }, { state: 'UNCERTAIN' }]), 'utf8');
    assert.equal(await main(['handoff', bad]), 1);

    const junk = join(dir, 'junk.json');
    await writeFile(junk, 'not json', 'utf8');
    assert.equal(await main(['handoff', junk]), 1);
    assert.deepEqual(safeParseTranscript('{').ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- complete gate x handoff --------------------------------------------------

function receipt() {
  return {
    schema_version: 2,
    packet_id: 'rb-1',
    target: 'chatgpt',
    artifacts: {
      packet: { path: 'packet.md', sha256: 'a'.repeat(64), approximate_tokens: 40 },
      result: { path: 'result.md', sha256: 'b'.repeat(64) },
      browser_evidence: { path: 'evidence.md', sha256: 'c'.repeat(64) },
    },
    local_model: { requested: 'm', observed: 'm', status: 'verified', evidence: 'e' },
    web_model: { requested: 'g', observed: 'g', status: 'verified', evidence: 'e', preflight_visible: true, postflight_visible: true },
    privacy_review: { scope_minimized: true, credentials_scan_passed: true, semantic_privacy_reviewed: true, raw_diff_excluded: true, unrelated_files_excluded: true },
    browser_transport: 'verified',
    packet_validation: 'passed',
    result_validation: 'passed',
    pair_validation: 'passed',
    local_revalidation: 'passed',
    adoption: { status: 'passed', accepted: [{ id: 'A1', local_evidence: 'reopened build.js:compile' }], rejected: [], deferred: [], local_evidence: ['reopened build.js:compile'] },
    local_changes: { status: 'applied', reason: 'r' },
    tests: 'passed',
  };
}

test('complete gate: legacy receipts without handoff stay valid', () => {
  assert.deepEqual(receiptCompletionErrors(receipt()), []);
});

test('complete gate refuses a transcript that ended in UNCERTAIN', () => {
  const r = receipt();
  r.handoff = [
    { state: 'PRECHECKED', site: 's' },
    { state: 'COMPOSER_VERIFIED', site: 's' },
    { state: 'SEND_INTENT', confirmed_by: 'u' },
    { state: 'UNCERTAIN' },
  ];
  const errors = receiptCompletionErrors(r);
  assert.ok(errors.some((e) => e.includes('handoff') && e.includes('UNCERTAIN')),
    'an unconfirmed submit can never be marked complete');
});

test('complete gate refuses a transcript whose result is not bound to this run', () => {
  const r = receipt();
  r.handoff = RESULT_VALIDATED('some-other-id');
  const errors = receiptCompletionErrors(r);
  assert.ok(errors.some((e) => e.includes('must bind')), errors.join('\n'));

  const bound = receipt();
  bound.handoff = RESULT_VALIDATED('rb-1');
  assert.equal(receiptCompletionErrors(bound).filter((e) => e.includes('handoff')).length, 0);
});

test('complete gate refuses a malformed handoff field', () => {
  const r = receipt();
  r.handoff = 'PRECHECKED then done';
  assert.ok(receiptCompletionErrors(r).some((e) => e.includes('handoff must be an array')));

  const r2 = receipt();
  r2.handoff = [{ state: 'NOT_A_STATE' }];
  assert.ok(receiptCompletionErrors(r2).some((e) => e.includes('known state')));
});
