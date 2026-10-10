import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildFetchExpression, buildProbeExpression, buildSendExpression, SITE } from '../skills/reasoning-bridge/scripts/lib/page-chatgpt.mjs';
import * as arenaPage from '../skills/reasoning-bridge/scripts/lib/page-arena.mjs';
import { writeConsentDecision } from '../skills/reasoning-bridge/scripts/consent.mjs';
import { main } from '../skills/reasoning-bridge/scripts/transport.mjs';
import { TARGET_IDS } from '../skills/reasoning-bridge/scripts/targets-table.mjs';

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const needsWebSocket = nodeMajor < 22 ? 'transport driver needs Node >= 22 (native WebSocket)' : false;
const STRIPE_FIXTURE = ['sk_', 'live_', '51H8xQ2abcdefghijklmnopqrst'].join('');

// --- expression builders -----------------------------------------------------

// The page layer is the only place where driver code runs inside a site we do
// not control, so the "no credentials, no network, no hidden channels" rule is
// checked over every expression we generate. The pattern deliberately covers
// the bypasses a naive document.cookie/localStorage check would miss.
const FORBIDDEN_PAGE_APIS = new RegExp([
  'document\\s*\\.\\s*cookie',
  'cookieStore',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  '\\bcaches\\b',
  'navigator\\s*\\.\\s*credentials',
  'XMLHttpRequest',
  'sendBeacon',
  '\\bfetch\\s*\\(',
  'new\\s+WebSocket',
  'new\\s+EventSource',
  'import\\s*\\(',
  'new\\s+Image',
  'location\\s*(?:\\.href)?\\s*=[^=]',
  'document\\s*\\.\\s*createElement\\s*\\(\\s*[\'"]form',
].join('|'), 'i');

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
  for (const expression of [
    buildProbeExpression(),
    buildSendExpression({ text: 'x' }),
    buildFetchExpression(),
  ]) {
    const match = expression.match(FORBIDDEN_PAGE_APIS);
    assert.equal(match, null, `forbidden API in page expression: ${match?.[0]}`);
  }
});

