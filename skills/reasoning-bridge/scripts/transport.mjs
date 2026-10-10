#!/usr/bin/env node

// Transport driver for dsh-reasoning-bridge: attaches to the local CDP debug
// Chrome (default :9222 — the instance dsh's browser tools or `launch` started)
// and drives the configured target site with bounded, user-equivalent actions.
// Zero dependencies; the page connection uses the native WebSocket global
// (Node >= 22). Exit 0 = ok, 1 = transport failure ({ok:false, why}), 2 = usage.
// Stdout carries exactly one JSON result; diagnostics go to stderr.
// Disciplines: one send attempt, no retries on uncertainty, no cookies or
// storage access, no private endpoints, visible windows only (never headless).
//
// Two gates are enforced HERE, in code, before any browser action:
//   1. consent  — the versioned risk decision must be READY (consent.json).
//   2. scan     — the outbound request file must be free of credential shapes.
// Everything else in the skill (adoption gate, semantic privacy review) is a
// discipline the agent follows; see README "Enforced vs. discipline".

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertWebSocket,
  CdpError,
  CdpSession,
  attachForSite,
  defaultPort,
  listPageTargets,
  newPageTarget,
  probeEndpoint,
} from './lib/cdp.mjs';
import * as pageChatgpt from './lib/page-chatgpt.mjs';
import * as arenaPage from './lib/page-arena.mjs';
import { readSettings } from './lib/settings-bridge.mjs';
import { consentStatus, defaultConsentPath } from './consent.mjs';
import { readState } from './target.mjs';
import { modelsFor, siteFor, TARGETS } from './targets-table.mjs';
import { scanForSecrets } from './validate.mjs';

/**
 * Target id -> page module. Each module owns its selectors, its phases, and
 * its INPUT_MODE (how text reaches the composer); this driver only orchestrates.
 */
const PAGES = {
  chatgpt: pageChatgpt,
  arena: arenaPage,
};

const usage = () => [
  'usage: transport.mjs status [--json] [--port N]',
  '   or: transport.mjs launch [--json] [--port N] [--browser <path>] [--profile <dir>]',
  '   or: transport.mjs open [--json] [--target <id> | --site <url>] [--port N]',
  '   or: transport.mjs probe [--json] [--target <id> | --site <url>] [--port N] [--settle-ms N]',
  '   or: transport.mjs send --file <request.txt> [--json] [--target <id> | --site <url>] [--port N]',
  '           [--composer-wait-ms N] [--send-wait-ms N] [--url-wait-ms N] [--allow-unscanned]',
  '   or: transport.mjs fetch --url <conversation-url> --out <reply.txt> [--json] [--port N]',
  '           [--screenshot <png>] [--appear-timeout-ms N] [--stream-timeout-ms N] [--stability-ms N]',
].join('\n');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Node-runtime gate. The driver needs the native WebSocket global (Node >= 22);
 * `reasoning-bridge.checkNodeRuntime` in the settings document turns that
 * requirement into an opt-out for experiments. The setting is read here so it
 * actually governs something instead of sitting inert in the panel.
 */
async function assertRuntime() {
  const { checkNodeRuntime } = await readSettings();
  if (checkNodeRuntime === false) return;
  assertWebSocket();
}

/**
 * Consent gate. The versioned risk decision is the plugin's only authorization
 * surface, so the driver enforces it instead of leaving it to prose: no browser
 * action toward the target while the decision is missing, stale, or disabled.
 * Returns null when READY, else the blocking status.
 */
async function consentBlock(environment = process.env) {
  const status = await consentStatus(defaultConsentPath(environment));
  return status.status === 'READY' ? null : status.status;
}

/**
 * Sanitization gate for the outbound request file. The packet contract forbids
 * credentials, and a pattern scan is the only mechanical part of that promise —
 * so `send` refuses to transmit a request that trips it. Deliberate override:
 * an explicit `--allow-unscanned` (the caller then owns the risk).
 */
function scanBlock(text) {
  const hits = scanForSecrets(text);
  return hits.length ? hits : null;
}

function pluginHome(environment = process.env) {
  const home = environment.DSH_REASONING_BRIDGE_HOME?.trim() || join(homedir(), '.dsh', 'dsh-reasoning-bridge');
  return home;
}

function integerFlag(value, name) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CdpError(`${name} expects a positive integer, got ${JSON.stringify(value)}`, 'usage');
  }
  return parsed;
}

