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
  assert.match(patch, /^\s+name: dsh-reasoning-bridge\s*$/m);
});
