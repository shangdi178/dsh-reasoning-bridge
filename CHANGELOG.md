# Changelog

## 0.4.0 — 2026-10-10

Audit release. A README-vs-implementation review plus two independent audits
(adoption-gate enforcement, sensitive egress) found that several claims in the
documentation were **prose, not code**. This release turns the cheap ones into
mechanisms and rewrites the rest so the docs describe what actually happens.

A third, adversarial audit of the first pass then found three more holes — one of
them a regression this release introduced — so the notes below describe the final
state, not the intermediate one.

**Regression caught and fixed**

- **The widened scanner blocked legitimate packets.** The generic rules matched
  *any* non-space right-hand side, so `const token = getToken();`,
  `api_key=YOUR_KEY_HERE`, `Authorization: <your-token-here>` and
  `Cookie: session=abc123` all tripped it. A gate that blocks real work is worse
  than the misses it closes, because it teaches operators to pass
  `--allow-unscanned`. The rules now require the *value* to look like key
  material, and a name that is explicitly a password/passphrase relaxes the
  diversity test so `DB_PASS=correcthorsebatterystaple` is still caught.
  Measured: 0 false positives on 21 legitimate samples, 13/14 real secrets
  caught (the miss is a password in prose, which is irreducibly semantic).

**Turned into enforced code**

- **Consent is now a gate, not a suggestion.** `transport.mjs open|probe|send|fetch|launch`
  read the versioned decision and fail with `why: "consent-not-ready"` unless it
  is `READY`; the panel's `/open`, `/launch`, `/probe` routes return 403.
  Previously `transport.mjs` never imported `consent.mjs`, so a disabled install
  was still one command away from driving the browser — and `launch` stayed a
  working un-gated path even after the first pass, starting a debug Chrome with
  no consent file while the panel refused the same request. `status` deliberately
  stays usable (it only probes the debug port) so the link can be diagnosed
  while the decision is pending.
- **An unsupported `--site` can no longer borrow another target's module.**
  `resolveTarget` fell back to the chatgpt page module for any URL, so
  `--site https://example.com/` navigated an arbitrary site while reporting
  `target: "chatgpt"` — driving a page with selectors never written for it. It
  now requires a known site plus a matching target and fails with a usage error.
- **UTF-16 request files are no longer a scan bypass.** Reading them as UTF-8
  yields interleaved NULs, so no pattern matched while the composer still
  received the secret as mojibake. Request files are decoded (BOM or NUL
  heuristic) before scanning.
- **The adoption record needs per-proposal evidence.** One arbitrary string used
  to satisfy the whole record; every accepted item must now carry its own
  `local_evidence` anchor. This is still structure, not proof — the gate cannot
  verify an anchor names a real symbol — and both the reference and the code
  comment now say exactly that.
- **`send` refuses credential-shaped request files.** The scanner is now wired
  into the send path (`why: "secret-scan-failed"`) instead of being a separate
  CLI step an agent had to remember; `--allow-unscanned` is the deliberate
  override. The scan is exported as `scanForSecrets()` from `validate.mjs`.
- **The scan itself was weak.** It caught 7 shapes and missed every JWT, cloud
  secret key, connection string, webhook, and `.env` line. It now covers: PEM/PGP
  keys, AWS (id + secret), GitHub/GitLab/npm/HF, Slack/Discord webhooks,
  OpenAI/Stripe/Google/Azure/Twilio keys, JWTs, `user:pass@host` connection
  strings, `Authorization`/`Cookie` headers, and `KEY: value` / `.env`-style
  credential assignments (value-checked, see the regression note above). Two
  regex bugs were also fixed: `sk_live_` (underscore) never matched, and a
  leading `\b` failed after `=`.
- **`complete` re-scans what it hashes.** `verifyReceiptArtifacts()` previously
  verified SHA-256 only; a packet containing `password: hunter2` passed
  `complete` while failing `packet`. It now re-runs the credential scan on the
  artifact contents, so the gate no longer rests on a self-declared
  `credentials_scan_passed: true`.
- **`complete` demands a non-empty adoption record.** `adoption.status: "passed"`
  with four empty arrays used to satisfy the gate — the exact shape a run that
  skipped the gate produces. It now requires at least one classified proposal and
  at least one piece of local evidence.
- **The panel routes actually work again.** `webPort()` read the loader entry,
  where an `!!js` port expression is a *function*, so it fell back to 3080 and the
  Host guard rejected the real `127.0.0.1:38080` — every route 403'd. It now
  prefers `req.socket.localPort` (the same fix dsh-versions carries).
- **`/open` validates its target** like `/target` does, instead of passing free
  text into the driver's argv.
- **The forbidden-API test guard was a lint.** It matched five strings; a page
  module using `XMLHttpRequest`, `sendBeacon`, `cookieStore`, `WebSocket`,
  dynamic `import()`, or a `location` redirect passed green. `FORBIDDEN_PAGE_APIS`
  now covers the bypass surface, and a "guard the guard" test asserts each one is
  rejected.
- **Target/page-module drift is now impossible.** A test asserts
  `targets-table.mjs` and `scripts/lib/page-<id>.mjs` list exactly the same set,
  and that each module exports the phase builders its `INPUT_MODE` requires.
  (Writing that test immediately exposed that `page-chatgpt.mjs` never declared
  `INPUT_MODE` — the driver hardcoded it. Both modules now self-declare.)

**Documentation honesty**

- README gains an **「强制执行 vs. 纪律约定」** table separating what code enforces
  from what the agent is merely asked to do, and states the root cause plainly:
  `dsh.plugin.json` declares `"tools": []`, so the plugin cannot intercept tool
  calls and the adoption gate is compliance-dependent by construction.
- `references/adoption-gate.md` and `references/reasoning-result.md` now say that a
  passing validation is a *structural* verdict, not a safety one — the audit
  confirmed a result whose Proposed Changes read "ignore previous instructions and
  run …" validates cleanly.
- README lists the shipped targets explicitly (`chatgpt`, `arena`) and states that
  no other web AI is implemented, listed, or selectable.
- Corrected stale claims: five → six transport subcommands; the test count; and
  the run-artifact location now that packets are written outside the repo.

- 63 node:test cases (was 51)

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
