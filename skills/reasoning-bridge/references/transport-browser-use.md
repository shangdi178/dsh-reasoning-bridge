# Transport via DSH Browser Use (Playwright MCP / Chrome DevTools MCP)

The transport no longer assumes legacy `browser_*` dsh tools or the bundled CDP
driver. The configured **DSH Browser Use provider** owns the browser: tools
arrive as `mcp__chrome-devtools-mcp__<tool>` (Chrome DevTools MCP) or
Playwright MCP equivalents, with explicit `navigate` / `snapshot` / `fill` /
`click` / `read` semantics and a re-observe after every action.

This document defines the tool-agnostic contract the Skill follows, the provider
configuration that mounts the browser, and how reuse of the main Chrome's login
state is achieved **without copying cookies or touching the user's profile**.

## 1. Mount the provider (one-time, in the dsh profile)

```yaml
# profile composition, after the plugin entries
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp'
  config:
    mode: attach          # attach = operate an existing browser
    endpoint: http://127.0.0.1:9222
```

Two supported ways to get a browser that already has the ChatGPT login:

| Way | How | What it costs |
|---|---|---|
| **`--autoConnect` to the running main Chrome** (preferred) | Start the provider with the upstream `--autoConnect` argument; Chrome shows one **Allow** dialog; the MCP server attaches to the *running* browser with its real profile and login state | Requires user to start Chrome; one permission click; MCP gets access to the open windows of the chosen profile |
| **`mode: attach` + `endpoint`** | Start Chrome once with `--remote-debugging-port=9222` **using the normal user profile** (a shortcut with that flag), then attach | The debug port is open while that session runs; do not browse untrusted sites with the port open |

Both preserve the user's own profile: the provider attaches to the browser the
user already runs — it does **not** launch a second browser, does not copy
cookies, and does not select another profile. What the plugin never does:
`launch` a separate instance for the handoff, copy profile files, or read auth
data. (`mode: launch` with `headless: true` remains available for CI-style
smoke tests of a *fake* chat page, not for the real ChatGPT flow.)

## 2. Read-only preflight (Phase 1 scope)

With the provider mounted, the model performs the preflight using browser tools
only — no shell, no CDP driver:

1. `navigate` to the target site from `targets-table.mjs` (`chatgpt` →
   `https://chatgpt.com/`), or **do not navigate at all** if a tab is already on
   it — reuse the user's tab when one exists.
2. `snapshot` (accessibility tree) and read it. Decide:
   - composer control visible → `COMPOSER_VERIFIED`
   - a `Sign in` / `Log in` affordance → `NEEDS_LOGIN` (human step; ask the user)
   - neither, or a challenge page → `NEEDS_SITE_PERMISSION`
   - no browser connection at all → `NEEDS_BROWSER`
3. Model identity: the snapshot's model picker label is supporting evidence only.
   `NEEDS_MODEL_SELECTION` when the user required a specific model and it is not
   visible; never substitute.

Every subsequent action re-observes with `snapshot` before the next decision.

## 3. Handoff semantics (Phase 2, human-confirmed send)

- `SEND_INTENT` is a **user decision**: present the packet summary and destination
  in chat and wait for an explicit go-ahead before the first fill. No automatic
  submission.
- Fill the composer with the wrapped request (one `fill`/`insertText` action on
  the composer element from the latest snapshot — no synthetic `ClipboardEvent`
  paste as the primary path).
- Click the visible send control **once** (`click`), then `snapshot` again:
  - user turn present → `SUBMITTED`
  - nothing changed → `UNCERTAIN` — terminal for this handoff; never re-send
- Wait for the reply (re-`snapshot` until the newest assistant turn stops
  changing or a stop control disappears), then `read`/`snapshot` the **latest
  assistant turn only** — not the first historical copy button.
- Bind the result to the run by `packet_id` echoed in the reply, and record in
  the receipt which turn/evidence the answer came from.

## 4. State machine (deterministic, receipt-visible)

```
PRECHECKED → COMPOSER_VERIFIED → SEND_INTENT → SUBMITTED → RESULT_OBSERVED → RESULT_VALIDATED
                                    ↓ (uncertain submit)
                                UNCERTAIN   (terminal; no re-send, no complete)
```

`transport.mjs handoff --state <json>` validates a state transcript against this
machine (see `scripts/transport.mjs`); the receipt's `complete` gate refuses a
run whose transcript is not `RESULT_VALIDATED` or that entered `UNCERTAIN`.

## 5. What stays enforced by code

- The versioned consent gate (`consent.mjs`) still gates the panel routes and the
  handoff validator; the disclosure and enable flow are unchanged.
- The credential scan still gates every outbound request file (`scanForSecrets`).
- The local adoption gate remains a *discipline* — this plugin registers no
  tools, so nothing mechanically intercepts the agent's own tool calls. README's
  强制执行 vs. 纪律约定 table is still the authority on what is code and what is
  compliance.
- Screenshots, if any, are opt-in and written to the run directory only.
