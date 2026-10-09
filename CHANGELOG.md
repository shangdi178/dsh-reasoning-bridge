# Changelog

## 0.3.0 — 2026-09-08

Second target, a working settings panel, and the target becomes a visible
choice. All of it verified live against the real sites, not just in unit tests.

- **`arena` target** (`https://arena.ai/`) — `scripts/lib/page-arena.mjs` plus
  `references/transport-arena.md`. Arena's composer is a React-controlled
  `<textarea>`, so this target uses a new driver input mode: focus the control
  and insert text through the browser input pipeline (`Input.insertText`) instead
  of a synthetic paste event. Live-verified: `probe` → `logged_out: true`,
  `composer_found: true`, `mode_label: "Battle Mode"`, `recaptcha_present: true`;
  `send` → `conversation_url: https://arena.ai/c/<uuid>`; `fetch` →
  `extraction: "labelled-answers"` with both battle answers captured verbatim.
- **Honest model identity per target** — `targets-table.mjs` now records
  `models: 'selectable' | 'battle'`. Arena's Battle Mode answers with two
  randomly chosen anonymous models, so a run against it can never report a
  verified web model: the probe returns `model_label: null`,
  `model_verifiable: false`, `model_identity: "battle"`, the fetch returns both
  answers, and the adapter contract says the receipt must record `unverified`.
- **The settings panel's link card actually works.** Its routes live in
  `lib/web.js`, which was never mounted — every button 404'd. The main entry now
  mounts them through a scoped injection (`ctx.inject(['webServer','loader'], …)`)
  so a web profile gets the routes while a headless profile simply never runs
  them, with no root-level row left pending on a service that profile cannot
  provide (which is why the web entry could not go in the bundle patch).
- **Target is a real choice** — the settings schema types `target` as a union of
  the known ids (an enum: unknown values are rejected instead of silently stored
  as free text), and the panel renders a picker fed from `targets-table.mjs` over
  `/reasoning-bridge/state`, degrading to the old text field if the route is
  unavailable.
- **More interaction** — `transport.mjs open` (and the panel's "Open target site"
  button, `POST /reasoning-bridge/open`) focuses the site in the visible window
  for the human step; the panel renders a structured preflight summary (target,
  mode, login, CAPTCHA, model identity) instead of only a raw JSON dump; the
  active target can be switched from the panel (`POST /reasoning-bridge/target`).
- **Two latent bugs fixed** — page expressions declared their helpers *inside*
  the `try`, so any page exception surfaced as `fail is not defined` instead of
  the real cause (both page modules, caught by the first live arena probe); and
  `RegExp` constants passed through `JSON.stringify` serialized to `{}`, so the
  page-side `pattern.test` was not a function.
- 51 node:test cases (arena expression guards, target table + model policy,
  settings enum, and route/handler coverage for the scoped injection)

## 0.2.0 — 2026-09-07

The web transport is now executable code. The 0.1.0 browser snippets in
`transport-chatgpt.md` could not run on the real dsh tool surface (every
`browser_eval` re-navigates and async results are dropped), so the page phases
moved into a tested zero-dependency driver.

- `scripts/transport.mjs` — `status | launch | probe | send | fetch` CLI over
  the CDP debug Chrome (:9222); native WebSocket, Node >= 22; strict JSON out,
  exit 0/1/2, every failure a `{ok:false, why}` code
- `scripts/lib/cdp.mjs` — minimal CDP client: attach (reuse the site's tab or
  create a dedicated one, no reload-per-eval), `awaitPromise` evaluation,
  clipboard permission grant, screenshots
- `scripts/lib/page-chatgpt.mjs` — chatgpt page phases as expression builders:
  multi-candidate selectors, single-send discipline, stream-settle wait,
  copy-affordance + clipboard fetch with visible-DOM fallback (`extraction`
  records the path); cookies/storage/network forbidden and guarded by tests
- Windows fallback launcher: `transport.mjs launch` starts Chrome/Edge with a
  dedicated profile (no credential files copied; one-time manual sign-in)
- Shared `scripts/targets-table.mjs` (target.mjs + validate.mjs single source);
  `validate.mjs` receipt parse errors are reported instead of crashing;
  `doctor.mjs` checks the new transport files and flags Node < 22 for the driver
- Rewritten `transport.md` / `transport-chatgpt.md` / doctor browser layer /
  SKILL.md steps around the driver commands; CI matrix now Node 22/24
- 34 node:test cases (transport expression guards + CLI codes added)

## 0.1.0 — 2026-09-05

Initial release.

- Runtime skill `reasoning-bridge` (SKILL.md workflow + 8 reference contracts)
- Deterministic validators: `validate.mjs` (packet / result / pair / receipt / complete / hash),
  `consent.mjs` (versioned risk consent), `doctor.mjs` (install self-check),
  `target.mjs` (multi-target selection, chatgpt first)
- SHA-256 run receipts with privacy-review fields and a deterministic completion gate
- Zero dependencies, zero build; 22 node:test cases
