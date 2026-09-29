import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { execute } from '../src/process.js';
import { codexArgs, parseCodexRun } from '../src/core.js';
import { prepareArm } from '../src/tool-arms.js';
import { prepareFixture, validationPrompt } from '../src/fixture.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(
  await readFile(path.join(root, 'config/experiment.json'), 'utf8'),
);
const arm = process.argv[2];
if (
  !['baseline', 'caveman', 'ponytail', 'rtk', 'codegraph', 'headroom'].includes(
    arm,
  )
)
  throw new Error('Unknown arm');
const agentVersion = execFileSync('codex', ['--version'], {
  encoding: 'utf8',
}).trim();
if (agentVersion !== 'codex-cli 0.158.0')
  throw new Error('Global Codex version mismatch');
const id = `pilot-repair-validation-${arm}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
const output = path.join(root, 'runs', id);
await mkdir(output, { recursive: true, mode: 0o700 });
const parent = await mkdtemp(path.join(tmpdir(), 'token-bench-pilot-'));
const workspace = path.join(parent, 'workspace');
const fixture = await prepareFixture(
  path.join(root, '.cache/fixtures/koa'),
  workspace,
  'repair-validation',
);
let prepared;
try {
  prepared = await prepareArm(root, arm, workspace, output);
} catch (error) {
  await writeFile(
    path.join(output, 'summary.json'),
    JSON.stringify(
      {
        id,
        arm,
        kind: 'integration-pilot',
        environmentRevision: 3,
        status: 'setup-failed',
        runnerError: error.message,
        usage: null,
        actualCostUsd: null,
        executionPassed: false,
        qualityPassed: null,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  throw error;
}
const args = codexArgs(config, workspace);
args[args.indexOf('--sandbox') + 1] = 'workspace-write';
if (arm === 'rtk')
  args.splice(args.length - 1, 0, '--dangerously-bypass-hook-trust');
args.splice(
  args.length - 1,
  0,
  '-c',
  'sandbox_workspace_write.network_access=true',
);
for (const override of prepared.overrides)
  args.splice(args.length - 1, 0, '-c', override);
const cacheDir = path.join(workspace, '.cache');
await mkdir(cacheDir, { recursive: true });
args.splice(
  args.length - 1,
  0,
  '-c',
  `shell_environment_policy.set.XDG_CACHE_HOME=${JSON.stringify(cacheDir)}`,
);
if (prepared.instructions)
  args.splice(
    args.length - 1,
    0,
    '-c',
    `developer_instructions=${JSON.stringify(prepared.instructions)}`,
  );
await writeFile(
  path.join(output, 'invocation.json'),
  JSON.stringify(
    {
      args,
      prompt: validationPrompt,
      fixture,
      activation: prepared.evidence,
      workspace,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(JSON.stringify({ event: 'started', id, output }));
const started = Date.now();
let result;
let parsed = { status: 'failed', usage: null, actualCostUsd: null };
let runnerError = null;
try {
  result = await execute('codex', args, {
    cwd: workspace,
    env: prepared.env,
    input: validationPrompt,
    timeoutMs: config.timeoutSeconds * 1000,
    onStdout: (data) =>
      appendFileSync(path.join(output, 'events.jsonl'), data, { mode: 0o600 }),
    onStderr: (data) =>
      appendFileSync(path.join(output, 'stderr.log'), data, { mode: 0o600 }),
  });
  await writeFile(path.join(output, 'events.jsonl'), result.stdout, {
    mode: 0o600,
  });
  await writeFile(path.join(output, 'stderr.log'), result.stderr, {
    mode: 0o600,
  });
  parsed = parseCodexRun(result.stdout);
} catch (error) {
  runnerError = error.message;
} finally {
  prepared.stop?.();
}
const durationMs = Date.now() - started;
const verification = await execute(
  process.execPath,
  [path.join(root, 'verifiers/repair-validation.cjs'), workspace],
  { timeoutMs: 10000 },
);
await writeFile(
  path.join(output, 'verification.json'),
  JSON.stringify(verification, null, 2),
  { mode: 0o600 },
);
const summary = {
  id,
  kind: 'integration-pilot',
  environmentRevision: 3,
  task: 'repair-validation',
  arm,
  fixture,
  modelRequested: config.model,
  resolvedModel: null,
  reasoningEffort: config.reasoningEffort,
  agentVersion,
  activation: prepared.evidence,
  durationMs,
  exitCode: result?.code ?? null,
  timedOut: result?.timedOut ?? false,
  runnerError,
  ...parsed,
  qualityPassed: verification.code === 0 && !verification.timedOut,
  executionPassed:
    result?.code === 0 &&
    !result?.timedOut &&
    !result?.inputError &&
    parsed.status === 'completed' &&
    !runnerError,
};
await writeFile(
  path.join(output, 'summary.json'),
  JSON.stringify(summary, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify({ ...summary, output }, null, 2));
if (!summary.qualityPassed || !summary.executionPassed) process.exitCode = 1;
