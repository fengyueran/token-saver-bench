import { mkdir, mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codexArgs, parseCodexRun } from './core.js';
import { execute } from './process.js';
import { prepareFixture } from './fixture.js';
import { prepareArm } from './tool-arms.js';
import { getTask } from './tasks.js';
import { verifyTask } from './verify.js';
import { auditActivation } from './activation.js';
import { failureCategory } from './failure.js';

async function optional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}
export function buildArgs(config, workspace, prepared, arm) {
  const args = codexArgs(config, workspace);
  args[args.indexOf('--sandbox') + 1] = 'workspace-write';
  if (arm === 'rtk')
    args.splice(args.length - 1, 0, '--dangerously-bypass-hook-trust');
  const overrides = [
    'sandbox_workspace_write.network_access=true',
    ...prepared.overrides,
    `shell_environment_policy.set.XDG_CACHE_HOME=${JSON.stringify(path.join(workspace, '.cache'))}`,
    `shell_environment_policy.set.NODE_OPTIONS=${JSON.stringify('--require ' + path.join(workspace, '.bench/loopback.cjs'))}`,
  ];
  if (prepared.instructions)
    overrides.push(
      `developer_instructions=${JSON.stringify(prepared.instructions)}`,
    );
  for (const override of overrides)
    args.splice(args.length - 1, 0, '-c', override);
  return args;
}

export async function runCase(root, config, run, output) {
  const task = getTask(run.task);
  if (!config.arms.some((arm) => arm.id === run.arm))
    throw new Error('Unknown arm');
  const version = execFileSync('codex', ['--version'], {
    encoding: 'utf8',
  }).trim();
  if (version !== 'codex-cli 0.158.0')
    throw new Error('Global Codex version mismatch');
  await mkdir(output, { recursive: false, mode: 0o700 });
  const parent = await mkdtemp(path.join(tmpdir(), 'token-formal-'));
  const workspace = path.join(parent, 'workspace');
  const summary = {
    ...run,
    kind: 'paired-benchmark',
    environmentRevision: 5,
    agentVersion: version,
    modelRequested: config.model,
    resolvedModel: null,
    reasoningEffort: config.reasoningEffort,
    status: 'setup-failed',
    usage: null,
    actualCostUsd: null,
    qualityPassed: null,
    executionPassed: false,
  };
  let prepared;
  let completed = false;
  try {
    summary.fixture = await prepareFixture(
      path.join(root, '.cache/fixtures/koa'),
      workspace,
      run.task,
    );
    await mkdir(path.join(workspace, '.cache'), { recursive: true });
    prepared = await prepareArm(root, run.arm, workspace, output);
    const args = buildArgs(config, workspace, prepared, run.arm);
    summary.toolSetup = prepared.evidence;
    await writeFile(
      path.join(output, 'invocation.json'),
      JSON.stringify({ args, prompt: task.prompt, workspace }, null, 2),
      { mode: 0o600 },
    );
    const started = Date.now();
    const result = await execute('codex', args, {
      cwd: workspace,
      env: prepared.env,
      input: task.prompt,
      timeoutMs: config.timeoutSeconds * 1000,
      onStdout: (data) =>
        appendFileSync(path.join(output, 'events.jsonl'), data, {
          mode: 0o600,
        }),
      onStderr: (data) =>
        appendFileSync(path.join(output, 'stderr.log'), data, { mode: 0o600 }),
    });
    summary.durationMs = Date.now() - started;
    summary.exitCode = result.code;
    summary.timedOut = result.timedOut;
    summary.inputError = result.inputError;
    try {
      Object.assign(summary, parseCodexRun(result.stdout));
    } catch (error) {
      summary.status = 'parse-failed';
      summary.runnerError = error.message;
    }
    summary.executionPassed =
      result.code === 0 &&
      !result.timedOut &&
      !result.inputError &&
      summary.status === 'completed';
    await prepared.stop?.();
    summary.activation = auditActivation(run.arm, {
      events: summary.status === 'parse-failed' ? '' : result.stdout,
      hookEvents: await optional(path.join(output, 'rtk-hooks.jsonl')),
      proxyEvents: await optional(path.join(output, 'headroom-requests.jsonl')),
      instructions: prepared.instructions,
    });
    const verification = await verifyTask(root, workspace, run.task);
    await writeFile(
      path.join(output, 'verification.json'),
      JSON.stringify(verification, null, 2),
      { mode: 0o600 },
    );
    summary.qualityPassed = verification.passed;
    summary.explanationReview =
      verification.explanationReview ?? 'not-applicable';
    await cp(path.join(workspace, 'lib'), path.join(output, 'solution/lib'), {
      recursive: true,
    });
    await cp(
      path.join(workspace, '__tests__'),
      path.join(output, 'solution/__tests__'),
      { recursive: true },
    );
    const answer = await optional(path.join(workspace, 'answer.json'));
    if (answer)
      await writeFile(path.join(output, 'answer.json'), answer, {
        mode: 0o600,
      });
    completed = true;
  } catch (error) {
    summary.runnerError = error.message;
    summary.executionPassed = false;
  } finally {
    await prepared?.stop?.();
    summary.failureCategory = failureCategory(summary);
    await writeFile(
      path.join(output, 'summary.json'),
      JSON.stringify(summary, null, 2),
      { mode: 0o600 },
    );
    if (completed) await rm(parent, { recursive: true });
    else
      await writeFile(path.join(output, 'retained-workspace.txt'), workspace, {
        mode: 0o600,
      });
  }
  return summary;
}
