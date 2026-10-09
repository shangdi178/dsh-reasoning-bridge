import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFetchExpression, buildProbeExpression, buildSendExpression, SITE } from '../skills/reasoning-bridge/scripts/lib/page-chatgpt.mjs';
import * as arenaPage from '../skills/reasoning-bridge/scripts/lib/page-arena.mjs';
import { main } from '../skills/reasoning-bridge/scripts/transport.mjs';
import { TARGET_IDS } from '../skills/reasoning-bridge/scripts/targets-table.mjs';

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const needsWebSocket = nodeMajor < 22 ? 'transport driver needs Node >= 22 (native WebSocket)' : false;
const STRIPE_FIXTURE = ['sk_', 'live_', '51H8xQ2abcdefghijklmnopqrst'].join('');

// --- expression builders -----------------------------------------------------

test('all page expressions compile as a single async IIFE', () => {
  for (const expression of [
    buildProbeExpression(),
    buildSendExpression({ text: 'demo packet text' }),
    buildFetchExpression(),
  ]) {
    assert.doesNotThrow(() => new Function(`return ${expression}`));
  }
});

test('send expression embeds the request text verbatim', () => {
  const tricky = 'a "quoted" `backtick` \\slash\ttab\nline\r\nCRLF 中文 ✅ </script>';
  const expression = buildSendExpression({ text: tricky });
  const embedded = JSON.parse(expression.match(/^  const __rb = (.+);$/m)[1]);
  assert.equal(embedded.text, tricky);
});

test('expressions never touch cookies, storage, or the network', () => {
  const forbidden = /(document\s*\.cookie|localStorage|sessionStorage|indexedDB|\bfetch\s*\()/i;
  for (const expression of [
    buildProbeExpression(),
    buildSendExpression({ text: 'x' }),
    buildFetchExpression(),
  ]) {
    assert.equal(forbidden.test(expression), false, 'forbidden API in page expression');
  }
});

test('expressions report uncertainty with why codes instead of throwing', () => {
  assert.ok(buildSendExpression({ text: 'x' }).includes('composer-not-found'));
  assert.ok(buildSendExpression({ text: 'x' }).includes('send-uncertain'));
  assert.ok(buildFetchExpression().includes('assistant-message-not-found'));
  assert.ok(buildFetchExpression().includes('reply-not-extracted'));
});

test('probe expression exposes login and composer state', () => {
  const expression = buildProbeExpression();
  assert.ok(expression.includes('#prompt-textarea'));
  assert.ok(expression.includes('login-button'));
  assert.ok(expression.includes('logged_out'));
  assert.ok(expression.includes('model_label'));
  assert.equal(SITE, 'https://chatgpt.com/');
});

// --- arena page module -------------------------------------------------------

test('arena expressions compile as single async IIFEs', () => {
  for (const expression of [
    arenaPage.buildProbeExpression(),
    arenaPage.buildComposerFocusExpression(),
    arenaPage.buildSendAfterInsertExpression({ text: 'demo packet text' }),
    arenaPage.buildFetchExpression(),
  ]) {
    assert.doesNotThrow(() => new Function(`return ${expression}`));
  }
});

test('arena target uses the textarea input path, not a paste event', () => {
  // Live-verified: arena.ai's composer is a React-controlled <textarea>, so the
  // driver must insert text through the browser input pipeline.
  assert.equal(arenaPage.INPUT_MODE, 'insert-text');
  assert.equal(arenaPage.SITE, 'https://arena.ai/');
  const focus = arenaPage.buildComposerFocusExpression();
  assert.ok(focus.includes('textarea[name=\\"message\\"]'));
  assert.ok(focus.includes('focused'));
  const send = arenaPage.buildSendAfterInsertExpression({ text: 'x' });
  assert.ok(send.includes('Send message'));
  assert.ok(send.includes('insert-not-reflected'));
  assert.ok(send.includes('arena\\.ai\\/c\\/'));
});

test('arena expressions never touch cookies, storage, or the network', () => {
  const forbidden = /(document\s*\.cookie|localStorage|sessionStorage|indexedDB|\bfetch\s*\()/i;
  for (const expression of [
    arenaPage.buildProbeExpression(),
    arenaPage.buildComposerFocusExpression(),
    arenaPage.buildSendAfterInsertExpression({ text: 'x' }),
    arenaPage.buildFetchExpression(),
  ]) {
    assert.equal(forbidden.test(expression), false, 'forbidden API in arena page expression');
  }
});

test('arena reports battle-mode model identity as unverifiable', () => {
  const probe = arenaPage.buildProbeExpression();
  assert.ok(probe.includes('model_verifiable'));
  assert.ok(probe.includes('recaptcha_present'));
  assert.ok(probe.includes('mode_label'));
  const fetch = arenaPage.buildFetchExpression();
  assert.ok(fetch.includes('labelledAnswers'));
  assert.ok(fetch.includes('助手 A'));
  assert.ok(fetch.includes('reply-not-extracted'));
});

test('arena send expression embeds the request text verbatim', () => {
  const tricky = 'a "quoted" `backtick` \\slash\ttab\nline\r\nCRLF 中文 ✅ </script>';
  const expression = arenaPage.buildSendAfterInsertExpression({ text: tricky });
  const embedded = JSON.parse(expression.match(/^  const __rb = (.+);$/m)[1]);
  assert.equal(embedded.text, tricky);
});

// --- CLI ---------------------------------------------------------------------

test('usage errors exit with code 2', async () => {
  assert.equal(await main([]), 2);
  assert.equal(await main(['bogus']), 2);
  assert.equal(await main(['send']), 2);
  assert.equal(await main(['fetch']), 2);
});

test('status degrades gracefully when the debug Chrome is down', async () => {
  const closedPort = 10000 + Math.floor(Math.random() * 20000);
  const code = await main(['status', '--json', '--port', String(closedPort)]);
  assert.equal(code, 0); // a status answer is a success even when running:false
});

test('targets table is the single shared source', () => {
  assert.deepEqual([...TARGET_IDS], ['chatgpt', 'arena']);
});

test('probe fails with cdp-no-page when nothing is listening', { skip: needsWebSocket }, async () => {
  const closedPort = 10000 + Math.floor(Math.random() * 20000);
  const code = await main(['probe', '--site', 'https://chatgpt.com/', '--port', String(closedPort)]);
  assert.equal(code, 1);
});

test('fetch rejects non-https urls with a usage error', async () => {
  const code = await main(['fetch', '--url', 'http://insecure.example.com/', '--out', 'reply.txt']);
  assert.equal(code, 2);
});
