// Minimal CDP (Chrome DevTools Protocol) client for dsh-reasoning-bridge.
// Attaches to the local debug Chrome (default :9222) that dsh's browser tools
// or `transport.mjs launch` started, and evaluates page expressions with
// awaitPromise so page-side async phases (composer wait, stream settle,
// clipboard read) actually resolve — dsh-browser-control's drive.mjs
// re-navigates on every eval and drops async results, which is why this
// driver exists. Zero dependencies: uses the native WebSocket global
// (Node >= 22). It only talks to the local debug instance; it never touches
// site cookies, storage, credentials, or private endpoints.

import { writeFile } from 'node:fs/promises';

export class CdpError extends Error {
  constructor(message, why = 'cdp-error') {
    super(message);
    this.name = 'CdpError';
    this.why = why;
  }
}

export function assertWebSocket() {
  if (typeof WebSocket === 'undefined') {
    throw new CdpError(
      `native WebSocket is unavailable on ${process.version}; the transport driver needs Node >= 22`,
      'node-too-old',
    );
  }
}

export function defaultPort(environment = process.env) {
  const raw = Number.parseInt(environment.CDP_PORT ?? '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 9222;
}

async function fetchJson(url, options = {}, timeoutMs = 3000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), ...options });
  if (!response.ok) {
    throw new CdpError(`CDP HTTP endpoint ${url} returned ${response.status}`, 'cdp-endpoint-error');
  }
  return await response.json();
}

/** Probe the debug instance. Never throws: returns { running, port, version? }. */
export async function probeEndpoint(port = defaultPort(), timeoutMs = 3000) {
  try {
    const version = await fetchJson(`http://localhost:${port}/json/version`, {}, timeoutMs);
    return { running: true, port, version };
  } catch {
    return { running: false, port };
  }
}

/** List open page targets. Never throws: returns [] when the instance is down. */
export async function listPageTargets(port = defaultPort()) {
  try {
    const list = await fetchJson(`http://localhost:${port}/json/list`);
    return Array.isArray(list) ? list.filter((entry) => entry.type === 'page') : [];
  } catch {
    return [];
  }
}

