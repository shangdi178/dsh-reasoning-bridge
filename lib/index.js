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

export const name = 'dsh-reasoning-bridge';
export const inject = ['skills', 'systemPrompt'];

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'reasoning-bridge');

const PROMPT_TEXT = `## Reasoning Bridge (skill)
For tasks with an unclear root cause, several plausible designs, or a high-cost decision, the
reasoning-bridge skill can hand one bounded, sanitized Context Packet to a web AI (ChatGPT first;
target configurable) through dsh's own browser tools, then verify and execute every proposal
locally. Never trigger it for quota reasons; mechanical edits and already-decided plans stay local.
Load it with the skill tool before any browser action toward the configured target.`;

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
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
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
}
