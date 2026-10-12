import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execute } from '../src/process.js';

test('formal CLI previews hash-bound evidence and refuses test-only startup', async () => {
 const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
 const directory = await mkdtemp(path.join(root, 'runs', 'campaign-cli-test-'));
 try {
  const proof = '{}';
  await writeFile(path.join(directory, 'proof.json'), proof, { mode: 0o600 });
  const evidence = `${path.relative(root, path.join(directory, 'proof.json'))}#${createHash('sha256').update(proof).digest('hex')}`;
  const ready = { status: 'ready', evidence };
  const groups = { 'httpie-diagnosis': ['caveman', 'codegraph'], 'memos-bulk-archive': ['ponytail'], 'httpie-iteration': ['headroom', 'rtk'] };
  const tasks = Object.fromEntries(Object.entries(groups).map(([scenario, arms]) => [scenario, {
   independentAcceptance: ready, tools: Object.fromEntries(arms.map(arm => [arm, { status: 'excluded', reason: 'Fixture only', evidence }]))
  }]));
  const file = path.join(directory, 'readiness.json');
  await writeFile(file, JSON.stringify({ source: 'test-only', environments: { codex: { metering: ready, historyIsolation: ready, identityFrozen: ready, tasks } } }), { mode: 0o600 });
  const preview = await execute(process.execPath, ['bin/campaign.js', 'plan', file], { cwd: root });
  assert.equal(preview.code, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).formalReady, false);
  const start = await execute(process.execPath, ['bin/campaign.js', 'start', file], { cwd: root });
  assert.notEqual(start.code, 0);
  assert.match(start.stderr, /verified/);
  const unsafe = await execute(process.execPath, ['bin/campaign.js', 'resume', '../outside'], { cwd: root });
  assert.notEqual(unsafe.code, 0);
  assert.match(unsafe.stderr, /campaign id/);
 } finally { await rm(directory, { recursive: true }); }
});
