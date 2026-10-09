// Page-phase expression builders for the chatgpt target (https://chatgpt.com/).
// Each builder returns one self-contained async IIFE string that transport.mjs
// evaluates inside the page via CDP (awaitPromise: true). Selectors are
// multi-candidate on purpose: the first match wins, every miss maps to a `why`
// code so selector drift surfaces as data instead of a stuck workflow.
//
// Discipline (enforced by tests): the expressions only read public page state
// and use user-equivalent actions (paste, one send click, the site's own copy
// affordance). They never touch cookies, web storage, IndexedDB, or the
// network; the clipboard is read only after the site's own copy button was
// clicked and the driver granted the permission.

export const SITE = 'https://chatgpt.com/';

const SELECTOR_SETS = {
  composer: ['#prompt-textarea', 'form div[contenteditable="true"]', 'div[contenteditable="true"]'],
  send: ['[data-testid="send-button"]', 'form button[type="submit"]', 'button[aria-label*="Send" i]', 'button[aria-label*="发送"]'],
  userTurn: ['[data-message-author-role="user"]'],
  assistant: ['[data-message-author-role="assistant"]', 'div[data-message-id]'],
  copy: ['button[data-testid="copy-turn-action-button"]', 'button[aria-label*="Copy" i]', 'button[aria-label*="复制"]'],
  stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop" i]', 'button[aria-label*="停止"]'],
  loggedOut: ['[data-testid="login-button"]', 'a[href*="auth/login"]'],
  modelLabel: ['[data-testid="model-switcher-label"]', 'button[data-testid="model-switcher-dropdown"]', 'button[aria-label*="Model" i]'],
};

const HELPERS = `
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fail = (why, extra = {}) => ({ ok: false, why, ...extra });
  const firstMatch = (selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  };
  const lastMatch = (selectors) => {
    for (const selector of selectors) {
      const all = document.querySelectorAll(selector);
      if (all.length) return all[all.length - 1];
    }
    return null;
  };
  const waitFor = async (selectors, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const element = firstMatch(selectors);
      if (element) return element;
      if (Date.now() >= deadline) return null;
      await sleep(400);
    }
  };
`;

// Wrap args + body into one expression. The args line is a stable anchor the
// tests use to verify that arguments survive the embedding verbatim. Helpers
// are declared OUTSIDE the try so the catch block can still report a page
// exception through `fail` (declaring them inside turns any error into
// "fail is not defined", hiding the real cause).
function payload(args, body) {
  return `(async () => {\n  const __rb = ${JSON.stringify(args)};\n  ${HELPERS}\n  try {\n${body}\n  } catch (error) {\n    return fail('page-exception', { detail: String(error && error.message ? error.message : error) });\n  }\n})()`;
}

/** Read-only preflight: login state, composer presence, best-effort model label. */
export function buildProbeExpression({ settleMs = 8000 } = {}) {
  return payload(
    { S: SELECTOR_SETS, settleMs },
    `
  const deadline = Date.now() + __rb.settleMs;
  let composer = null;
  let loggedOut = null;
  while (Date.now() < deadline) {
    composer = firstMatch(__rb.S.composer);
    loggedOut = firstMatch(__rb.S.loggedOut);
    if (composer || loggedOut) break;
    await sleep(400);
  }
  const modelElement = lastMatch(__rb.S.modelLabel);
  const modelLabel = modelElement ? (modelElement.textContent || '').trim().slice(0, 80) || null : null;
  return {
    ok: true,
    url: location.href,
    title: document.title,
    logged_out: Boolean(loggedOut),
    composer_found: Boolean(composer),
    model_label: modelLabel,
  };`,
  );
}

/**
 * One-shot send: wait for the composer, paste the request (user-equivalent
 * ClipboardEvent), verify it landed, click the visible send control exactly
 * once, then wait for the user turn / conversation URL. No retries here —
 * uncertainty must surface as { ok: false, why: 'send-uncertain' }.
 */
export function buildSendExpression({ text, composerWaitMs = 12000, sendWaitMs = 4000, urlWaitMs = 15000 } = {}) {
  return payload(
    { S: SELECTOR_SETS, text, composerWaitMs, sendWaitMs, urlWaitMs },
    `
  const editor = await waitFor(__rb.S.composer, __rb.composerWaitMs);
  if (!editor) return fail('composer-not-found');
  const before = (editor.textContent || '').trim();
  editor.focus();
  const transfer = new DataTransfer();
  transfer.setData('text/plain', __rb.text);
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  const after = (editor.textContent || '').trim();
  if (after === before || after.length < 16) {
    return fail('paste-not-reflected', { before_length: before.length, after_length: after.length });
  }
  const send = await waitFor(__rb.S.send, __rb.sendWaitMs);
  if (!send) return fail('send-control-not-found');
  send.click();
  const deadline = Date.now() + __rb.urlWaitMs;
  while (Date.now() < deadline) {
    if (firstMatch(__rb.S.userTurn)) {
      return { ok: true, conversation_url: location.href, user_turn_seen: true, composer_length_after: after.length };
    }
    await sleep(400);
  }
  return fail('send-uncertain', { url: location.href });`,
  );
}

/**
 * Fetch the latest assistant reply: wait for the message, settle the stream
 * (no DOM mutations for stabilityMs and no stop control), then extract via
 * the site's own copy affordance + clipboard read, falling back to the
 * visible DOM text of the message. `extraction` records which path won.
 */
export function buildFetchExpression({ appearTimeoutMs = 30000, streamTimeoutMs = 150000, stabilityMs = 2500 } = {}) {
  return payload(
    { S: SELECTOR_SETS, appearTimeoutMs, streamTimeoutMs, stabilityMs },
    `
  const message = await (async () => {
    const deadline = Date.now() + __rb.appearTimeoutMs;
    for (;;) {
      const element = lastMatch(__rb.S.assistant);
      if (element) return element;
      if (Date.now() >= deadline) return null;
      await sleep(400);
    }
  })();
  if (!message) return fail('assistant-message-not-found');
  await new Promise((resolve) => {
    const deadline = Date.now() + __rb.streamTimeoutMs;
    let lastMutation = Date.now();
    const observer = new MutationObserver(() => { lastMutation = Date.now(); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const tick = () => {
      const idleFor = Date.now() - lastMutation >= __rb.stabilityMs;
      const stillStreaming = Boolean(firstMatch(__rb.S.stop));
      if ((idleFor && !stillStreaming) || Date.now() >= deadline) {
        observer.disconnect();
        resolve();
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
  const why = [];
  let text = null;
  let extraction = null;
  const copy = (() => {
    let scope = message;
    for (let level = 0; level < 4 && scope; level += 1) {
      for (const selector of __rb.S.copy) {
        const button = scope.querySelector(selector);
        if (button) return button;
      }
      scope = scope.parentElement;
    }
    return lastMatch(__rb.S.copy);
  })();
  if (copy) {
    try {
      copy.click();
      const clipboard = await navigator.clipboard.readText();
      if (clipboard && clipboard.trim().length >= 32) {
        text = clipboard;
        extraction = 'clipboard';
      } else {
        why.push('clipboard-empty');
      }
    } catch (error) {
      why.push('clipboard-read-failed');
    }
  } else {
    why.push('copy-control-not-found');
  }
  if (text === null) {
    const visible = (message.innerText || message.textContent || '').trim();
    if (visible.length >= 32) {
      text = visible;
      extraction = 'dom';
    }
  }
  if (text === null) return fail('reply-not-extracted', { why_codes: why });
  return { ok: true, text, extraction, why_codes: why, url: location.href };`,
  );
}
