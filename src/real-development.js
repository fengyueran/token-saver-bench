import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { instructionArm } from './arms.js';
import { fingerprint } from './fingerprint.js';

export const realDevelopmentTasks = Object.freeze({
  memos: {
    source: '.cache/candidate-memos',
    commit: 'b1fa9aefcc22fde5774b7f6cf0b3e19fc67acc6e',
    prompt: 'prompts/memos-bulk-archive.txt',
    promptHash: '29ac76a8b7005f1f0bb0edef6b8c15351a74c386a17b7510bbad77b570264f05',
    verifier: 'verifiers/memos-bulk-archive.test.tsx',
    verifierHash: 'e095782c2b67ee03e3405d9e206684bb193a2ffa7456074966a2b76df6445bde',
  },
  httpie: {
    source: '.cache/candidate-httpie',
    commit: '5b604c37c6c67e18e7c3e9aee6c88a8c22b98345',
    prompt: 'prompts/httpie-download-integrity.txt',
    promptHash: 'ed71d0732fe53941849b3143de5dfd510ef8db42f496c2e0390dd5c1ee07400c',
    verifier: 'verifiers/httpie-download-integrity.cjs',
    verifierHash: 'fb5f16bdf0ec266ef7bd5e5688d3731ddfe3eef74b064b9f74c05bee45e09546',
  },
});

const extraFiles = Object.freeze({
  'memos-browser-checklist': ['verifiers/memos-bulk-archive-manual.md', '58de52b59d16e589c042773f31603a8c0777ca9ee6fb72ee9b679ba6913bb1b5'],
  'memos-verifier-runner': ['verifiers/run-memos-bulk-archive.sh', '69525d525256edd7368bc362fc8c81322e409dcbdfa05b56d503bbb06f1a84f9'],
  'memos-home-test-adapter': ['src/memos-test-adapter.js', '6bca955dfdabd2e8da96d3e0b42b95d8ad4dcdf4c855163008269aa7a13a013f'],
});
const instructionHash = 'da4fb09cff2f6726691ce6591cebc38c95597d79da132e49c6fa2665c4e8a3ff';
const pairs = [
  ['memos', 1, 'baseline', 'ponytail'],
  ['httpie', 1, 'ponytail', 'baseline'],
  ['memos', 2, 'ponytail', 'baseline'],
  ['httpie', 2, 'baseline', 'ponytail'],
  ['memos', 3, 'ponytail', 'baseline'],
  ['httpie', 3, 'baseline', 'ponytail'],
  ['memos', 4, 'baseline', 'ponytail'],
  ['httpie', 4, 'ponytail', 'baseline'],
];

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function git(source, args) {
  return execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
}

export function createRealDevelopmentSchedule() {
  return pairs.flatMap(([task, pair, first, second]) =>
    [first, second].map((arm) => ({
      id: `${task[0]}${pair}-${arm}`,
      task,
      pair,
      arm,
      model: 'gpt-6-sol',
      reasoningEffort: 'medium',
    })),
  );
}

