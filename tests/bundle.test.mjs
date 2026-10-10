// Packaging contract guard, adapted from the `fix/dsh-bundle-manifest` branch.
//
// That branch existed because the published package did not declare a DSH bundle
// at all, so `dsh plugin add` installed files nobody mounted. The declaration now
// exists; this test keeps it from silently disappearing again, and extends the
// original checks to the entry points and bundle patch this tree actually ships.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('published package declares a DSH bundle with its existing plugin entry', async () => {
  const pkg = JSON.parse(await readProjectFile('package.json'));
  assert.equal(pkg.main, './lib/index.js');
  assert.deepEqual(pkg.dsh?.bundle, { patch: './cordis.patch.yml' });
  assert.ok(pkg.files.includes('lib'));
  assert.ok(pkg.files.includes('skills'));
  assert.ok(pkg.files.includes('cordis.patch.yml'));

  const patch = await readProjectFile('cordis.patch.yml');
  assert.match(patch, /^- insert:\s*$/m);
  assert.match(patch, /^\s+- id: dsh-reasoning-bridge\s*$/m);
  assert.match(patch, /^\s+name: '?dsh-reasoning-bridge'?\s*$/m);
});

test('every declared entry point ships in the package', async () => {
  // `exports` is what the host resolves; a subpath pointing at a file outside
  // `files` would publish a broken import for anyone installing from npm.
  // package.json itself is always published by npm, whatever `files` says.
  const pkg = JSON.parse(await readProjectFile('package.json'));
  const covered = (relative) => relative === 'package.json'
    || pkg.files.some((entry) => relative === entry || relative.startsWith(`${entry}/`));
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    assert.ok(covered(target.replace(/^\.\//, '')), `exports["${subpath}"] -> ${target} is outside the files whitelist`);
  }
  // The client bundle is advertised through dsh.client, so it must ship too.
  assert.equal(pkg.dsh?.client?.platform, 'web');
  assert.ok(covered('lib/client.js'));
  assert.ok(covered('lib/web.js'));
});

test('the bundle patch never mounts the web-only route entry at the root', async () => {
  // lib/web.js requires the webServer service. A root-level row would sit
  // "pending waiting for service" in a headless profile; the main entry mounts
  // it through a scoped injection instead. Guard that decision.
  const patch = await readProjectFile('cordis.patch.yml');
  assert.doesNotMatch(patch, /name:\s*'?dsh-reasoning-bridge\/web'?/, 'the web entry must not be inserted at the root');
  const main = await readProjectFile('lib/index.js');
  assert.match(main, /ctx\.inject\(\[\s*'webServer'/, 'lib/index.js must mount the web routes through a scoped injection');
});
