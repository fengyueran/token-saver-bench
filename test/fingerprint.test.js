import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fingerprint } from '../src/fingerprint.js';

test('file fingerprint is deterministic for nested files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'real-dev-fingerprint-'));
  try {
    await mkdir(path.join(directory, 'nested'));
    await writeFile(path.join(directory, 'nested', 'x.txt'), 'x');
    const first = await fingerprint(directory);
    assert.match(first['nested/x.txt'], /^[a-f0-9]{64}$/);
    assert.deepEqual(await fingerprint(directory), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
