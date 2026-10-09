// Page-phase expression builders for the arena target (https://arena.ai/).
// Each builder returns one self-contained async IIFE string that transport.mjs
// evaluates inside the page via CDP (awaitPromise: true). Selectors are
// multi-candidate on purpose: the first match wins, every miss maps to a `why`
// code so selector drift surfaces as data instead of a stuck workflow.
//
// Discipline (enforced by tests): the expressions only read public page state
// and use user-equivalent actions (browser-level text insertion, one send
// click, visible DOM reads). They never touch cookies, web storage, IndexedDB,
// or the network.
//
// Target facts that shape this adapter (captured live on 2026-xx, arena.ai):
//   - The composer is a React-controlled <textarea name="message">, NOT a
//     contenteditable: a synthetic paste event does not land, so the driver
//     inserts text through the browser input pipeline (Input.insertText). That
//     is why INPUT_MODE is 'insert-text' and the send phase is split in two.
//   - The send control is <button aria-label="Send message" type="submit">,
//     disabled while the composer is empty.
//   - A send creates the conversation at https://arena.ai/c/<uuid>.
//   - The default mode is Battle Mode: one prompt is answered by TWO anonymous
//     models shown as 助手 A / 助手 B (Assistant A / B), then the page asks the
//     user to vote. Model identity is randomized per battle and therefore
//     cannot be verified — a run against this target must report an unverified
//     web model. The fetch phase extracts every labelled answer.
//   - reCAPTCHA is present on the page; it is reported, never bypassed.
//   - The UI follows the account/browser locale (zh labels observed).

export const SITE = 'https://arena.ai/';

/**
 * How the driver puts text into the composer.
 * 'insert-text' = focus the composer, then Input.insertText through CDP.
 */
export const INPUT_MODE = 'insert-text';

const SELECTOR_SETS = {
  composer: ['textarea[name="message"]', 'textarea[placeholder^="Ask anything"]', 'form textarea', 'textarea'],
  send: ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]', 'form button[type="submit"]'],
  // Arena renders messages as utility-classed divs without stable data-*
  // attributes, so turn detection is label/text based (see HELPERS.turnText).
  conversation: ['main', '#__next', 'body'],
  stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="停止"]', '[data-testid="stop-button"]'],
  loginLink: ['a[href*="/login"]', 'a[href*="/signin"]'],
  recaptcha: ['.g-recaptcha', 'iframe[src*="recaptcha"]', 'textarea[name="g-recaptcha-response"]'],
};

// Assistant answer headings, matched exactly after trimming. Arena shows two
// anonymous battle models per prompt; the labels follow the UI locale.
const ASSISTANT_LABELS = ['助手 A', '助手 B', '助手A', '助手B', 'Assistant A', 'Assistant B', 'Model A', 'Model B'];
// Passed to the page as SOURCE STRINGS: a RegExp does not survive
// JSON.stringify (it serializes to {}), so the page rebuilds them.
const LOGIN_SOURCE = '^(log ?in|sign ?in|登录|登入)$';
const MODE_SOURCE = '(battle|direct|side[- ]by[- ]side|对战|直接)';

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
  const textOf = (el) => ((el && (el.innerText || el.textContent)) || '').trim();
  const loginRe = new RegExp(__rb.LOGIN_SOURCE, 'i');
  const modeRe = new RegExp(__rb.MODE_SOURCE, 'i');
  const byText = (pattern, scope) => {
    const root = scope || document;
    for (const element of root.querySelectorAll('button, a, [role="button"]')) {
      if (pattern.test(textOf(element))) return element;
    }
    return null;
  };
  const modeLabel = () => {
    const element = byText(modeRe);
    return element ? textOf(element).slice(0, 60) || null : null;
  };
  // The labels sit in their own small element; the answer is the closest
  // ancestor that holds more text than the label itself.
  const labelledAnswers = () => {
    const out = [];
    for (const label of __rb.ASSISTANT_LABELS) {
      const holder = [...document.querySelectorAll('*')].find(
        (el) => textOf(el) === label && el.children.length === 0,
      );
      if (!holder) continue;
      let scope = holder.parentElement;
      for (let level = 0; level < 4 && scope; level += 1) {
        const body = textOf(scope).replace(label, '').trim();
        if (body.length >= 8) {
          out.push({ label, text: body });
          break;
        }
        scope = scope.parentElement;
      }
    }
    return out;
  };
