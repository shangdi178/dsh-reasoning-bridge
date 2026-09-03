# Transport Adapter: chatgpt

Target id: `chatgpt` (default). Site: `https://chatgpt.com/`.

## 1. Site URL

`https://chatgpt.com/`. dsh's debug Chrome reuses your everyday Chrome login state, so an existing ChatGPT session usually carries over.

## 2. Login probe

```text
browser_open  https://chatgpt.com/  wait=6000
browser_eval  ({
  loggedOut: !!document.querySelector('[data-testid="login-button"]'),
  composer:  !!document.querySelector('#prompt-textarea, [contenteditable="true"]'),
  title: document.title,
})
```

- `loggedOut === true` → `NEEDS_LOGIN`; ask the user to take over the visible page and sign in, then re-run the probe. Preserve the original task.
- `composer === false` after login → treat as blocker; return `NEEDS_SITE_PERMISSION` and stop.
- Selectors drift; if both probes fail in an unexpected way, save a `browser_screenshot` as evidence and stop with `NEEDS_SITE_PERMISSION`. Do not improvise scraping.

## 3. Model probe

Ask the user which model the handoff requires and have them (or a visible UI check you perform by opening the model selector) confirm it is actually selected. Record the visible selector label in the receipt's `web_model.observed`. If the requested model is not visible or cannot be selected: return `NEEDS_MODEL_SELECTION`; never substitute another model.

## 4. Send procedure (one attempt)

1. Re-run the login probe immediately before sending. Abort on any change.
2. Compose the full reasoning request (wrapper + packet) as one string.
3. Insert it into the composer with a paste-equivalent visible action:

```text
browser_eval  (async () => {
  const editor = document.querySelector('#prompt-textarea, div[contenteditable="true"]');
  if (!editor) return { ok: false, why: 'composer-not-found' };
  const dt = new DataTransfer();
  dt.setData('text/plain', `<<REASONING_REQUEST>>`);
  editor.focus();
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return { ok: true, length: `<<REASONING_REQUEST>>`.length };
})()
```

4. Verify the composer now contains the packet's first line, then activate the visible send control (the send button a user would click) exactly once:

```text
browser_eval  (document.querySelector('[data-testid="send-button"], button[aria-label*="Send"]') ?? {})?.click?.() ?? 'send-control-not-found'
```

5. If any step returns `not-found`, or the composer content cannot be confirmed, stop: `browser_transport: "failed"`. Do not retry, do not fall back to hidden endpoints.

## 5. Fetch procedure

Wait for the response to finish streaming (poll a bounded, read-only visibility check a few times with real waits; do not spin). Then obtain the reply through the user-visible copy affordance:

```text
browser_eval  (async () => {
  const btn = [...document.querySelectorAll('button[aria-label]')].find(b => /copy/i.test(b.getAttribute('aria-label')));
  if (!btn) return { ok: false, why: 'copy-control-not-found' };
  btn.click();
  await new Promise(r => setTimeout(r, 600));
  return { ok: true, text: await navigator.clipboard.readText() };
})()
```

- Clipboard read may require permission; if it rejects, stop instead of scraping around it.
- Extract the single `BEGIN_REASONING_RESULT … END_REASONING_RESULT` block from the copied text, save verbatim as `result.md`, and validate `result` + `pair`.
- Save the copied reply (redacted) as `browser_evidence.md`; screenshot the visible answer as supporting evidence.

## 6. Blockers

| Status | Condition |
|---|---|
| `NEEDS_BROWSER` | browser tools unavailable or launch fails |
| `NEEDS_SITE_PERMISSION` | site cannot load, composer/copy controls not confirmable |
| `NEEDS_LOGIN` | login probe reports logged out |
| `NEEDS_MODEL_SELECTION` | requested model not visible/selected |

## 7. Evidence

Save under the run directory: `browser-evidence.md` (the copied reply, redacted) and optionally a screenshot. The receipt binds their SHA-256.
