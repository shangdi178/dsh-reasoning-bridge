# Transport Adapters (multi-target)

The bridge is target-agnostic. One target = one `transport-<id>.md` reference plus an id accepted by `scripts/target.mjs`. The packet, result, adoption, and receipt contracts do not change per target.

## Active target

```bash
node <skillDir>/scripts/target.mjs get --json
node <skillDir>/scripts/target.mjs set <target-id> --json
node <skillDir>/scripts/target.mjs list --json
```

State lives in `~/.dsh/dsh-reasoning-bridge/state.json` (override the home with `$DSH_REASONING_BRIDGE_HOME`). The receipt's `target` field must equal the active target.

## Adapter contract

Every `transport-<id>.md` must specify, using only dsh's documented browser tools (`browser_status`, `browser_launch`, `browser_open`, `browser_eval`, `browser_screenshot`, `browser_kill`):

1. **Site URL** and whether the debug Chrome profile (everyday login state) is expected to be signed in.
2. **Login probe**: a read-only page check that distinguishes logged-in from logged-out, with the exact `browser_open` wait and a bounded `browser_eval` expression.
3. **Model probe**: how to verify the user-requested model is visible/selected; never substitute a model silently.
4. **Send procedure**: how to place the reasoning request into the composer with visible, user-equivalent actions, one attempt only, with the exact stop-on-uncertainty rule.
5. **Fetch procedure**: how to obtain the reply via a user-visible affordance (copy button + clipboard read, or visible message selection). No hidden DOM answer scraping beyond what a user sees on the page.
6. **Blockers**: what returns `NEEDS_SITE_PERMISSION`, `NEEDS_LOGIN`, `NEEDS_MODEL_SELECTION`, or `NEEDS_BROWSER`.
7. **Evidence**: what to save as `browser_evidence` (screenshot path or transcript snippet) and how its SHA-256 lands in the receipt.

## Adapter rules (all targets)

- Read-only probes use `browser_eval` expressions that only read public page state; never touch cookies, storage, hidden auth data, or private endpoints.
- The send is one visible, user-equivalent action. Uncertainty stops the run; no retries, no backends, no API calls.
- The reply must arrive through a user-visible affordance. If the affordance cannot be confirmed, stop.
- Human takeover (login, CAPTCHA, model pick, site permission) is always a user step; preserve and resume the original task around it.

## Shipped adapters

- `transport-chatgpt.md` — `https://chatgpt.com/` web UI.
