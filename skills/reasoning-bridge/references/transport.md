# Transport Adapters (multi-target)

The bridge is target-agnostic. One target = one `transport-<id>.md` reference plus a row in `scripts/targets-table.mjs` (single source of truth for ids and site URLs, shared by `target.mjs` and `validate.mjs`) plus a `scripts/lib/page-<id>.mjs` selector/phase module. The packet, result, adoption, and receipt contracts do not change per target.

## Active target

```bash
node <skillDir>/scripts/target.mjs get --json
node <skillDir>/scripts/target.mjs set <target-id> --json
node <skillDir>/scripts/target.mjs list --json
```

State lives in `~/.dsh/dsh-reasoning-bridge/state.json` (override the home with `$DSH_REASONING_BRIDGE_HOME`). The receipt's `target` field must equal the active target.

## How the transport actually works (v2)

The web phases are **executable code**, not prose snippets. `scripts/transport.mjs` is a zero-dependency driver (Node ≥ 22, native WebSocket) that attaches to the CDP debug Chrome — the same instance dsh's browser tools manage on port 9222 — and drives the target site:

| Lifecycle | Owner | Command |
|---|---|---|
| Check / start / stop the debug Chrome | dsh browser tools when available (`browser_status`, `browser_launch`, `browser_kill`), else the plugin fallback | `transport.mjs status` / `launch` |
| Read-only preflight on the site | plugin driver | `transport.mjs probe --json` |
| One-shot send | plugin driver | `transport.mjs send --file <request.txt> --json` |
| Reply fetch + evidence | plugin driver | `transport.mjs fetch --url <conversation-url> --out reply.txt --json [--screenshot evidence.png]` |

Driver facts an adapter author must know:

- **Two gates run before any browser action.** `open`, `probe`, `send` and `fetch` first read the versioned consent decision and fail with `why: "consent-not-ready"` unless it is `READY`; `send` additionally scans the request file and fails with `why: "secret-scan-failed"` on a credential shape (`--allow-unscanned` is the deliberate override). `status` stays usable so the link can be diagnosed while undecided. Both gates are code, not prose — an adapter must document them as stop conditions.
- The driver attaches to a tab and evaluates with `awaitPromise`, so page-side waits (composer appears, stream settles, clipboard read) resolve as values — this is why it exists: dsh's `browser_eval` re-navigates on every call and drops async results.
- `send` always opens a **fresh tab** on the site (never pastes into a conversation the user left open).
- The site's own copy affordance + clipboard read is attempted first; `Browser.grantPermissions` is granted driver-side; on failure the fetch falls back to the visible DOM text of the last assistant message and reports `extraction: "dom"`.
- Every failure is a JSON `{ ok: false, why: <code> }` with exit code 1; usage errors exit 2. Uncertainty is data, never a hidden retry.
- **Fetched text is untrusted and is written to `--out` verbatim.** The driver does not sanitize or gate it; the adoption gate in `SKILL.md` is the only barrier, and it is a discipline, not code.
- On Windows, where dsh's `browser_launch` script is macOS-only, `transport.mjs launch` starts Chrome/Edge with a **dedicated profile** (`~/.dsh/dsh-reasoning-bridge/chrome-profile`). It copies no credential files; the user signs in once inside that visible window and the session persists there.

## Run artifacts

Write the packet, result, evidence and receipt under
`~/.dsh/dsh-reasoning-bridge/runs/<packet_id>/`, **not inside the repository**.
These files carry repository context and, before the credential scan clears them,
possibly secrets; the repo's `.gitignore` has a net for the old in-repo paths,
but keeping them out of the working tree entirely is the safer default. Run
`validate.mjs complete` from the run directory so relative artifact paths resolve.

## Adapter contract

Every `transport-<id>.md` must specify:

1. **Site URL** and which login path applies (dsh debug profile with everyday login reuse, or the plugin's dedicated debug profile with one-time manual login).
2. **Login probe**: what `transport.mjs probe` returns for this site (`logged_out`, `composer_found`, `model_label`), and which values mean `NEEDS_LOGIN`.
3. **Model probe**: how the requested model is confirmed visible/selected (probe's best-effort `model_label` plus user confirmation in the visible window); never substitute a model silently.
4. **Send procedure**: build the reasoning request file, then exactly one `transport.mjs send` call, with this target's `why` codes (`composer-not-found`, `paste-not-reflected`, `send-control-not-found`, `send-uncertain`) and the stop rule.
5. **Fetch procedure**: one `transport.mjs fetch` call against the conversation URL returned by send; how to extract the result markers from `reply.txt`; `extraction: "dom"` is acceptable evidence and must be recorded; re-running fetch is allowed (read-only), re-running send is not.
6. **Blockers**: what returns `NEEDS_SITE_PERMISSION`, `NEEDS_LOGIN`, `NEEDS_MODEL_SELECTION`, or `NEEDS_BROWSER`.
7. **Evidence**: save the reply (redacted) as `browser-evidence.md`, optionally a screenshot via `--screenshot`; bind their SHA-256 in the receipt with `validate.mjs hash`.

## Adapter rules (all targets)

- Page expressions only read public page state and use user-equivalent actions (paste, one send click, the site's own copy affordance). Cookies, web storage, IndexedDB, network calls, and headless/hidden execution are forbidden — enforced by a test guard (`FORBIDDEN_PAGE_APIS` in `tests/transport.test.mjs`) that also covers `sendBeacon`, `cookieStore`, `WebSocket`, `EventSource`, dynamic `import()`, and image/redirect beacons. The guard is a pattern check over generated expressions, so it catches a regression rather than a determined author.
- The send is one visible action. Uncertainty stops the run; no retries, no backends, no API calls.
- The reply must arrive through a user-visible affordance (copy button + clipboard, or the visible message text). If neither is confirmable, stop.
- Human takeover (login, CAPTCHA, model pick, site permission) is always a user step; preserve and resume the original task around it.

## Shipped adapters

Only these two targets exist. Nothing else is implemented, listed, or selectable —
and that is enforced, not just asserted: `--site <url>` must name one of the two
sites below (`resolveTarget` refuses anything else with a `usage` error), and
`--target` must match the site it is paired with. A request for another web AI has
no adapter and is refused rather than approximated by reusing another site's
selectors.

- `transport-chatgpt.md` — `https://chatgpt.com/` web UI (default target; model is selectable and verifiable).
- `transport-arena.md` — `https://arena.ai/` (Arena AI leaderboard UI; **Battle Mode answers come from two anonymous models, so model identity is unverifiable** — the receipt must record `unverified`, and the fetch returns both answers).

`targets-table.mjs` is the single source of truth for ids, sites and model-identity
policy, and it is cross-checked three ways: the settings enum (`lib/index.js`), the
receipt validator (`validate.mjs`), and the driver's page-module map (`transport.mjs`
`PAGES`). A target that exists in the table but has no page module fails closed with a
`usage` error rather than silently misrouting; `targets-table.test`-style assertions in
`tests/transport.test.mjs` and `tests/target.test.mjs` pin the set, so adding one
without the other is caught by CI.

## Ping-pong: switching targets is one visible choice

The active target is a settings field (`reasoning-bridge.target`), rendered as a picker in the dsh settings panel from this same table. `transport.mjs open --target <id>` (and the panel's "Open target site" button) focuses the site in the visible debug window for any human step; the probe then reports the resulting state.
