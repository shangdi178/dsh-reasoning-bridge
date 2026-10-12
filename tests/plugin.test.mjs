import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { apply, name, splitFrontmatter } from '../lib/index.js';
import { SETTINGS_DEFAULTS } from '../skills/reasoning-bridge/scripts/lib/settings-bridge.mjs';

/**
 * The settings schema is built from the host's schemastery, which only exists
 * inside a dsh installation — a CI checkout has no node_modules. Tests that
 * exercise the settings callback therefore materialize a tiny stand-in package
 * at <repo>/node_modules/@deepseek-ai/schemastery, which is exactly where
 * lib/index.js's createRequire(import.meta.url) resolves it from. node_modules
 * is gitignored, so this never touches the tree; removed again in `finally`.
 *
 * The stand-in implements the chain the plugin uses (object / union / number /
 * boolean, .default/.min/.max/.description, call-as-resolver) well enough to
 * assert the real contract: defaults, union rejection, field set.
 */
async function withSchemasteryStub(fn) {
  const stubRoot = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'node_modules', '@deepseek-ai', 'schemastery');
  const created = { dirs: 0, package: false, index: false };
  try {
    await mkdir(stubRoot, { recursive: true });
    created.dirs += 1;
    await writeFile(join(stubRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/schemastery', version: '0.0.0-stub', type: 'module', main: './index.cjs', exports: { '.': './index.cjs' } }), 'utf8');
    created.package = true;
    await writeFile(join(stubRoot, 'index.cjs'), SCHEMASTERY_STUB_CJS, 'utf8');
    created.index = true;
    await fn();
  } finally {
    // Only remove what we created; a real installation may own this directory.
    if (created.index) { await rm(join(stubRoot, 'index.cjs'), { force: true }); }
    if (created.package) { await rm(join(stubRoot, 'package.json'), { force: true }); }
    if (created.dirs) { await rm(stubRoot, { recursive: true, force: true }); }
  }
}

const SCHEMASTERY_STUB_CJS = `
'use strict';
function resolve(schema, input) {
  input = input || {};
  if (schema.kind === 'union') {
    const picked = input.target;
    if (picked !== undefined && schema.options.indexOf(picked) === -1) {
      throw new Error('invalid target: ' + picked);
    }
    return picked !== undefined ? picked : schema.defaultV;
  }
  if (schema.kind === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(schema.fields)) {
      // A field value may itself be a chained node (union/number/boolean with
      // defaults); resolving it yields its default when input has no override.
      out[key] = typeof child === 'function' ? child(input[key] !== undefined ? { target: input[key] } : {}) : child;
    }
    return out;
  }
  return input;
}
function callable(node) {
  const fn = (...args) => resolve(node, args[0]);
  fn.default = (d) => callable(Object.assign({}, node, { defaultV: d }));
  fn.min = (m) => callable(Object.assign({}, node, { minV: m }));
  fn.max = (m) => callable(Object.assign({}, node, { maxV: m }));
  fn.description = () => fn;
  return fn;
}
module.exports = {
  object: (fields) => callable({ kind: 'object', fields }),
  union: (options) => callable({ kind: 'union', options }),
  number: () => callable({ kind: 'number' }),
  boolean: () => callable({ kind: 'boolean' }),
};
`;

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

test('apply registers the skill, a prompt section, and the settings namespace', async () => {
  await withSchemasteryStub(() => {
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
});

test('the settings schema exposes target as a selectable union of known ids', async () => {
  await withSchemasteryStub(() => {
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
    // The declared field set stays in sync with settings-bridge.mjs (defaults).
    for (const field of Object.keys(SETTINGS_DEFAULTS)) {
      assert.ok(resolved[field] !== undefined, `schema must expose ${field}`);
    }
  });
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

  // /open drives the browser, so the consent gate runs before anything else. Pin
  // the decision to a temp home: asserting 403 against whatever this machine
  // happens to have consented to made the test pass only on a fresh install.
  const gateHome = await mkdtemp(join(tmpdir(), 'bridge-gate-'));
  const previousHome = process.env.DSH_REASONING_BRIDGE_HOME;
  process.env.DSH_REASONING_BRIDGE_HOME = gateHome;
  try {
    const blockedOpen = await call({
      method: 'POST',
      url: '/reasoning-bridge/open',
      body: JSON.stringify({ target: 'chatgpt' }),
    });
    assert.equal(blockedOpen.status, 403);
    assert.match(blockedOpen.payload, /consent/i);

    const blockedProbe = await call({ method: 'POST', url: '/reasoning-bridge/probe' });
    assert.equal(blockedProbe.status, 403);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_REASONING_BRIDGE_HOME;
    else process.env.DSH_REASONING_BRIDGE_HOME = previousHome;
    await rm(gateHome, { recursive: true, force: true });
  }
});

test('the Host guard accepts the port the server is actually listening on', async () => {
  // Regression: webPort() used to read the loader entry only. A profile whose
  // port is an `!!js` expression leaves a function there, the lookup fell back
  // to 3080, and every route 403'd against the real Host header.
  const routes = [];
  const ctx = {
    effect: (fn) => { fn(); },
    skills: { register: () => () => {} },
    systemPrompt: { section: () => {} },
    settings: { register: () => {} },
    inject: (deps, callback) => {
      if (deps.includes('webServer')) {
        callback({
          effect: (fn) => { fn(); },
          // A `!!js` port expression: the entry carries a function, not a number.
          loader: { entries: () => [{ options: { name: '@deepseek-ai/dsh-host-webserver', config: { port: () => 38080 } } }] },
          webServer: { register: (route) => { routes.push(route); } },
        });
      }
    },
  };
  apply(ctx);

  const call = async ({ host, localPort }) => {
    const req = {
      method: 'GET',
      url: '/reasoning-bridge/state',
      headers: { host },
      socket: { remoteAddress: '127.0.0.1', localPort },
      on: () => req,
    };
    let status = 0;
    const res = { writeHead: (code) => { status = code; }, end: () => {} };
    await routes[0].handler(req, res);
    return status;
  };

  assert.equal(await call({ host: '127.0.0.1:38080', localPort: 38080 }), 200, 'the real listening port must pass');
  assert.equal(await call({ host: 'localhost:38080', localPort: 38080 }), 200);
  assert.equal(await call({ host: 'evil.example.com', localPort: 38080 }), 403, 'foreign Host still refused');
});
