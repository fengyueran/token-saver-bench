import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

export async function instructionArm(root, arm) {
  if (arm === 'baseline')
    return { instructions: '', evidence: { kind: 'none' } };
  if (!['caveman', 'ponytail'].includes(arm))
    throw new Error(`Arm not ready: ${arm}`);
  const source = path.join(root, '.cache/tools', arm);
  const locks = JSON.parse(
    await readFile(path.join(root, 'config/sources-lock.json'), 'utf8'),
  );
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
  }).trim();
  if (commit !== locks.tools[arm].commit)
    throw new Error('Tool commit mismatch');
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: source, encoding: 'utf8' },
  );
  if (dirty.trim()) throw new Error('Tool source has tracked modifications');
  const instructions =
    arm === 'caveman'
      ? (
          await readFile(path.join(source, 'skills/caveman/SKILL.md'), 'utf8')
        ).replace(/^---[\s\S]*?---\s*/, '')
      : require(
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
