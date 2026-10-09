// Single source of truth for transport targets (id + site URL), shared by
// target.mjs (state), validate.mjs (receipt check) and the settings schema so
// none of them can drift. Adding a target = one row here + lib/page-<id>.mjs +
// references/transport-<id>.md.
//
// `models` records what the site does with model identity, because the receipt
// contract requires an honest model status per target:
//   'selectable'  — the UI exposes a single user-chosen model (verify + record)
//   'battle'      — the site hands the prompt to two randomly chosen anonymous
//                   models (Arena AI): identity cannot be verified, so a run
//                   against it can never report a verified web model.
export const TARGETS = [
  { id: 'chatgpt', site: 'https://chatgpt.com/', models: 'selectable' },
  { id: 'arena', site: 'https://arena.ai/', models: 'battle' },
];

export const TARGET_IDS = new Set(TARGETS.map((target) => target.id));

export function siteFor(targetId) {
  const target = TARGETS.find((entry) => entry.id === targetId);
  return target ? target.site : null;
}

/** Model-identity behaviour of a target ('selectable' | 'battle' | null). */
export function modelsFor(targetId) {
  const target = TARGETS.find((entry) => entry.id === targetId);
  return target ? target.models ?? null : null;
}
