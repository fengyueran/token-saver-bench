import { cp, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fingerprint } from './fingerprint.js';

export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const saveJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

export async function businessIdentity(workspace) {
  return fingerprint(path.join(workspace, 'httpie'));
}

export async function saveStageSnapshot(workspace, directory) {
  const identity = await businessIdentity(workspace);
  const snapshot = path.join(directory, 'snapshot');
  await mkdir(snapshot, { mode: 0o700 });
  await cp(path.join(workspace, 'httpie'), path.join(snapshot, 'httpie'), { recursive: true });
  const copied = await businessIdentity(snapshot);
  if (digest(copied) !== digest(identity)) throw new Error('Snapshot changed during copy');
  await saveJson(path.join(directory, 'snapshot-identity.json'), { sha256: digest(identity), files: identity });
  return { snapshot, snapshotSha256: digest(identity) };
}

export function diagnosisTrackedUnchanged(workspace, commit) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspace, encoding: 'utf8' });
  const changes = status.split('\n').filter(Boolean).filter((line) => {
    const file = line.slice(3);
    return !line.startsWith('?? ') || !['.cache/', '.venv/', '.codegraph/'].some((prefix) => file.startsWith(prefix));
  });
  return head === commit && !changes.length;
}