export async function preflightRealDevelopment(root, options = {}) {
  const checks = [];
  const identity = { protocol: 1, schedule: createRealDevelopmentSchedule() };
  for (const folder of ['src', 'bin', 'verifiers', 'prompts'])
    identity[`${folder}Files`] = await fingerprint(path.join(root, folder));
  identity.packageJson = sha256(await readFile(path.join(root, 'package.json')));
  identity.protocolDocument = sha256(await readFile(path.join(root, 'docs/real-development-protocol.md')));
  const checkFile = async (id, file, expected) => {
    try {
      const actual = sha256(await readFile(file));
      checks.push({ id, ok: actual === expected, expected, actual });
      return actual;
    } catch (error) {
      checks.push({ id, ok: false, expected, error: error.code ?? error.message });
      return null;
    }
  };
  for (const [name, task] of Object.entries(realDevelopmentTasks)) {
    const source = path.join(root, task.source);
    try {
      const commit = git(source, ['rev-parse', 'HEAD']);
      const clean = !git(source, ['status', '--porcelain', '--untracked-files=no']);
      checks.push({ id: `${name}-source`, ok: commit === task.commit && clean, commit, clean });
      identity[`${name}Commit`] = commit;
    } catch (error) {
      checks.push({ id: `${name}-source`, ok: false, error: error.message });
    }
    identity[`${name}Prompt`] = await checkFile(
      `${name}-prompt`, options.promptOverrides?.[name] ?? path.join(root, task.prompt), task.promptHash);
    identity[`${name}Verifier`] = await checkFile(
      `${name}-verifier`, path.join(root, task.verifier), task.verifierHash);
  }
  for (const [id, [file, expected]] of Object.entries(extraFiles))
    identity[id] = await checkFile(id, path.join(root, file), expected);
  try {
    const instruction = await instructionArm(root, 'ponytail');
    const ok = instruction.evidence.instructionSha256 === instructionHash;
    checks.push({ id: 'ponytail-instructions', ok, actual: instruction.evidence.instructionSha256 });
    identity.ponytail = instruction.evidence;
  } catch (error) {
    checks.push({ id: 'ponytail-instructions', ok: false, error: error.message });
  }
  try {
    const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
    checks.push({ id: 'codex-version', ok: version === 'codex-cli 0.158.0', version });
    identity.codexVersion = version;
  } catch (error) {
    checks.push({ id: 'codex-version', ok: false, error: error.message });
  }
  for (const [id, file] of [
    ['memos-dependencies', '.cache/candidate-memos/web/node_modules/.bin/vitest'],
    ['httpie-dependencies', '.cache/candidate-httpie/.venv/bin/python'],
  ]) {
    try {
      await access(path.join(root, file));
      checks.push({ id, ok: true });
    } catch (error) {
      checks.push({ id, ok: false, error: error.code ?? error.message });
    }
  }
  try {
    const version = execFileSync('pnpm', ['--dir', path.join(root, '.cache/candidate-memos/web'), '--version'], {
      encoding: 'utf8', timeout: 30000,
    }).trim();
    checks.push({ id: 'memos-pnpm-version', ok: version === '11.0.1', version });
    identity.memosPnpmVersion = version;
  } catch (error) {
    checks.push({ id: 'memos-pnpm-version', ok: false, error: error.message });
  }
  try {
    const python = path.join(root, '.cache/candidate-httpie/.venv/bin/python');
    const dependencies = execFileSync(python, ['-m', 'pip', 'freeze'], {
      encoding: 'utf8', timeout: 30000,
    });
    identity.httpiePythonDependencies = sha256(dependencies);
    checks.push({ id: 'httpie-python-dependencies', ok: dependencies.trim().length > 0,
      sha256: identity.httpiePythonDependencies });
  } catch (error) {
    checks.push({ id: 'httpie-python-dependencies', ok: false, error: error.message });
  }
  return {
    ready: checks.every(({ ok }) => ok),
    checks,
    schedule: identity.schedule,
    identityHash: sha256(JSON.stringify(identity)),
    identity,
  };
}

export function buildRealDevelopmentArgs(workspace, arm, instructions = '') {
  if (!['baseline', 'ponytail'].includes(arm)) throw new Error('Unknown arm');
  if (!path.isAbsolute(workspace)) throw new Error('Absolute workspace required');
  if (arm === 'ponytail' && !instructions) throw new Error('Ponytail instructions missing');
  const overrides = [
    'model_reasoning_effort="medium"',
    'skills.include_instructions=false',
    'skills.bundled.enabled=false',
    'features.plugins=false',
    'features.apps=false',
    'features.memories=false',
    'features.hooks=false',
    'features.multi_agent=false',
    'approval_policy="never"',
    'sandbox_workspace_write.network_access=true',
    `shell_environment_policy.set.XDG_CACHE_HOME=${JSON.stringify(path.join(workspace, '.cache'))}`,
    `shell_environment_policy.set.PYTHONPATH=${JSON.stringify(workspace)}`,
    `shell_environment_policy.set.PATH=${JSON.stringify(path.join(workspace, '.venv/bin') + path.delimiter + process.env.PATH)}`,
  ];
  if (arm === 'ponytail') overrides.push(`developer_instructions=${JSON.stringify(instructions)}`);
  return [
    'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--json',
    '--model', 'gpt-6-sol', ...overrides.flatMap((override) => ['-c', override]),
    '--sandbox', 'workspace-write', '--cd', workspace, '-',
  ];
}
