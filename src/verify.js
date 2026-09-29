import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execute } from './process.js';
import { getTask } from './tasks.js';

export async function fingerprint(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await fingerprint(file);
      for (const [key, value] of Object.entries(nested))
        result[`${entry.name}/${key}`] = value;
    } else if (entry.isFile())
      result[entry.name] = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
    else throw new Error(`Unsupported file type: ${entry.name}`);
  }
  return result;
}

export async function verifyTask(root, workspace, task) {
  const exploration = getTask(task).kind === 'structured-code-exploration';
  const verifier = exploration ? 'exploration' : task;
  const contract = await execute(
    process.execPath,
    [path.join(root, `verifiers/${verifier}.cjs`), workspace, task],
    { timeoutMs: 10000 },
  );
  const source = path.join(root, '.cache/fixtures/koa');
  if (exploration) {
    const unchanged =
      JSON.stringify(await fingerprint(path.join(source, 'lib'))) ===
      JSON.stringify(await fingerprint(path.join(workspace, 'lib')));
    return {
      contract,
      sourceUnchanged: unchanged,
      passed: contract.code === 0 && !contract.timedOut && unchanged,
      explanationReview: 'pending',
    };
  }
  const parent = await mkdtemp(path.join(tmpdir(), 'token-regression-'));
  const independent = path.join(parent, 'workspace');
  try {
    await cp(source, independent, {
      recursive: true,
      filter: (file) => path.basename(file) !== '.git',
    });
    await rm(path.join(independent, 'lib'), { recursive: true });
    await cp(path.join(workspace, 'lib'), path.join(independent, 'lib'), {
      recursive: true,
    });
    const regression = await execute(
      process.execPath,
      [
        '--require',
        path.join(root, 'verifiers/loopback.cjs'),
        '--test',
        '--test-concurrency=1',
      ],
      { cwd: independent, env: { PATH: process.env.PATH }, timeoutMs: 60000 },
    );
    return {
      contract,
      regression,
      passed:
        contract.code === 0 &&
        !contract.timedOut &&
        regression.code === 0 &&
        !regression.timedOut,
    };
  } finally {
    await rm(parent, { recursive: true });
  }
}
