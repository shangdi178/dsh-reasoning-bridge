# Run Receipt

Create this JSON locally after result validation and local execution. The web AI must not fill or edit it.

The receipt is redacted metadata. It may contain artifact paths, hashes, sizes, statuses, and current UI evidence; it must not contain raw packet or result content. The saved result remains untrusted third-party content.

```json
{
  "schema_version": 2,
  "packet_id": "<matching id>",
  "target": "<configured target id, e.g. chatgpt>",
  "artifacts": {
    "packet": {"path": "<path>", "sha256": "<64 hex>", "approximate_tokens": 1800},
    "result": {"path": "<path>", "sha256": "<64 hex>"},
    "browser_evidence": {"path": "<path>", "sha256": "<64 hex>"}
  },
  "local_model": {
    "requested": "<dsh chat model id>",
    "observed": "<locally visible model or null>",
    "status": "verified|unverified",
    "evidence": "<local runtime evidence>"
  },
  "web_model": {
    "requested": "<model the user required>",
    "observed": "<visible selector label or null>",
    "status": "verified|unverified",
    "evidence": "<visible browser evidence>",
    "preflight_visible": true,
    "postflight_visible": true
  },
  "privacy_review": {
    "scope_minimized": true,
    "credentials_scan_passed": true,
    "semantic_privacy_reviewed": true,
    "raw_diff_excluded": true,
    "unrelated_files_excluded": true
  },
  "browser_transport": "verified|failed",
  "packet_validation": "passed|failed|not_run",
  "result_validation": "passed|failed|not_run",
  "pair_validation": "passed|failed|not_run",
  "local_revalidation": "passed|failed|not_run",
  "adoption": {
    "status": "passed|failed|not_run",
    "accepted": [{"id": "<short id>", "proposal": "<what the web AI suggested>", "local_evidence": "<file:symbol you reopened>"}],
    "rejected": [{"id": "<short id>", "proposal": "<...>", "reason": "<local evidence that contradicts it>"}],
    "deferred": [{"id": "<short id>", "proposal": "<...>", "reason": "<what authority or input is needed>"}],
    "local_evidence": ["<every anchor you reopened, as file:symbol>"]
  },
  "local_changes": {
    "status": "applied|no_changes_needed|failed|not_run",
    "reason": "<required>"
  },
  "tests": "passed|failed|not_run"
}
```

Validate structure or require full completion:

```bash
node <skillDir>/scripts/validate.mjs receipt /path/to/receipt.json
node <skillDir>/scripts/validate.mjs complete /path/to/receipt.json
```

`verified` requires a non-empty observed model and local evidence. Web completion also requires preflight and postflight model visibility. The `complete` gate requires both models verified, every privacy field true, browser transport verified, adoption passed, local changes resolved, every local check passed, and recomputed artifact hashes matching the receipt — and it **re-runs the credential scan on each artifact it hashes**, so a self-declared `credentials_scan_passed` is not enough. The adoption record must classify at least one proposal, record at least one local anchor, and give **every accepted item its own `local_evidence`**; one global string no longer satisfies the whole record.

What the gate still cannot do: confirm that an anchor names a real file or symbol, or that you actually reopened it. It checks that the record is *shaped* like honest work, not that the work happened.

Run it from the run directory so relative artifact paths resolve. Store receipts under `~/.dsh/dsh-reasoning-bridge/runs/<packet_id>/` (or the run directory you created there) — never inside the repository. SHA-256 binds the local artifacts for reproducibility; it is not remote model attestation.
