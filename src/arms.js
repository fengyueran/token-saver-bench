import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ponytailCommit = 'e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156';

export async function instructionArm(root, arm) {
  if (arm === 'baseline')
    return { instructions: '', evidence: { kind: 'none' } };
  if (arm !== 'ponytail') throw new Error(`Arm not ready: ${arm}`);
  const source = path.join(root, '.cache/tools/ponytail');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
  }).trim();
  if (commit !== ponytailCommit)
    throw new Error('Tool commit mismatch');
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: source, encoding: 'utf8' },
  );
  if (dirty.trim()) throw new Error('Tool source has tracked modifications');
  const instructions = require(
    path.join(source, 'hooks/ponytail-instructions.js'),
  ).getPonytailInstructions('full');
  return {
    instructions,
    evidence: {
      kind: 'forced-original-instructions',
      mode: 'full',
      commit,
      instructionSha256: createHash('sha256')
        .update(instructions)
        .digest('hex'),
      instructionBytes: Buffer.byteLength(instructions),
      behavioralCompliance: 'requires-trace-review',
    },
  };
}
