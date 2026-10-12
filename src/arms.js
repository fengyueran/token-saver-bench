import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const ponytailCommit = 'e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156';

export async function instructionArm(root, arm) {
  if (arm === 'baseline')
    return { instructions: '', evidence: { kind: 'none' } };
  if (!['ponytail', 'caveman'].includes(arm)) throw new Error(`Arm not ready: ${arm}`);
  if (!path.isAbsolute(root)) throw new Error('Absolute root required');
  const source = path.join(root, '.cache/tools', arm);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
  }).trim();
  if (commit !== (arm === 'ponytail' ? ponytailCommit : '2fd153c67988e980fb0b2455c90832159a6a5a25'))
    throw new Error('Tool commit mismatch');
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: source, encoding: 'utf8' },
  );
  if (dirty.trim()) throw new Error('Tool source has tracked modifications');
  const skill = arm === 'caveman' ? await readFile(path.join(source, 'skills/caveman/SKILL.md'), 'utf8') : null;
  const instructions = skill === null ? require(
    path.join(source, 'hooks/ponytail-instructions.js'),
  ).getPonytailInstructions('full') : skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  return {
    instructions,
    evidence: {
      kind: arm === 'ponytail' ? 'forced-original-instructions' : 'forced-original-skill',
      ...(skill === null ? {} : { sourceSha256: createHash('sha256').update(skill).digest('hex') }),
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
