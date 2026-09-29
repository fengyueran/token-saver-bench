import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/process.js';
import { prepareFixture, validationGuard } from '../src/fixture.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('held-out verifier rejects seeded regression and accepts the original guard', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'token-bench-fixture-'));
  const workspace = path.join(parent, 'workspace');
  await prepareFixture(
    path.join(root, '.cache/fixtures/koa'),
    workspace,
    'repair-validation',
  );
  const args = [path.join(root, 'verifiers/repair-validation.cjs'), workspace];
  const red = await execute(process.execPath, args, { timeoutMs: 5000 });
  assert.notEqual(red.code, 0);
  assert.match(red.stderr, /ERR_ASSERTION/);
  assert.match(red.stderr, /middleware must be a function!/);
  const file = path.join(workspace, 'lib/application.js');
  const content = await readFile(file, 'utf8');
  await writeFile(
    file,
    content.replace('  use (fn) {\n', `  use (fn) {\n${validationGuard}`),
  );
  const green = await execute(process.execPath, args, { timeoutMs: 5000 });
  assert.equal(green.code, 0, green.stderr);
});