/** Create a new page tab (Chrome >= 111 requires PUT for /json/new). */
export async function newPageTarget(port = defaultPort(), url = 'about:blank') {
  const target = await fetchJson(`http://localhost:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }, 5000);
  if (!target?.webSocketDebuggerUrl) {
    throw new CdpError('could not create a new debug tab', 'cdp-new-tab-failed');
  }
  return target;
}

export function sameOrigin(urlA, urlB) {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

/**
 * Pick a page target for a site: prefer a tab already on that site's origin
 * (do not hijack unrelated tabs), else the first page tab, else null.
 */
export function pickPageTarget(targets, siteUrl) {
  return targets.find((target) => sameOrigin(target.url, siteUrl)) ?? targets[0] ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CdpSession {
  constructor(ws) {
    this.#ws = ws;
    this.#nextId = 0;
    this.#pending = new Map();
    this.#waiters = [];
    ws.addEventListener('message', (event) => this.#onMessage(event.data));
    ws.addEventListener('close', () => this.#failAll(new CdpError('CDP session closed', 'cdp-session-closed')));
    ws.addEventListener('error', () => {});
  }

  static async connect(wsUrl, { timeoutMs = 10000 } = {}) {
    assertWebSocket();
    const ws = new WebSocket(wsUrl);
    const opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CdpError(`timed out connecting to ${wsUrl}`, 'cdp-connect-timeout')), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new CdpError(`cannot connect to ${wsUrl}`, 'cdp-connect-failed')); }, { once: true });
    });
    await opened;
    return new CdpSession(ws);
  }

  #ws;
  #nextId;
  #pending;
  #waiters;

  #onMessage(data) {
    let message;
    try {
      message = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return;
    }
    if (message.id !== undefined && this.#pending.has(message.id)) {
      const { resolve, reject } = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) reject(new CdpError(`${message.error.message}`, 'cdp-protocol-error'));
      else resolve(message.result);
      return;
    }
    if (message.method) {
      this.#waiters = this.#waiters.filter((waiter) => {
        if (waiter.method !== message.method) return true;
        waiter.resolve(message.params);
        return false;
      });
    }
  }

  #failAll(error) {
    for (const { reject } of this.#pending.values()) reject(error);
    this.#pending.clear();
    for (const waiter of this.#waiters) waiter.reject(error);
    this.#waiters = [];
  }

  send(method, params = {}, { timeoutMs = 30000 } = {}) {
    if (this.#ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new CdpError('CDP session is not open', 'cdp-session-closed'));
    }
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError(`CDP ${method} timed out after ${timeoutMs}ms`, 'cdp-timeout'));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolve on the next occurrence of a CDP event method, bounded by timeoutMs. */
  waitEvent(method, { timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((waiter) => waiter !== entry);
        reject(new CdpError(`timed out waiting for ${method}`, 'cdp-timeout'));
      }, timeoutMs);
      const entry = {
        method,
        resolve: (params) => { clearTimeout(timer); resolve(params); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      this.#waiters.push(entry);
    });
  }

  async navigate(url, { loadTimeoutMs = 20000, settleMs = 1500 } = {}) {
    await this.send('Page.enable');
    const loaded = this.waitEvent('Page.loadEventFired', { timeoutMs: loadTimeoutMs });
    await this.send('Page.navigate', { url });
    await loaded;
    if (settleMs > 0) await sleep(settleMs);
  }

  /**
   * Evaluate an expression in the page, awaiting its promise and returning the
   * plain JSON value (falling back to the runtime description for non-JSON).
   * Retries once or twice on "execution context destroyed" races with an
   * in-flight navigation.
   */
  async evaluate(expression, { timeoutMs = 120000 } = {}) {
    await this.send('Runtime.enable');
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.send(
          'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true },
          { timeoutMs },
        );
        if (result.exceptionDetails) {
          const detail = result.exceptionDetails;
          const text = detail.exception?.description ?? detail.text ?? 'unknown page exception';
          throw new CdpError(`page exception: ${text}`, 'page-exception');
        }
        return result.result.value !== undefined ? result.result.value : result.result.description;
      } catch (error) {
        lastError = error;
        const message = error?.message ?? '';
        const destroyed = /execution context was destroyed|cannot find context|target closed/i.test(message);
        if (!destroyed || attempt === 2) throw error;
        await sleep(1000);
      }
    }
    throw lastError;
  }

  async bringToFront() {
    try {
      await this.send('Page.bringToFront');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Insert text through the browser's own input pipeline, as if the user typed
   * it, into whatever element currently has focus. This is what a
   * React-controlled <textarea> composer needs: a synthetic paste event does
   * not update its value (the app owns the value), while Input.insertText goes
   * through the real input path and fires the events the app listens for.
   */
  async insertText(text, { timeoutMs = 15000 } = {}) {
    if (typeof text !== 'string' || text === '') {
      throw new CdpError('insertText requires a non-empty string', 'usage');
    }
    await this.send('Input.insertText', { text }, { timeoutMs });
  }

  /**
   * Grant clipboard permissions so the site's own copy affordance can be read
   * back. Best-effort: on failure callers fall back to visible DOM extraction.
   */
  async grantClipboard(origin) {
    for (const params of [{ permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin }, { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }]) {
      try {
        await this.send('Browser.grantPermissions', params);
        return true;
      } catch { /* try the next form */ }
    }
    return false;
  }

  async screenshot(outPath) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(outPath, Buffer.from(shot.data, 'base64'));
    return outPath;
  }

  close() {
    try {
      this.#ws.close();
    } catch { /* already closed */ }
    this.#failAll(new CdpError('CDP session closed by client', 'cdp-session-closed'));
  }
}

/**
 * Attach a session for a site: reuse a tab on the site's origin (navigate only
 * when it is somewhere else), otherwise create a dedicated tab. A freshly
 * created tab is navigated by this session (never by /json/new?url=), so the
 * load event is guaranteed to arrive after we are connected and listening.
 */
export async function attachForSite(siteUrl, { port = defaultPort(), settleMs = 1500 } = {}) {
  const targets = await listPageTargets(port);
  if (!targets.length) {
    throw new CdpError('no page target on the debug Chrome; run `transport.mjs status` or `launch` first', 'cdp-no-page');
  }
  let target = targets.find((entry) => sameOrigin(entry.url, siteUrl));
  let created = false;
  if (!target) {
    target = await newPageTarget(port);
    created = true;
  }
  const session = await CdpSession.connect(target.webSocketDebuggerUrl);
  if (created || !sameOrigin(target.url, siteUrl)) {
    await session.navigate(siteUrl, { settleMs });
  }
  return { session, target, created };
}