function parseArgs(argv, { flags = [], values = [] } = {}) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      out.json = true;
    } else if (values.includes(token)) {
      const value = argv[index + 1];
      if (value === undefined) throw new CdpError(`${token} expects a value`, 'usage');
      out[token.replace(/^--/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      index += 1;
    } else if (flags.includes(token)) {
      // Boolean flags get the same camelCase treatment as value flags, so
      // `--allow-unscanned` is readable as options.allowUnscanned.
      out[token.replace(/^--/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = true;
    } else {
      throw new CdpError(`unknown argument: ${token}`, 'usage');
    }
  }
  return out;
}

/** Resolve the active target: explicit --site/--target wins, else state.json. */
async function resolveTarget(options = {}) {
  if (options.site) {
    const known = TARGETS.find((entry) => entry.site === options.site);
    const targetId = options.target ?? known?.id ?? 'chatgpt';
    const page = PAGES[targetId];
    if (!page) {
      throw new CdpError(`no page module for target "${targetId}"; known targets: ${Object.keys(PAGES).join(', ')}`, 'usage');
    }
    return { targetId, site: options.site, page, models: modelsFor(targetId) };
  }
  const targetId = options.target ?? (await readState()).target;
  const site = siteFor(targetId);
  const page = PAGES[targetId];
  if (!site || !page) {
    throw new CdpError(`target "${targetId}" has no site URL or page module; known targets: ${Object.keys(PAGES).join(', ')}`, 'usage');
  }
  return { targetId, site, page, models: modelsFor(targetId) };
}

/** The page module that owns a conversation URL (by origin), else null. */
function pageForUrl(href) {
  let origin;
  try {
    origin = new URL(href).origin;
  } catch {
    return null;
  }
  const known = TARGETS.find((entry) => {
    try {
      return new URL(entry.site).origin === origin;
    } catch {
      return false;
    }
  });
  return known && PAGES[known.id] ? { targetId: known.id, page: PAGES[known.id], models: modelsFor(known.id) } : null;
}

function findBrowser() {
  if (process.platform === 'win32') {
    const roots = [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    const candidates = [];
    for (const root of roots) {
      candidates.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
    return candidates.find((path) => existsSync(path)) ?? null;
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    return candidates.find((path) => existsSync(path)) ?? null;
  }
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    for (const directory of directories) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function cmdStatus(args) {
  const port = integerFlag(args.port ?? defaultPort(), '--port');
  const probe = await probeEndpoint(port);
  return { ok: true, ...probe };
}

async function cmdLaunch(args) {
  const port = integerFlag(args.port ?? defaultPort(), '--port');
  const probe = await probeEndpoint(port);
  if (probe.running) {
    return { ok: true, running: true, already_running: true, port };
  }
  const browser = args.browser ?? findBrowser();
  if (!browser) {
    throw new CdpError('no Chrome/Edge executable found; pass --browser <path>', 'browser-not-found');
  }
  // A dedicated profile, never the user's everyday one: Chrome refuses the
  // default user-data-dir with a debug port, and copying login-state files
  // (the macOS-only trick dsh-browser-control uses) would touch credential
  // files, which this plugin's discipline forbids. First-run login happens
  // once, manually, inside this visible window.
  const profile = args.profile ?? join(pluginHome(), 'chrome-profile');
  await mkdir(profile, { recursive: true });
  const child = spawn(
    browser,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  const deadline = Date.now() + 30000;
  for (;;) {
    const check = await probeEndpoint(port, 1500);
    if (check.running) {
      return { ok: true, running: true, already_running: false, port, browser, profile };
    }
    if (Date.now() >= deadline) {
      throw new CdpError(`debug Chrome did not come up on :${port} within 30s (browser: ${browser})`, 'launch-timeout');
    }
    await sleep(500);
  }
}

/**
 * Open (or focus) the target site in the debug Chrome so the user can complete
 * a human step in a visible window — logging in, solving a CAPTCHA, picking a
 * model. It performs no site action beyond navigation.
 */
async function cmdOpen(args) {
  const consent = await consentBlock();
  if (consent !== null) {
    throw new CdpError(`browser automation consent is not READY (${consent})`, 'consent-not-ready');
  }
  await assertRuntime();
  const port = integerFlag(args.port ?? defaultPort(), '--port');
  const { site, targetId, models } = await resolveTarget(args);
  const { session, created } = await attachForSite(site, { port });
  try {
    await session.bringToFront();
    return { ok: true, site, target: targetId, model_identity: models, created_tab: created, hint: 'human step: sign in / clear any challenge in the visible window, then run probe' };
  } finally {
    session.close();
  }
}

async function cmdProbe(args) {
  const consent = await consentBlock();
  if (consent !== null) {
    throw new CdpError(`browser automation consent is not READY (${consent})`, 'consent-not-ready');
  }
  await assertRuntime();
  const port = integerFlag(args.port ?? defaultPort(), '--port');
  const { site, page, targetId, models } = await resolveTarget(args);
  const settleMs = args.settleMs ? integerFlag(args.settleMs, '--settle-ms') : undefined;
  const { session } = await attachForSite(site, { port });
  try {
    await session.bringToFront();
    const result = await session.evaluate(page.buildProbeExpression(settleMs ? { settleMs } : {}), { timeoutMs: 60000 });
    return { ...result, site, target: targetId, model_identity: models };
  } finally {
    session.close();
  }
}

async function cmdSend(args) {
  if (!args.file) throw new CdpError('send requires --file <request.txt>', 'usage');
  const consent = await consentBlock();
  if (consent !== null) {
    throw new CdpError(
      `browser automation consent is not READY (${consent}); decide it in the chat with the exact risk acknowledgement first`,
      'consent-not-ready',
    );
  }
  await assertRuntime();
  const port = integerFlag(args.port ?? defaultPort(), '--port');
  const { site, page, targetId, models } = await resolveTarget(args);
  const requestText = (await readFile(args.file, 'utf8')).replace(/\r\n?/g, '\n').trim();
  if (!requestText) throw new CdpError(`request file is empty: ${args.file}`, 'usage');
  if (!args.allowUnscanned) {
    const hits = scanBlock(requestText);
    if (hits !== null) {
      throw new CdpError(
        `request file tripped the credential scan (${hits.join(', ')}); redact it in the packet, `
        + 're-validate with `validate.mjs packet`, and retry. Pass --allow-unscanned only if you have '
        + 'reviewed the file yourself and accept sending it.',
        'secret-scan-failed',
      );
    }
  }
  const composerWaitMs = args.composerWaitMs ? integerFlag(args.composerWaitMs, '--composer-wait-ms') : undefined;
  const sendWaitMs = args.sendWaitMs ? integerFlag(args.sendWaitMs, '--send-wait-ms') : undefined;
  const urlWaitMs = args.urlWaitMs ? integerFlag(args.urlWaitMs, '--url-wait-ms') : undefined;
  const composerWait = composerWaitMs ?? 12000;
  const sendWait = sendWaitMs ?? 4000;
  const urlWait = urlWaitMs ?? 15000;
  // A fresh tab per send: never paste into a conversation the user left open,
  // and always start from the new-chat composer.
  const target = await newPageTarget(port, 'about:blank');
  const session = await CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    await session.navigate(site, { settleMs: 1500 });
    await session.bringToFront();
    if (page.INPUT_MODE === 'insert-text') {
      // Textarea composers: focus the control, let the driver insert text
      // through the browser input pipeline, then verify + send in the page.
      const focus = await session.evaluate(
        page.buildComposerFocusExpression({ composerWaitMs: composerWait }),
        { timeoutMs: composerWait + 15000 },
      );
      if (!focus?.ok) return { ...focus, site, target: targetId, model_identity: models };
      await session.insertText(requestText);
      const result = await session.evaluate(
        page.buildSendAfterInsertExpression({ text: requestText, sendWaitMs: sendWait, urlWaitMs: urlWait }),
        { timeoutMs: sendWait + urlWait + 30000 },
      );
      return { ...result, site, target: targetId, model_identity: models, input_mode: 'insert-text' };
    }
    const result = await session.evaluate(
      page.buildSendExpression({ text: requestText, composerWaitMs: composerWait, sendWaitMs: sendWait, urlWaitMs: urlWait }),
      { timeoutMs: composerWait + sendWait + urlWait + 30000 },
    );
    return { ...result, site, target: targetId, model_identity: models, input_mode: page.INPUT_MODE };
  } finally {
    session.close();
  }
}

async function cmdFetch(args) {
  if (!args.url || !args.out) throw new CdpError('fetch requires --url <conversation-url> and --out <reply.txt>', 'usage');
  // Validate arguments (exit 2, a usage error) before the consent gate (exit 1),
  // so a malformed invocation is still diagnosed as malformed.
  let fetchUrl;
  try {
    fetchUrl = new URL(args.url);
    if (fetchUrl.protocol !== 'https:') throw new Error('https only');
  } catch {
    throw new CdpError(`--url must be an https conversation URL, got ${JSON.stringify(args.url)}`, 'usage');
  }
  // fetch drives a page and writes untrusted content to disk, so it respects the
  // same consent gate as the other browser actions.
  const consent = await consentBlock();
  if (consent !== null) {
    throw new CdpError(`browser automation consent is not READY (${consent})`, 'consent-not-ready');
  }
  await assertRuntime();
  const port = integerFlag(args.port ?? defaultPort(), '--port');
  const appearTimeoutMs = args.appearTimeoutMs ? integerFlag(args.appearTimeoutMs, '--appear-timeout-ms') : undefined;
  const streamTimeoutMs = args.streamTimeoutMs ? integerFlag(args.streamTimeoutMs, '--stream-timeout-ms') : undefined;
  const stabilityMs = args.stabilityMs ? integerFlag(args.stabilityMs, '--stability-ms') : undefined;
  const appearTimeout = appearTimeoutMs ?? 30000;
  const streamTimeout = streamTimeoutMs ?? 150000;
  const stability = stabilityMs ?? 2500;
  const routed = pageForUrl(fetchUrl.href) ?? await resolveTarget(args);
  const { page: pageModule } = routed;
  const { session } = await attachForSite(fetchUrl.href, { port });
  try {
    const current = await session.evaluate('location.href', { timeoutMs: 15000 });
    if (current !== fetchUrl.href) {
      await session.navigate(fetchUrl.href, { settleMs: 1500 });
    }
    await session.bringToFront();
    const clipboardGranted = await session.grantClipboard(fetchUrl.origin);
    const result = await session.evaluate(
      pageModule.buildFetchExpression({ appearTimeoutMs: appearTimeout, streamTimeoutMs: streamTimeout, stabilityMs: stability }),
      { timeoutMs: appearTimeout + streamTimeout + 30000 },
    );
    const out = {
      ok: result.ok,
      extraction: result.extraction ?? null,
      why_codes: result.why_codes ?? [],
      url: fetchUrl.href,
      target: routed.targetId ?? null,
      model_identity: routed.models ?? null,
      clipboard_granted: clipboardGranted,
    };
    if (result.mode_label) out.mode_label = result.mode_label;
    if (Array.isArray(result.answers) && result.answers.length) out.answers = result.answers.map((answer) => answer.label);
    if (result.ok) {
      const text = result.text.endsWith('\n') ? result.text : `${result.text}\n`;
      await writeFile(args.out, text, 'utf8');
      out.out = args.out;
      out.length = text.length;
      out.bytes = Buffer.byteLength(text, 'utf8');
    } else {
      out.why = result.why;
      if (result.detail) out.detail = result.detail;
    }
    if (args.screenshot) {
      out.screenshot = await session.screenshot(args.screenshot);
    }
    return out;
  } finally {
    session.close();
  }
}

const COMMANDS = { status: cmdStatus, launch: cmdLaunch, open: cmdOpen, probe: cmdProbe, send: cmdSend, fetch: cmdFetch };

const VALUE_FLAGS = ['--port', '--browser', '--profile', '--target', '--site', '--settle-ms', '--file', '--url', '--out', '--screenshot', '--composer-wait-ms', '--send-wait-ms', '--url-wait-ms', '--appear-timeout-ms', '--stream-timeout-ms', '--stability-ms'];
const BOOLEAN_FLAGS = ['--json', '--allow-unscanned'];

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    console.error(usage());
    return 2;
  }
  const runner = COMMANDS[command];
  if (!runner) {
    console.error(usage());
    return 2;
  }
  try {
    const args = parseArgs(rest, { flags: BOOLEAN_FLAGS, values: VALUE_FLAGS });
    const result = await runner(args);
    console.log(JSON.stringify(result, null, 2));
    return command === 'status' || (result && result.ok !== false) ? 0 : 1;
  } catch (error) {
    const why = error instanceof CdpError ? error.why : 'unexpected-error';
    console.error(`[transport] ${error.message}`);
    console.log(JSON.stringify({ ok: false, why, detail: error.message }, null, 2));
    return why === 'usage' ? 2 : 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
