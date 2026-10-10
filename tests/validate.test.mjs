import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estimateTokens,
  receiptCompletionErrors,
  safeParseReceipt,
  scanForSecrets,
  sha256Text,
  validatePacket,
  validatePair,
  validateReceipt,
  validateResult,
} from '../skills/reasoning-bridge/scripts/validate.mjs';

const parts = (...pieces) => pieces.join('');
const FIXTURES = {
  awsKeyId: parts('AKIA', 'IOSFODNN7EXAMPLE'),
  stripe: parts('sk_', 'live_', '51H8xQ2abcdefghijklmnopqrst'),
  google: parts('AIza', 'SyA1234567890abcdefghijklmnopqrstuv'),
  npm: parts('npm_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
  twilio: parts('SK', '0123456789abcdef0123456789abcdef'),
  openai: parts('sk-', 'abcdefghijklmnopqrstuvwx'),
  jwt: parts('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxIn0', '.', 'abcdefghijklmnop'),
  connString: parts('postgres://admin:', 'hunter2', '@db.internal:5432/prod'),
};
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
    adoption: {
      status: 'passed',
      accepted: [{ id: 'A1', proposal: 'build.js:clear cache before rebuild', local_evidence: 'reopened build.js:compile, cache warm path confirmed' }],
      rejected: [],
      deferred: [],
      local_evidence: ['reopened build.js:compile, cache warm path confirmed'],
    },
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
  const withSecret = validPacket.replace('- build.js:compile fails after cache warm.', `api_key: ${FIXTURES.openai}`);
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

test('completion gate refuses a self-attested empty adoption record', () => {
  // The gate used to accept `adoption.status: "passed"` with four empty arrays,
  // which made `complete` pure self-attestation.
  const noEvidence = receipt();
  noEvidence.adoption.local_evidence = [];
  assert.ok(receiptCompletionErrors(noEvidence).some((e) => e.includes('local_evidence')));

  const noProposals = receipt();
  noProposals.adoption.accepted = [];
  assert.ok(receiptCompletionErrors(noProposals).some((e) => e.includes('classify at least one proposal')));
});

test('completion gate requires per-proposal evidence, not one string for the record', () => {
  // A single global `local_evidence` string used to satisfy the whole record.
  const whitespace = receipt();
  whitespace.adoption.local_evidence = ['   '];
  assert.ok(receiptCompletionErrors(whitespace).some((e) => e.includes('local_evidence')));

  // An accepted item with no anchor of its own is refused...
  const bare = receipt();
  bare.adoption.accepted = ['fix the cache'];
  assert.ok(receiptCompletionErrors(bare).some((e) => e.includes('accepted[0]')));

  // ...but the documented object form carries its anchor and passes.
  const documented = receipt();
  documented.adoption.accepted = [{ id: 'A1', local_evidence: 'reopened build.js:compile' }];
  assert.deepEqual(receiptCompletionErrors(documented), []);
});

test('secret scanner catches the credential shapes the receipt gate must refuse', () => {
  const caught = [
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    FIXTURES.awsKeyId,
    `DATABASE_URL=${FIXTURES.connString}`,
    `Authorization: Bearer ${FIXTURES.jwt}`,
    `STRIPE_KEY=${FIXTURES.stripe}`,
    'https://hooks.slack.com/services/T000/B000/abcd',
    FIXTURES.google,
    FIXTURES.npm,
    FIXTURES.twilio,
    // .env shapes, including the DB_PASS form the first regex pass missed.
    'DB_PASS=correcthorsebatterystaple',
    'SECRET_KEY=8f14e45fceea167a5a36dedd4bea2543',
    // A passphrase is a bare word: the name has to carry the signal.
    'password: hunter2hunter2',
    `api_key: ${FIXTURES.openai}`,
    'Cookie: session=eyJhbGciOiJIUzI1NiJ9YWJjZGVmZ2hpamts',
  ];
  for (const sample of caught) {
    assert.ok(scanForSecrets(sample).length > 0, `scanner missed: ${sample}`);
  }
});

test('secret scanner does not block ordinary engineering prose and code samples', () => {
  // A gate that fires on legitimate packets is worse than the misses it closes:
  // it teaches operators to reach for --allow-unscanned, which defeats the point.
  // Every one of these regressed the gate in an earlier revision.
  const legitimate = [
    'const token = getToken();',
    'const apiKey = await loadApiKey();',
    'password: the label shown in the form',
    'The password reset flow may regress.',
    'Review the session token refresh logic.',
    'passwords must be at least 12 characters',
    'token budget is 3000 tokens.',
    'api_key=YOUR_KEY_HERE',
    'api_key: <not set>',
    'Authorization: <your-token-here>',
    'Set the Authorization header from the session.',
    'PASSWORD: changeme',
    'access_token: [REDACTED]',
    'reads process.env.API_KEY',
    'Cookie: session=abc123',
    'https://user:password@example.com/',
    'token: opaque-handle-returned-by-server',
    '## Evidence\n- build.js:compile fails after cache warm.',
  ];
  for (const sample of legitimate) {
    assert.deepEqual(scanForSecrets(sample), [], `scanner false-positived on: ${sample}`);
  }
});

test('sha256Text is stable hex', () => {
  assert.equal(sha256Text('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('receipt parsing reports invalid JSON instead of crashing', () => {
  const bad = safeParseReceipt('{ schema_version: 2, oops');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /JSON/);
  assert.equal(safeParseReceipt('null').ok, true);
  const good = safeParseReceipt('{"schema_version":2}');
  assert.equal(good.ok, true);
  assert.deepEqual(good.receipt, { schema_version: 2 });
});