`;

// Wrap args + body into one expression. Helpers are declared OUTSIDE the try so
// the catch block can still report a page exception through `fail` (declaring
// them inside would turn any error into "fail is not defined").
function payload(args, body) {
  return `(async () => {\n  const __rb = ${JSON.stringify(args)};\n  ${HELPERS}\n  try {\n${body}\n  } catch (error) {\n    return fail('page-exception', { detail: String(error && error.message ? error.message : error) });\n  }\n})()`;
}

/** Read-only preflight: login state, composer, mode, reCAPTCHA, model identity. */
export function buildProbeExpression({ settleMs = 8000 } = {}) {
  return payload(
    { S: SELECTOR_SETS, ASSISTANT_LABELS, LOGIN_SOURCE, MODE_SOURCE, settleMs },
    `
  const deadline = Date.now() + __rb.settleMs;
  let composer = null;
  let loggedOut = null;
  while (Date.now() < deadline) {
    composer = firstMatch(__rb.S.composer);
    loggedOut = byText(loginRe) || firstMatch(__rb.S.loginLink);
    if (composer || loggedOut) break;
    await sleep(400);
  }
  const recaptcha = Boolean(firstMatch(__rb.S.recaptcha));
  return {
    ok: true,
    url: location.href,
    title: document.title,
    logged_out: Boolean(loggedOut),
    composer_found: Boolean(composer),
    mode_label: modeLabel(),
    // Battle mode hands the prompt to anonymous models: identity is not
    // verifiable, so the probe reports the label instead of a model name and
    // the receipt must record web_model_status = 'unverified'.
    model_label: null,
    model_verifiable: false,
    recaptcha_present: recaptcha,
  };`,
  );
}

/**
 * Send phase, step 1: wait for the composer and focus it so the driver's
 * Input.insertText lands in the React textarea. Reports the mode label and
 * reCAPTCHA state so the caller can stop before typing anything.
 */
export function buildComposerFocusExpression({ composerWaitMs = 12000 } = {}) {
  return payload(
    { S: SELECTOR_SETS, ASSISTANT_LABELS, LOGIN_SOURCE, MODE_SOURCE, composerWaitMs },
    `
  const composer = await waitFor(__rb.S.composer, __rb.composerWaitMs);
  if (!composer) return fail('composer-not-found');
  composer.focus();
  return {
    ok: true,
    composer_found: true,
    composer_tag: composer.tagName,
    focused: document.activeElement === composer,
    existing_length: (composer.value || '').trim().length,
    mode_label: modeLabel(),
    recaptcha_present: Boolean(firstMatch(__rb.S.recaptcha)),
  };`,
  );
}

/**
 * Send phase, step 2: verify the inserted text landed, click the visible send
 * control exactly once, then wait for the conversation URL / user turn. No
 * retries here — uncertainty must surface as { ok: false, why: 'send-uncertain' }.
 */
export function buildSendAfterInsertExpression({ text, minChars = 16, sendWaitMs = 4000, urlWaitMs = 15000 } = {}) {
  return payload(
    { S: SELECTOR_SETS, ASSISTANT_LABELS, LOGIN_SOURCE, MODE_SOURCE, text, minChars, sendWaitMs, urlWaitMs },
    `
  const editor = firstMatch(__rb.S.composer);
  if (!editor) return fail('composer-not-found');
  const value = (editor.value || '').trim();
  if (value.length < Math.min(__rb.minChars, __rb.text.length)) {
    return fail('insert-not-reflected', { value_length: value.length, expected_at_least: Math.min(__rb.minChars, __rb.text.length) });
  }
  const send = await waitFor(__rb.S.send, __rb.sendWaitMs);
  if (!send) return fail('send-control-not-found');
  if (send.disabled) return fail('send-control-disabled');
  const anchored = /^https:\\/\\/arena\\.ai\\/c\\//.test(location.href);
  send.click();
  const echo = __rb.text.trim().slice(0, 24);
  const deadline = Date.now() + __rb.urlWaitMs;
  while (Date.now() < deadline) {
    const onConversation = /^https:\\/\\/arena\\.ai\\/c\\//.test(location.href);
    if ((onConversation && !anchored) || document.body.innerText.includes(echo)) {
      return {
        ok: true,
        conversation_url: location.href,
        user_turn_seen: true,
        mode_label: modeLabel(),
        value_length_after: value.length,
      };
    }
    await sleep(400);
  }
  return fail('send-uncertain', { url: location.href });`,
  );
}

/**
 * Fetch the assistant answers: wait for at least one labelled answer, settle
 * the stream (no DOM mutations for stabilityMs and no stop control), then
 * extract every labelled answer plus the visible conversation text as a
 * fallback. `answers` records the battle pair; `text` is what the run receipt
 * and the Result contract consume.
 */
export function buildFetchExpression({ appearTimeoutMs = 30000, streamTimeoutMs = 150000, stabilityMs = 2500 } = {}) {
  return payload(
    { S: SELECTOR_SETS, ASSISTANT_LABELS, LOGIN_SOURCE, MODE_SOURCE, appearTimeoutMs, streamTimeoutMs, stabilityMs },
    `
  const waitAnswers = async () => {
    const deadline = Date.now() + __rb.appearTimeoutMs;
    for (;;) {
      const answers = labelledAnswers();
      if (answers.length) return answers;
      if (Date.now() >= deadline) return [];
      await sleep(400);
    }
  };
  let answers = await waitAnswers();
  if (!answers.length) {
    // Battle labels may be absent in a single-model mode; fall back to waiting
    // for any conversation text beyond the prompt echo.
    const deadline = Date.now() + __rb.appearTimeoutMs;
    while (Date.now() < deadline && !firstMatch(__rb.S.conversation)) await sleep(400);
  }
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
  answers = labelledAnswers();
  const why = [];
  let text = null;
  let extraction = null;
  if (answers.length) {
    text = answers.map((answer) => '### ' + answer.label + '\\n' + answer.text).join('\\n\\n');
    extraction = 'labelled-answers';
    if (answers.length === 1) why.push('single-answer-visible');
  } else {
    const scope = firstMatch(__rb.S.conversation);
    const visible = textOf(scope);
    if (visible.length >= 32) {
      text = visible;
      extraction = 'conversation-dom';
      why.push('answer-label-not-found');
    }
  }
  if (text === null) return fail('reply-not-extracted', { why_codes: why });
  return {
    ok: true,
    text,
    answers,
    extraction,
    why_codes: why,
    mode_label: modeLabel(),
    url: location.href,
  };`,
  );
}
