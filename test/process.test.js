import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/process.js';

test('process preserves argv and input without shell expansion', async () => {
  const result = await execute(
    process.execPath,
    [
      '-e',
      'process.stdin.pipe(process.stdout); console.error(process.argv[1])',
      '$(echo unsafe)',
    ],
    { input: 'hello', timeoutMs: 2000 },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'hello');
  assert.equal(result.stderr.trim(), '$(echo unsafe)');
});

test('timeout terminates descendants that keep inherited output pipes open', async () => {
  const started = Date.now();
  const result = await execute(
    process.execPath,
    [
      '-e',
      "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit'}); setInterval(()=>{},1000)",
    ],
    { timeoutMs: 100 },
  );
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 3000);
});

test('missing executable and invalid timeout are explicit failures', async () => {
  await assert.rejects(
    execute('/missing/token-bench-executable', [], { timeoutMs: 100 }),
    /ENOENT/,
  );
  await assert.rejects(
    execute(process.execPath, [], { timeoutMs: 0 }),
    /timeoutMs/,
  );
});
