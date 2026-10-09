/**
 * dsh-reasoning-bridge: hand high-cost reasoning to a web AI (ChatGPT first,
 * multi-target), while dsh keeps local evidence, the adoption gate, edits,
 * and tests. Registers one model-invocable runtime skill whose SKILL.md is the
 * single workflow entry; references/ and scripts/ ride alongside it and are
 * resolved through the skill's resourceBase.
 *
 * Zero dependencies, zero build: lib/ + skills/ are the shipped artifact.
 * @module dsh-reasoning-bridge
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
import { TARGETS } from '../skills/reasoning-bridge/scripts/targets-table.mjs';
import { apply as applyWebRoutes } from './web.js';

export const name = 'dsh-reasoning-bridge';
export const inject = ['skills', 'systemPrompt', 'settings'];

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'reasoning-bridge');

const PROMPT_TEXT = `## Reasoning Bridge (skill)
For tasks with an unclear root cause, several plausible designs, or a high-cost decision, the
reasoning-bridge skill can hand one bounded, sanitized Context Packet to a web AI (ChatGPT first;
target configurable) through its bundled browser transport (scripts/transport.mjs, attached to
dsh's debug Chrome), then verify and execute every proposal locally. Never trigger it for quota
reasons; mechanical edits and already-decided plans stay local.
Load it with the skill tool before any browser action toward the configured target.`;

// Settings panel namespace (rendered automatically by the dsh settings UI,
// persisted to ~/.dsh/settings.yaml under `reasoning-bridge:`). Field names
// must stay in sync with skills/.../scripts/lib/settings-bridge.mjs — a test
// asserts the name set matches. Keep descriptions user-facing and precise.
// dsh-settings resolves schemas by calling them: schema(merged) — schemastery
// shape, not zod.
const SettingsSchema = Schema.object({
    // A union of the known target ids renders as a select in the settings panel
    // (and in any schema-driven UI), so the target is a visible choice instead
    // of a free-text field that silently falls back to the default on a typo.
    // The list comes from targets-table.mjs — one source of truth for ids,
    // sites and model-identity policy.
    target: Schema.union(TARGETS.map((entry) => entry.id)).default('chatgpt')
        .description(`Web AI target site for the reasoning handoff (one of: ${TARGETS.map((entry) => `${entry.id} = ${entry.site}`).join('; ')}).`),
    composerWaitMs: Schema.number().min(1000).max(60000).default(12000)
        .description('Send phase: how long to wait for the chat composer to appear, in ms.'),
    sendWaitMs: Schema.number().min(500).max(30000).default(4000)
        .description('Send phase: how long to wait for the visible send control after pasting, in ms.'),
    urlWaitMs: Schema.number().min(3000).max(120000).default(15000)
        .description('Send phase: how long to wait for the user turn to appear after clicking send, in ms.'),
    appearTimeoutMs: Schema.number().min(5000).max(120000).default(30000)
        .description('Fetch phase: how long to wait for the assistant message to appear, in ms.'),
    streamTimeoutMs: Schema.number().min(15000).max(600000).default(150000)
        .description('Fetch phase: upper bound on waiting for the reply to finish streaming, in ms.'),
    stabilityMs: Schema.number().min(100).max(60000).default(2500)
        .description('Fetch phase: how long the page must stay unchanged before the reply is considered done, in ms.'),
    checkNodeRuntime: Schema.boolean().default(true)
        .description('Refuse to run the transport driver on Node < 22 (it needs the native WebSocket). Turn off only for experiments.'),
});

/** Parse a minimal `key: value` frontmatter block; returns { meta, body }. */
export function splitFrontmatter(text) {
    const normalized = text.replace(/\r\n?/g, '\n');
    if (!normalized.startsWith('---\n')) return { meta: {}, body: normalized };
    const end = normalized.indexOf('\n---', 4);
    if (end === -1) return { meta: {}, body: normalized };
    const meta = {};
    for (const line of normalized.slice(4, end).split('\n')) {
        const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
        if (match) meta[match[1]] = match[2].trim();
    }
    return { meta, body: normalized.slice(end + 4).replace(/^\n+/, '') };
}

export function apply(ctx) {
    let raw;
    try {
        raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    } catch (error) {
        throw new Error(
            `dsh-reasoning-bridge: cannot read ${join(SKILL_DIR, 'SKILL.md')} (${error.message}); `
            + 'the plugin install looks broken — reinstall it with `dsh plugin add`.',
        );
    }
    const { meta, body } = splitFrontmatter(raw);
    const skillName = typeof meta.name === 'string' && meta.name !== '' ? meta.name : 'reasoning-bridge';
    const description = typeof meta.description === 'string' && meta.description !== ''
        ? meta.description
        : 'Hand bounded, high-cost reasoning to a web AI while dsh keeps local evidence, edits, and tests.';
    ctx.effect(() => ctx.skills.register({
        name: skillName,
        description,
        whenToUse: meta.whenToUse,
        source: 'runtime',
        content: body,
        resourceBase: { kind: 'directory', path: SKILL_DIR },
    }), 'dsh-reasoning-bridge.skill');
    ctx.effect(() => ctx.systemPrompt.section({
        name: 'skill:dsh-reasoning-bridge',
        order: 118,
        text: PROMPT_TEXT,
    }), 'dsh-reasoning-bridge.prompt');
    // dsh 0.2.0：声明式注入的 `settings` 已是 settings-controller 的宿主服务（没有
    // register），须像 dsh-settings 自带的 legacy 垫片那样经 ctx.inject 解析到真正的
    // settings 服务再注册；register 自管生命周期，回调无需返回 disposer。
    ctx.inject(['settings'], (sctx) => {
        sctx.settings.register('reasoning-bridge', SettingsSchema);
    });
    // Web-only surface (the settings panel's link card routes). Mounted through
    // a SCOPED injection rather than a bundle-patch row: the callback runs only
    // once a webServer service exists, so a headless/CLI profile simply never
    // runs it and no root-level row is left pending waiting for a service that
    // profile will never provide. This is what keeps the panel's buttons from
    // 404-ing on a plain `dsh plugin add` install.
    ctx.inject(['webServer', 'loader'], (webCtx) => {
        applyWebRoutes(webCtx);
    });
}
