import { mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';

export async function prepareScenarioState(output) {
  if (!path.isAbsolute(output)) throw new Error('Absolute output required');
  const state = path.join(output, 'codex-home');
  await mkdir(state, { mode: 0o700 });
  await assertScenarioState(state);
  return state;
}

export async function assertScenarioState(state) {
  const info = await lstat(state);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700)
    throw new Error('Scenario state must remain a private directory');
}
