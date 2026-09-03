# Changelog

## 0.1.0 — 2026-09-05

Initial release.

- Runtime skill `reasoning-bridge` (SKILL.md workflow + 8 reference contracts)
- Deterministic validators: `validate.mjs` (packet / result / pair / receipt / complete / hash),
  `consent.mjs` (versioned risk consent), `doctor.mjs` (install self-check),
  `target.mjs` (multi-target selection, chatgpt first)
- SHA-256 run receipts with privacy-review fields and a deterministic completion gate
- Zero dependencies, zero build; 22 node:test cases
