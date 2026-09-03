import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CONSENT_SCHEMA_VERSION,
  DISCLOSURE_VERSION,
  RISK_ACKNOWLEDGEMENT,
  consentStatus,
  defaultConsentPath,
  writeConsentDecision,
} from '../skills/reasoning-bridge/scripts/consent.mjs';

test('default path lives under ~/.dsh/dsh-reasoning-bridge, override honored', () => {
  assert.match(defaultConsentPath(), /dsh-reasoning-bridge[\\/]consent\.json$/);
  assert.equal(
    defaultConsentPath({ DSH_REASONING_BRIDGE_HOME: 'C:/tmp/bridge' }),
    join('C:/tmp/bridge', 'consent.json'),
  );
});

test('missing state needs consent', async () => {
  const status = await consentStatus(join(tmpdir(), `bridge-missing-${Date.now()}`, 'consent.json'));
  assert.equal(status.status, 'NEEDS_AUTOMATION_CONSENT');
  assert.equal(status.reason, 'missing_state');
});

test('enable requires the exact acknowledgement token; write flows round-trip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-consent-'));
  try {
    const stateFile = join(dir, 'consent.json');
    assert.equal((await writeConsentDecision(stateFile, true)).status, 'READY');
    const written = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(written.schema_version, CONSENT_SCHEMA_VERSION);
    assert.equal(written.disclosure_version, DISCLOSURE_VERSION);
    assert.equal(written.browser_automation_enabled, true);
    assert.equal((await writeConsentDecision(stateFile, false)).status, 'AUTOMATION_DISABLED');
    assert.equal((await consentStatus(stateFile)).reason, 'user_disabled');
    assert.ok(RISK_ACKNOWLEDGEMENT.endsWith('_V1'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid and stale states are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-consent-'));
  try {
    const bad = join(dir, 'bad.json');
    await writeConsentDecision(bad, true);
    const raw = JSON.parse(await readFile(bad, 'utf8'));
    await (await import('node:fs/promises')).writeFile(bad, JSON.stringify({ ...raw, schema_version: 99 }));
    assert.equal((await consentStatus(bad)).status, 'NEEDS_AUTOMATION_CONSENT');
    const stale = join(dir, 'stale.json');
    await (await import('node:fs/promises')).writeFile(stale, JSON.stringify({ ...raw, disclosure_version: DISCLOSURE_VERSION + 1 }));
    const status = await consentStatus(stale);
    assert.equal(status.status, 'NEEDS_AUTOMATION_CONSENT');
    assert.equal(status.reason, 'stale_disclosure');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
