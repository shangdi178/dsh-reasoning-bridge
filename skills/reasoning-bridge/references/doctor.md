# Automatic Doctor

Run the local installation check before any browser action:

```bash
node <skillDir>/scripts/doctor.mjs --json
```

Continue only when it returns `READY`. Report `MISSING_RUNTIME` when Node.js 18 or newer is unavailable. Report `INVALID_INSTALLATION` with the failed check IDs when required skill files are missing or the installed package name is wrong.

Before opening or claiming the target site, check the versioned automation decision:

```bash
node <skillDir>/scripts/consent.mjs status --json
```

Possible statuses:

- `NEEDS_AUTOMATION_CONSENT`: no current decision exists, the state file is invalid, or the disclosure changed.
- `AUTOMATION_DISABLED`: the user declined or revoked automatic browser handoff.
- `READY`: the current disclosure was explicitly accepted.

For `NEEDS_AUTOMATION_CONSENT`, show this disclosure without softening it:

> Unofficial Experimental browser automation submits prompts to and retrieves outputs from the configured web AI (default: ChatGPT web) using your signed-in browser session. This carries non-zero account and policy risk and may trigger safeguards, temporary restrictions, or account action. This plugin cannot guarantee account safety, policy compliance, or permanent quota separation. It is not intended to bypass limits. Enable it only if you understand and accept this risk.

Ask whether to enable full automatic browser handoff (use the ask-user-question tool with explicit enable/decline options). An affirmative response must be explicit and present in the current conversation. Silence, invoking the skill, or an unrelated reply is not consent. Only then run:

```bash
node <skillDir>/scripts/consent.mjs enable --acknowledge-risk I_ACCEPT_EXPERIMENTAL_WEB_AI_AUTOMATION_RISK_V1 --json
```

On decline run `node <skillDir>/scripts/consent.mjs disable --json`. For `AUTOMATION_DISABLED`, do not open, claim, inspect, or control the target site.

Then perform the volatile browser checks on every handoff, using dsh's own browser tools per `references/transport-<target>.md`:

1. `browser_status`: if no debug Chrome is running, `browser_launch` reuses your everyday Chrome login state. If the browser tool surface itself is unavailable, return `NEEDS_BROWSER`.
2. Open the target site (`browser_open`). If it cannot load, return `NEEDS_SITE_PERMISSION` and stop.
3. Check visible account UI (via a read-only `browser_eval` on public page state). If logged out, return `NEEDS_LOGIN`, ask the user to take over the page and sign in, then recheck. Preserve the original task for resume.
4. Check the user-requested model in visible UI. If unavailable or not selected, return `NEEDS_MODEL_SELECTION`; never silently substitute another model.
5. Return `READY` only after authentication and model checks are visibly satisfied.

Never call private endpoints or inspect cookies, local storage, session storage, hidden authentication headers, browser profiles, passwords, verification codes, or credential files. Human login is a takeover step, not an automation step.
