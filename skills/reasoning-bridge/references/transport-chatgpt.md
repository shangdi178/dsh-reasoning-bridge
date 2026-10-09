# Transport Adapter: chatgpt

Target id: `chatgpt` (default). Site: `https://chatgpt.com/`. Page selectors and phase logic live in `scripts/lib/page-chatgpt.mjs` (executable, multi-candidate, drift surfaces as `why` codes); this document tells the agent how to run the phases and what each outcome means.

## 1. Site URL and login path

`https://chatgpt.com/`. Two ways the debug Chrome gets a ChatGPT session:

- **dsh debug profile (macOS / when `browser_launch` works)**: reuses your everyday Chrome login state, so an existing ChatGPT session carries over.
- **Plugin dedicated profile (Windows fallback, `transport.mjs launch`)**: a separate profile with no copied credentials. On first use a visible Chrome window opens; the user signs in to ChatGPT once inside that window, and the session persists for later runs.

## 2. Login probe

```bash
# First make sure the debug Chrome is up (dsh browser tools, or the fallback):
node <skillDir>/scripts/transport.mjs status --json
node <skillDir>/scripts/transport.mjs launch --json          # only if status says running:false
node <skillDir>/scripts/transport.mjs probe --json
```

Probe returns `{ ok, url, title, logged_out, composer_found, model_label }`:

- `logged_out === true` → `NEEDS_LOGIN`; ask the user to take over the visible page and sign in, then re-run the probe. Preserve the original task.
- `logged_out === false && composer_found === false` → the page is neither logged-in composer nor a login screen; return `NEEDS_SITE_PERMISSION` and stop.
- `model_label` is best-effort and may be `null` (localized UI); it is supporting evidence, not proof. See §3.
- `why` codes from the driver (`cdp-no-page`, `page-load-timeout`, `page-exception`, …) → treat as `NEEDS_BROWSER` or `NEEDS_SITE_PERMISSION` depending on `status` above; do not improvise.

## 3. Model probe

Ask the user which model the handoff requires and have them confirm in the **visible** window that it is actually selected (open the model picker if needed); the agent may cross-check the probe's `model_label` when it is non-null. Record the visible label in the receipt's `web_model.observed`. If the requested model is not visible or cannot be selected: return `NEEDS_MODEL_SELECTION`; never substitute another model.

## 4. Send procedure (exactly one attempt)

1. Re-run the login probe immediately before sending. Abort on any change.
2. Compose the full reasoning request (wrapper from `reasoning-request.md` + validated packet) as one UTF-8 file, e.g. `run/request.txt`.
3. Send once:

```bash
node <skillDir>/scripts/transport.mjs send --file run/request.txt --json
```

4. Outcomes:
   - `{ ok: true, conversation_url, user_turn_seen: true }` → proceed to §5 and record `conversation_url`.
   - `{ ok: false, why: "composer-not-found" | "paste-not-reflected" | "send-control-not-found" }` → the send never started; the page state is unchanged. Treat as `NEEDS_SITE_PERMISSION` (evidence: screenshot of the visible window) and stop.
   - `{ ok: false, why: "send-uncertain" }` → the click happened but the user turn could not be confirmed. **Terminal blocker for this handoff**: do not resend, do not retry, do not continue the conversation. Record `browser_transport: "failed"`.

The driver opens a fresh tab for every send, so a send never lands in a conversation the user left open.

## 5. Fetch procedure

Wait a few seconds after `send` returns (the reply keeps streaming), then fetch from the conversation URL:

```bash
node <skillDir>/scripts/transport.mjs fetch --url <conversation_url> --out run/reply.txt --json --screenshot run/reply.png
```

- The driver waits for the stream to settle (no DOM changes and no stop control) before extracting. `--stream-timeout-ms` (default 150000) bounds the wait.
- Reply text is written verbatim to `run/reply.txt`; stdout JSON reports `extraction: "clipboard"` (the site's own copy button + clipboard read) or `"dom"` (visible text of the last assistant message). Record which path was used in `browser_evidence` notes.
- `why_codes: ["clipboard-read-failed", "copy-control-not-found", …]` are diagnostics; `extraction: "dom"` is acceptable, visible-page evidence.
- Extract the single `BEGIN_REASONING_RESULT … END_REASONING_RESULT` block from `reply.txt`, save verbatim as `result.md`, and validate:

```bash
node <skillDir>/scripts/validate.mjs result run/result.md
node <skillDir>/scripts/validate.mjs pair run/packet.md run/result.md
```

- If the reply carries no result markers or is truncated: save it (redacted) as evidence, do **not** ask the web AI to continue the conversation, and stop.
- Fetch is read-only and may be re-run (e.g. after a timeout). Send may not.

## 6. Blockers

| Status | Condition |
|---|---|
| `NEEDS_BROWSER` | `status` reports `running:false` and `launch` fails or Node < 22 (`why: "node-too-old"`) |
| `NEEDS_SITE_PERMISSION` | site cannot load, composer/copy controls not confirmable, send uncertain |
| `NEEDS_LOGIN` | probe reports `logged_out: true` |
| `NEEDS_MODEL_SELECTION` | requested model not visible/selected in the visible window |

## 7. Evidence

Save under the run directory: `browser-evidence.md` (the fetched reply, redacted), optionally `reply.png` from `fetch --screenshot`. Bind their SHA-256 in the receipt:

```bash
node <skillDir>/scripts/validate.mjs hash run/browser-evidence.md
```

## Selector drift

When ChatGPT changes its DOM, phases return `why` codes instead of half-working. Diagnosis: open the visible window, run `probe --json`, note which fields are false/null, fix the candidate selectors in `scripts/lib/page-chatgpt.mjs` (they are lists on purpose — add the new selector first, keep the old ones), re-run `npm test` (the forbidden-API and compile guards must stay green), and only then retry the run.
