import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, name, splitFrontmatter } from '../lib/index.js';

test('splitFrontmatter parses meta and strips body', () => {
  const { meta, body } = splitFrontmatter('---\nname: reasoning-bridge\ndescription: test skill\n---\n\n# Body\n');
  assert.equal(meta.name, 'reasoning-bridge');
  assert.equal(meta.description, 'test skill');
  assert.equal(body, '# Body\n');
});

test('splitFrontmatter passes through text without frontmatter', () => {
  const { meta, body } = splitFrontmatter('# Just body');
  assert.deepEqual(meta, {});
  assert.equal(body, '# Just body');
});

test('apply registers the skill and a prompt section via ctx.effect', () => {
  const effects = [];
  const registered = [];
  const sections = [];
  const ctx = {
    effect: (fn, label) => {
      effects.push(label);
      const disposer = fn();
      assert.ok(disposer === undefined || typeof disposer === 'function');
    },
    skills: { register: (skill) => { registered.push(skill); return () => {}; } },
    systemPrompt: { section: (section) => { sections.push(section); } },
  };
  apply(ctx);
  assert.deepEqual(effects, ['dsh-reasoning-bridge.skill', 'dsh-reasoning-bridge.prompt']);
  assert.equal(name, 'dsh-reasoning-bridge');
  assert.equal(registered.length, 1);
  const skill = registered[0];
  assert.equal(skill.name, 'reasoning-bridge');
  assert.equal(skill.source, 'runtime');
  assert.equal(skill.resourceBase.kind, 'directory');
  assert.match(skill.resourceBase.path, /skills[\\/]reasoning-bridge$/);
  assert.ok(skill.content.includes('## Workflow'));
  assert.ok(skill.content.includes('references/transport-<target>.md'));
  assert.ok(skill.description.length > 10);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].order, 118);
  assert.ok(sections[0].text.includes('reasoning-bridge'));
});
