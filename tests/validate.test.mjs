import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estimateTokens,
  receiptCompletionErrors,
  sha256Text,
  validatePacket,
  validatePair,
  validateReceipt,
  validateResult,
} from '../skills/reasoning-bridge/scripts/validate.mjs';

const validPacket = [
  'BEGIN_CONTEXT_PACKET',
  'packet_id: packet-20260905-a1',
  'requested_reasoner: gpt-5.2',
  '',
  '## Objective',
  'Diagnose the intermittent build failure.',
  '',
  '## Acceptance',
  '- Build passes twice in a row.',
  '',
  '## Repository State',
  '- branch main, clean.',
  '',
  '## Evidence',
  '- build.js:compile fails after cache warm.',
  '',
  '## Constraints',
  '- Node 20 required.',
  '',
  '## Questions',
  '1. Which cache layer is corrupt?',
  'END_CONTEXT_PACKET',
].join('\n');

const validResult = [
  'BEGIN_REASONING_RESULT',
  'packet_id: packet-20260905-a1',
  '',
  '## Verdict',
  'The content cache is corrupt.',
  '',
  '## Assumptions',
  '- Cache warm means the second build.',
  '',
  '## Evidence Used',
  '- build.js:compile fails after cache warm.',
  '',
  '## Proposed Changes',
  '- build.js:compile clear cache before rebuild.',
  '',
  '## Tests',
  '- Run build twice.',
  '',
  '## Risks',
  '- Slow first build.',
  '',
  '## Unknowns',
  '- Cache size.',
  'END_REASONING_RESULT',
].join('\n');

function receipt(overrides = {}) {
  return {
    schema_version: 2,
    packet_id: 'packet-20260905-a1',
    target: 'chatgpt',
    artifacts: {
      packet: { path: 'packet.md', sha256: 'a'.repeat(64), approximate_tokens: 120 },
      result: { path: 'result.md', sha256: 'b'.repeat(64) },
      browser_evidence: { path: 'evidence.md', sha256: 'c'.repeat(64) },
    },
    local_model: { requested: 'deepseek-chat', observed: 'deepseek-chat', status: 'verified', evidence: 'session model label' },
    web_model: {
      requested: 'gpt-5.2',
      observed: 'GPT-5.2',
      status: 'verified',
      evidence: 'visible selector label',
      preflight_visible: true,
      postflight_visible: true,
    },
    privacy_review: {
      scope_minimized: true,
      credentials_scan_passed: true,
      semantic_privacy_reviewed: true,
      raw_diff_excluded: true,
      unrelated_files_excluded: true,
    },
    browser_transport: 'verified',
    packet_validation: 'passed',
    result_validation: 'passed',
    pair_validation: 'passed',
    local_revalidation: 'passed',
    adoption: { status: 'passed', accepted: [], rejected: [], deferred: [], local_evidence: [] },
    local_changes: { status: 'no_changes_needed', reason: 'proposal only clarified diagnosis' },
    tests: 'passed',
    ...overrides,
  };
}

test('valid packet passes', () => {
  assert.deepEqual(validatePacket(validPacket), []);
});

test('valid packet reports token estimate within bound', () => {
  const tokens = estimateTokens(validPacket);
  assert.ok(tokens > 0 && tokens <= 3000);
  assert.ok(estimateTokens('确定' + 'x'.repeat(10)) >= 2);
});

test('packet with content outside markers fails', () => {
  assert.ok(validatePacket(`preamble\n${validPacket}`).some((e) => e.includes('outside')));
});

test('packet with duplicated section fails', () => {
  const duplicated = validPacket.replace('## Constraints\n- Node 20 required.', '## Constraints\n- Node 20 required.\n\n## Evidence\n- again');
  assert.ok(validatePacket(duplicated).some((e) => e.includes('exactly once')));
});

test('packet with out-of-order sections fails', () => {
  const swapped = validPacket
    .replace('## Evidence\n- build.js:compile fails after cache warm.', '## PLACEHOLDER')
    .replace('## Constraints', '## Evidence')
    .replace('## PLACEHOLDER', '## Constraints');
  assert.ok(validatePacket(swapped).some((e) => e.includes('out of order')));
});

test('packet with secret is rejected', () => {
  const withSecret = validPacket.replace('- build.js:compile fails after cache warm.', 'api_key: sk-abcdefghijklmnopqrstuvwx');
  assert.ok(validatePacket(withSecret).some((e) => e.includes('likely secret')));
});

test('packet over 3000 tokens is rejected', () => {
  const big = validPacket.replace('- build.js:compile fails after cache warm.', '- ' + 'word '.repeat(4000));
  assert.ok(validatePacket(big).some((e) => e.includes('3000')));
});

test('packet_id and requested_reasoner must appear exactly once', () => {
  const twiceId = validPacket.replace('requested_reasoner: gpt-5.2', 'packet_id: packet-x\nrequested_reasoner: gpt-5.2');
  assert.ok(validatePacket(twiceId).some((e) => e.includes('packet_id')));
  const noReasoner = validPacket.replace('requested_reasoner: gpt-5.2\n', '');
  assert.ok(validatePacket(noReasoner).some((e) => e.includes('requested_reasoner')));
});

test('valid result passes; wrong packet_id fails the pair', () => {
  assert.deepEqual(validateResult(validResult), []);
  const otherId = validResult.replace('packet_id: packet-20260905-a1', 'packet_id: packet-other');
  assert.ok(validatePair(validPacket, otherId).some((e) => e.includes('mismatch')));
  assert.deepEqual(validatePair(validPacket, validResult), []);
});

test('receipt structure validation', () => {
  assert.deepEqual(validateReceipt(receipt()), []);
  assert.ok(validateReceipt(receipt({ schema_version: 1 })).includes('schema_version must be 2'));
  assert.ok(validateReceipt(receipt({ target: 'claude' })).some((e) => e.includes('target')));
  const badPrivacy = receipt();
  badPrivacy.privacy_review.scope_minimized = 'yes';
  assert.ok(validateReceipt(badPrivacy).some((e) => e.includes('privacy_review.scope_minimized')));
  const badStatus = receipt();
  badStatus.browser_transport = 'maybe';
  assert.ok(validateReceipt(badStatus).some((e) => e.includes('browser_transport')));
});

test('completion gate requires everything passed and verified', () => {
  assert.deepEqual(receiptCompletionErrors(receipt()), []);
  const incomplete = receipt({ tests: 'not_run' });
  assert.ok(receiptCompletionErrors(incomplete).includes('tests is not passed'));
  const unverified = receipt();
  unverified.web_model.status = 'unverified';
  assert.ok(receiptCompletionErrors(unverified).includes('web_model is not verified'));
});

test('sha256Text is stable hex', () => {
  assert.equal(sha256Text('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