test('the forbidden-API guard actually rejects each bypass it claims to cover', () => {
  // Guard the guard: if the pattern silently stops matching, this fails first.
  for (const snippet of [
    'document.cookie', 'cookieStore.getAll()', 'localStorage.x', 'sessionStorage.x',
    'indexedDB.open("x")', 'caches.keys()', 'navigator.credentials.get()',
    'new XMLHttpRequest()', 'navigator.sendBeacon("/x")', 'fetch("/x")',
    'new WebSocket("ws://x")', 'new EventSource("/x")', 'await import("/x")',
    'new Image().src="x"', 'location.href="https://evil"',
  ]) {
    assert.ok(FORBIDDEN_PAGE_APIS.test(snippet), `guard should reject: ${snippet}`);
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
  for (const expression of [
    arenaPage.buildProbeExpression(),
    arenaPage.buildComposerFocusExpression(),
    arenaPage.buildSendAfterInsertExpression({ text: 'x' }),
    arenaPage.buildFetchExpression(),
  ]) {
    const match = expression.match(FORBIDDEN_PAGE_APIS);
    assert.equal(match, null, `forbidden API in arena page expression: ${match?.[0]}`);
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

test('every advertised target has a page module, and no page module is unadvertised', async () => {
  // The drift the docs warn about: a target in the shared table (so the settings
  // enum, the panel picker and the receipt validator all accept it) with no page
  // module to drive it — or a module nobody can select. Both directions fail CI.
  const dir = new URL('../skills/reasoning-bridge/scripts/lib/', import.meta.url);
  const modules = (await readdir(dir))
    .filter((name) => name.startsWith('page-') && name.endsWith('.mjs'))
    .map((name) => name.slice('page-'.length, -'.mjs'.length))
    .sort();
  assert.deepEqual(modules, [...TARGET_IDS].sort(),
    'targets-table.mjs and scripts/lib/page-<id>.mjs must list the same targets');

  // Each module must export the phase builders the driver dispatches to. The
  // send phase has two input modes, so a module declares one of them:
  //   'paste-event' -> buildSendExpression (one page round trip)
  //   'insert-text' -> buildComposerFocusExpression + buildSendAfterInsertExpression
  for (const id of modules) {
    const page = await import(new URL(`page-${id}.mjs`, dir).href);
    assert.equal(typeof page.buildProbeExpression, 'function', `page-${id}.mjs must export buildProbeExpression()`);
    assert.equal(typeof page.buildFetchExpression, 'function', `page-${id}.mjs must export buildFetchExpression()`);
    assert.ok(['paste-event', 'insert-text'].includes(page.INPUT_MODE), `page-${id}.mjs must declare an INPUT_MODE`);
    if (page.INPUT_MODE === 'insert-text') {
      for (const exportName of ['buildComposerFocusExpression', 'buildSendAfterInsertExpression']) {
        assert.equal(typeof page[exportName], 'function', `page-${id}.mjs must export ${exportName}()`);
      }
    } else {
      assert.equal(typeof page.buildSendExpression, 'function', `page-${id}.mjs must export buildSendExpression()`);
    }
  }
});

test('the driver rejects a target that has no page module instead of misrouting', async () => {
  // `--site` with an unknown origin must not fall back to a working target.
  const closedPort = 10000 + Math.floor(Math.random() * 20000);
  const code = await main(['probe', '--site', 'https://example.com/', '--port', String(closedPort)]);
  assert.notEqual(code, 0, 'an unknown site must not be silently routed');
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

// --- pre-send gates ----------------------------------------------------------

test('every browser-driving subcommand respects the consent gate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-gates-'));
  const previous = process.env.DSH_REASONING_BRIDGE_HOME;
  process.env.DSH_REASONING_BRIDGE_HOME = dir;
  try {
    const file = join(dir, 'request.txt');
    await writeFile(file, 'BEGIN_CONTEXT_PACKET\npacket_id: p\nEND_CONTEXT_PACKET\n', 'utf8');
    const out = join(dir, 'reply.txt');
    // A closed port keeps these from touching a real browser even if a gate leaks.
    const closedPort = 10000 + Math.floor(Math.random() * 20000);
    // open/probe/send/fetch/launch all reach the site or start a browser for it.
    assert.equal(await main(['send', '--file', file, '--json', '--port', String(closedPort)]), 1);
    assert.equal(await main(['probe', '--json', '--port', String(closedPort)]), 1);
    assert.equal(await main(['open', '--json', '--port', String(closedPort)]), 1);
    assert.equal(await main(['fetch', '--url', 'https://chatgpt.com/c/x', '--out', out, '--json']), 1);
    assert.equal(await main(['launch', '--json', '--port', String(closedPort)]), 1);
    // status is a read-only port probe and must stay usable for diagnosis.
    assert.equal(await main(['status', '--json', '--port', String(closedPort)]), 0);
  } finally {
    if (previous === undefined) delete process.env.DSH_REASONING_BRIDGE_HOME;
    else process.env.DSH_REASONING_BRIDGE_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unsupported --site is refused instead of borrowing another target module', async () => {
  // Regression: resolveTarget fell back to the chatgpt page module for any URL,
  // so `--site https://example.com/` navigated an arbitrary site while reporting
  // target "chatgpt" — driving a page whose selectors were never written for it.
  const dir = await mkdtemp(join(tmpdir(), 'bridge-site-'));
  const previous = process.env.DSH_REASONING_BRIDGE_HOME;
  process.env.DSH_REASONING_BRIDGE_HOME = dir;
  try {
    // Consent is READY, so the only thing under test is the site resolution.
    await writeConsentDecision(join(dir, 'consent.json'), true);
    const closedPort = 10000 + Math.floor(Math.random() * 20000);
    assert.equal(await main(['open', '--json', '--site', 'https://example.com/', '--port', String(closedPort)]), 2);
    // A site that belongs to another target may not be paired with --target.
    assert.equal(await main(['open', '--json', '--site', 'https://chatgpt.com/', '--target', 'arena', '--port', String(closedPort)]), 2);
  } finally {
    if (previous === undefined) delete process.env.DSH_REASONING_BRIDGE_HOME;
    else process.env.DSH_REASONING_BRIDGE_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a UTF-16 request file cannot smuggle a secret past the scan', async () => {
  // Reading a UTF-16 file as UTF-8 yields interleaved NULs, so the patterns never
  // match while the composer still receives the secret as mojibake. The driver now
  // decodes the file properly before scanning.
  const dir = await mkdtemp(join(tmpdir(), 'bridge-u16-'));
  const previous = process.env.DSH_REASONING_BRIDGE_HOME;
  process.env.DSH_REASONING_BRIDGE_HOME = dir;
  try {
    await writeConsentDecision(join(dir, 'consent.json'), true);
    const text = `BEGIN_CONTEXT_PACKET\npacket_id: p\n- ${STRIPE_FIXTURE}\nEND_CONTEXT_PACKET\n`;
    const file = join(dir, 'request.txt');
    await writeFile(file, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]));
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      assert.equal(await main(['send', '--file', file, '--json']), 1);
    } finally {
      console.error = originalError;
    }
    assert.ok(logged.some((line) => line.includes('credential scan')), logged.join('\n'));
  } finally {
    if (previous === undefined) delete process.env.DSH_REASONING_BRIDGE_HOME;
    else process.env.DSH_REASONING_BRIDGE_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('send refuses a request file that trips the credential scan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-scan-'));
  const previous = process.env.DSH_REASONING_BRIDGE_HOME;
  process.env.DSH_REASONING_BRIDGE_HOME = dir;
  try {
    // Grant consent so the only remaining gate is the credential scan.
    await writeConsentDecision(join(dir, 'consent.json'), true);
    const file = join(dir, 'request.txt');
    await writeFile(file, `BEGIN_CONTEXT_PACKET\npacket_id: p\n- ${STRIPE_FIXTURE}\nEND_CONTEXT_PACKET\n`, 'utf8');
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      assert.equal(await main(['send', '--file', file, '--json']), 1);
    } finally {
      console.error = originalError;
    }
    assert.ok(logged.some((line) => line.includes('consent') || line.includes('credential scan')), logged.join('\n'));
  } finally {
    if (previous === undefined) delete process.env.DSH_REASONING_BRIDGE_HOME;
    else process.env.DSH_REASONING_BRIDGE_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
