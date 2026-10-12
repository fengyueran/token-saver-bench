import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod, symlink, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareScenarioState, assertScenarioState } from '../src/scenario-state.js';

test('scenario state is private, fresh and rejects replacement or widened permissions', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'scenario-state-'));
  try {
    await assert.rejects(prepareScenarioState('relative'), /Absolute/);
    const state = await prepareScenarioState(output);
    assert.equal(state, path.join(output, 'codex-home'));
    assert.equal((await stat(state)).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(state), []);
    await assertScenarioState(state);
    await assert.rejects(prepareScenarioState(output), { code: 'EEXIST' });
    await chmod(state, 0o755);
    await assert.rejects(assertScenarioState(state), /private directory/);
    await rm(state, { recursive: true });
    await symlink(tmpdir(), state);
    await assert.rejects(assertScenarioState(state), /private directory/);
  } finally { await rm(output, { recursive: true, force: true }); }
});
