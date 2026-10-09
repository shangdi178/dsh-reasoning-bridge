# Transport Adapter: arena

Target id: `arena`. Site: `https://arena.ai/` (Arena AI — "The Official AI Ranking & LLM Leaderboard"). Page selectors and phase logic live in `scripts/lib/page-arena.mjs` (executable, multi-candidate, drift surfaces as `why` codes); this document tells the agent how to run the phases and what each outcome means.

## 1. Site URL and login path

`https://arena.ai/`. The driver attaches to the debug Chrome on `:9222` and reuses a tab already on the site's origin, otherwise it opens a fresh one. Two ways the debug Chrome gets a session:

- dsh's own browser tools (`browser_launch`) when they work in this environment, or
- `node <skillDir>/scripts/transport.mjs launch --json` (starts Chrome/Edge with the plugin's dedicated profile `~/.dsh/dsh-reasoning-bridge/chrome-profile`).

**Anonymous use works.** Live-verified: a logged-out session accepts a prompt, creates a conversation and gets answers from both battle models. No login is required to complete a run, so `NEEDS_LOGIN` is **not** raised for this target; signing in is optional (it changes nothing the adapter depends on, and the plugin never touches cookies or credentials).

## 2. Login probe

`transport.mjs probe --target arena --json` returns:

| Field | Meaning | Values |
|---|---|---|
| `composer_found` | the `textarea[name="message"]` composer is on the page | `true` / `false` |
| `logged_out` | a `Log In` / `登录` control is visible | `true` / `false` |
| `mode_label` | the current mode control label | typically `Battle Mode` |
| `model_label` | always `null` on this target (see §3) | `null` |
| `model_verifiable` | always `false` on this target | `false` |
| `recaptcha_present` | a reCAPTCHA widget is on the page | `true` / `false` |
| `model_identity` | policy from `targets-table.mjs` | `battle` |

Live-verified sample (logged out, conversation tab open):

```json
{
  "ok": true,
  "logged_out": true,
  "composer_found": true,
  "mode_label": "Battle Mode",
  "model_label": null,
  "model_verifiable": false,
  "recaptcha_present": true,
  "target": "arena",
  "model_identity": "battle"
}
```

`logged_out: true` is **informational here, not a blocker**. Only `composer_found: false` blocks the send phase (`NEEDS_SITE_PERMISSION`: the page did not render a composer — treat an unexpected page as a stop, never as a retry).

## 3. Model probe — read this before promising anything

Arena's default **Battle Mode** sends one prompt to **two randomly chosen anonymous models** and renders them as `助手 A` / `助手 B` (locale-dependent: `Assistant A/B`, `Model A/B`), then asks the user to vote. Consequences the run must honour:

- **Model identity cannot be verified.** There is no visible model name for either answer, and the pairing is randomized per conversation. A receipt for this target must record `web_model_status` as `unverified` — never `verified`.
- **There are two answers, not one.** The fetch phase returns `answers: [{ label, text }, ...]`. Both belong in `browser-evidence.md`; the adoption gate must consider each independently.
- Do **not** silently substitute a model, and do not treat the pair as a single "the model said" source. If the user needs one deterministic, attributable model, they must pick a single-model mode/UI in the visible window (probe's `mode_label` shows what is active) or use a different target (`chatgpt`).

This is why `targets-table.mjs` carries a per-target `models` policy: the honest receipt contract needs it.

## 4. Send procedure

Arena's composer is a **React-controlled `<textarea name="message">`**, not a contenteditable. A synthetic paste event does not update its value (the app owns the value), so this target uses the driver's `insert-text` path instead of the paste path:

1. Build the request file exactly as for any target (the wrapped reasoning request from `references/reasoning-request.md`).
2. Run **exactly one**:

   ```bash
   node <skillDir>/scripts/transport.mjs send --target arena --file <request.txt> --json
   ```

   Internally: a fresh tab opens on the site, the composer is focused, the driver inserts the text through the browser input pipeline (`Input.insertText`), the page verifies the value landed, clicks `button[aria-label="Send message"]` **once**, then waits for the conversation URL / prompt echo.

3. Read the result: `{ ok: true, conversation_url, user_turn_seen, mode_label, input_mode: "insert-text" }`.

`why` codes for this target: `composer-not-found`, `insert-not-reflected` (the textarea did not receive the text — do not retry), `send-control-not-found`, `send-control-disabled`, `send-uncertain`.

**Stop rule:** any non-`ok` result stops the run. Never re-run send; a second click can post a duplicate prompt.

## 5. Fetch procedure

One call against the URL that send returned:

```bash
node <skillDir>/scripts/transport.mjs fetch --url <conversation-url> --out <reply.txt> --json \
  [--screenshot <evidence.png>]
```

- The conversation URL shape is `https://arena.ai/c/<uuid>` (verified live). The driver routes by URL origin, so fetch picks this target's page module automatically.
- The page waits for labelled answers (`助手 A` / `助手 B`), lets the stream settle (no DOM mutations for `stabilityMs` and no stop control), then extracts every labelled answer.
- `extraction: "labelled-answers"` is the normal path; `conversation-dom` means the labels were not found and the visible conversation text was used instead — record whichever value appears.
- Live-verified: `extraction: "labelled-answers"`, `answers: ["助手 A", "助手 B"]`, both replies captured verbatim into `reply.txt`.
- Re-running fetch is allowed (read-only); re-running send is not.

## 6. Blockers

| Status | Trigger |
|---|---|
| `NEEDS_BROWSER` | no debug Chrome on `:9222` (`transport.mjs status` → `running: false`) |
| `NEEDS_SITE_PERMISSION` | `composer_found: false` after `settleMs`; an unexpected/challenge page |
| `NEEDS_MODEL_SELECTION` | the user asked for a specific model — arena's battle mode cannot provide one; switch target or mode |
| `NEEDS_LOGIN` | **not raised for this target** (anonymous runs are supported) |

`recaptcha_present: true` does not by itself block a run (the observed widget did not gate sending), but a challenge that does gate it is a **human step**: ask the user to clear it in the visible window, then re-run the probe. Never attempt to solve or bypass a challenge.

## 7. Evidence

Save the reply (both answers, redacted) as `browser-evidence.md`, optionally with `--screenshot evidence.png`, and bind their SHA-256 in the receipt with `validate.mjs hash`. Record in the receipt:

- `target: "arena"`
- the model status as **unverified** (battle pair, no model identity observable)
- `extraction` and `why_codes` from the fetch result, verbatim
