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

test('apply registers the skill, a prompt section, and the settings namespace', () => {
  const effects = [];
  const registered = [];
  const sections = [];
  const settings = [];
  const injected = [];
  const ctx = {
    effect: (fn, label) => {
      effects.push(label);
      const disposer = fn();
      assert.ok(disposer === undefined || typeof disposer === 'function');
    },
    skills: { register: (skill) => { registered.push(skill); return () => {}; } },
    systemPrompt: { section: (section) => { sections.push(section); } },
    inject: (deps, callback) => {
      injected.push({ deps, callback });
      // dsh 0.2.0：settings 命名空间经作用域注入真正的 settings 服务后注册。
      if (deps.includes('settings')) {
        callback({ settings: { register: (ns, schema) => { settings.push({ ns, schema }); return { get: () => ({}) }; } } });
      }
    },
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
  assert.equal(settings.length, 1);
  assert.equal(settings[0].ns, 'reasoning-bridge');
  assert.ok(settings[0].schema);
  // The settings namespace and the web route surface are both mounted through
  // scoped injections: settings rides the real settings service, the web routes
  // need webServer — a headless profile has neither and must simply never run
  // the web one.
  assert.equal(injected.length, 2);
  assert.deepEqual(injected[0].deps, ['settings']);
  assert.deepEqual(injected[1].deps, ['webServer', 'loader']);
});

test('the settings schema exposes target as a selectable union of known ids', () => {
  const settings = [];
  const ctx = {
    effect: (fn) => { fn(); },
    skills: { register: () => () => {} },
    systemPrompt: { section: () => {} },
    inject: (deps, callback) => {
      if (deps.includes('settings')) callback({ settings: { register: (ns, schema) => { settings.push({ ns, schema }); } } });
    },
  };
  apply(ctx);
  const schema = settings[0].schema;
  const resolved = schema({});
  assert.equal(resolved.target, 'chatgpt', 'default target');
  // A union of literals is an enum: unknown ids are rejected instead of being
  // silently stored as free text.
  assert.equal(schema({ target: 'arena' }).target, 'arena');
  assert.throws(() => schema({ target: 'agora' }), /target/);
});

test('the scoped injection mounts the loopback routes that the panel calls', async () => {
  const routes = [];
  const injected = [];
  const ctx = {
    effect: (fn) => { fn(); },
    skills: { register: () => () => {} },
    systemPrompt: { section: () => {} },
    settings: { register: () => {} },
    inject: (deps, callback) => {
      injected.push({ deps, callback });
      if (deps.includes('webServer')) {
        callback({
          effect: (fn) => { fn(); },
          loader: { entries: () => [] },
          webServer: { register: (route) => { routes.push(route); } },
        });
      }
    },
  };
  apply(ctx);
  assert.equal(routes.length, 1, 'the web routes are registered through the scoped injection');
  assert.equal(routes[0].path, '/reasoning-bridge');
  assert.equal(routes[0].kind, 'prefix');

  const call = async ({ method = 'GET', url = '/', host = '127.0.0.1:3080', remote = '127.0.0.1', body } = {}) => {
    const chunks = [];
    const req = {
      method,
      url,
      headers: { host },
      socket: { remoteAddress: remote },
      on: (event, handler) => {
        if (event === 'data' && body !== undefined) handler(Buffer.from(body));
        if (event === 'end') handler();
        return req;
      },
    };
    let status = 0;
    let payload = '';
    const res = {
      writeHead: (code) => { status = code; },
      end: (text) => { payload = text ?? ''; },
    };
    await routes[0].handler(req, res);
    return { status, payload };
  };

  // Non-loopback callers are refused before anything else happens.
  const foreign = await call({ remote: '10.0.0.9' });
  assert.equal(foreign.status, 403);
  // An unknown path is a clean 404 from the mounted handler.
  const unknown = await call({ url: '/reasoning-bridge/nope' });
  assert.equal(unknown.status, 404);
  // Target switching validates against the shared table without shelling out.
  const badTarget = await call({
    method: 'POST',
    url: '/reasoning-bridge/target',
    headers: { host: '127.0.0.1:3080' },
    body: JSON.stringify({ target: 'agora' }),
  });
  assert.equal(badTarget.status, 400);
  assert.match(badTarget.payload, /unknown target/);
  assert.match(badTarget.payload, /chatgpt/);
  assert.match(badTarget.payload, /arena/);
});
