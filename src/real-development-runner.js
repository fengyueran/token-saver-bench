import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { realDevelopmentTasks, buildRealDevelopmentArgs } from './real-development.js';
import { instructionArm } from './arms.js';
import { execute } from './process.js';
import { parseCodexRun } from './codex-events.js';
import { failureCategory } from './failure.js';
import { applyMemosHomeTestAdapter } from './memos-test-adapter.js';

export async function prepareRealDevelopmentWorkspace(root, taskName, directory) {
  const task = realDevelopmentTasks[taskName];
  if (!task) throw new Error(`Unknown real-development task: ${taskName}`);
  if (!path.isAbsolute(directory)) throw new Error('Absolute directory required');
  const source = path.join(root, task.source);
  const workspace = path.join(directory, 'workspace');
  execFileSync('git', ['clone', '--no-hardlinks', '--quiet', source, workspace], {
    encoding: 'utf8', timeout: 120000,
  });
  const head = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', timeout: 10000,
  }).trim();
  if (head !== task.commit) throw new Error(`Source commit mismatch: ${head}`);
  if (taskName === 'memos') {
    execFileSync('pnpm', ['install', '--offline', '--frozen-lockfile'], {
      cwd: path.join(workspace, 'web'),
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
      timeout: 120000,
    });
  } else {
    await cp(path.join(source, '.venv'), path.join(workspace, '.venv'), {
      recursive: true,
      preserveTimestamps: true,
    });
    const http = path.join(workspace, '.venv/bin/http');
    const entrypoint = await readFile(http, 'utf8');
    await writeFile(http, entrypoint.replace(/^#![^\n]+/, `#!${workspace}/.venv/bin/python`), { mode: 0o755 });
  }
  await mkdir(path.join(workspace, '.cache'), { mode: 0o700 });
  return workspace;
}

function compact(result) {
  return {
    code: result.code,
    timedOut: result.timedOut,
    inputError: result.inputError,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function runCheck(binary, args, cwd, env, timeoutMs = 180000) {
  return compact(await execute(binary, args, { cwd, env, timeoutMs }));
}

export function fullSuiteAccepted(result) {
  if (result.code === 0 && !result.timedOut) return true;
  if (result.code !== 1 || result.timedOut) return false;
  const failures = result.stdout.split('\n')
    .filter((line) => line.startsWith('FAILED tests/'));
  const failureCount = Number(result.stdout.match(/\b(\d+) failed\b/)?.[1]);
  if (failureCount !== failures.length || /\b\d+ errors?\b/.test(result.stdout))
    return false;
  const known = [
    'FAILED tests/test_encoding.py::test_terminal_output_response_charset_detection[big5-',
    'FAILED tests/test_encoding.py::test_terminal_output_request_charset_detection[big5-',
    'FAILED tests/test_output.py::TestQuietFlag::test_double_quiet_on_error',
  ];
  return failures.length > 0 && failures.length <= known.length &&
    failures.every((line) => known.some((prefix) => line.startsWith(prefix)));
}

export async function verifyRealDevelopmentCase(root, taskName, workspace, output) {
  const independent = path.join(output, 'independent-verification');
  await mkdir(independent, { mode: 0o700 });
  const clean = await prepareRealDevelopmentWorkspace(root, taskName, independent);
  const env = {
    ...process.env,
    PYTHONPATH: clean,
    PATH: path.join(clean, '.venv/bin') + path.delimiter + process.env.PATH,
    XDG_CACHE_HOME: path.join(clean, '.cache'),
  };
  if (taskName === 'memos') {
    await rm(path.join(clean, 'web/src'), { recursive: true });
    await cp(path.join(workspace, 'web/src'), path.join(clean, 'web/src'), { recursive: true });
    const web = path.join(clean, 'web');
    const binary = (name) => path.join(web, 'node_modules/.bin', name);
    const contract = await runCheck('bash', [path.join(root, 'verifiers/run-memos-bulk-archive.sh'), clean], root, env);
    const originalHomeTest = await runCheck(binary('vitest'), ['run', 'tests/home-loading-boundary.test.tsx'], web, env);
    await applyMemosHomeTestAdapter(path.join(web, 'tests/home-loading-boundary.test.tsx'));
    const tests = await runCheck(binary('vitest'), ['run'], web, env);
    const types = await runCheck(binary('tsc'), ['--noEmit', '--skipLibCheck'], web, env);
    const lint = await runCheck(binary('biome'), ['check', 'src', 'tests'], web, env);
    const build = await runCheck(binary('vite'), ['build'], web, env);
    const checks = { contract, originalHomeTest, tests, types, lint, build };
    return {
      checks,
      automatedPassed: [contract, tests, types, lint, build]
        .every((result) => result.code === 0 && !result.timedOut),
      originalHomeTestPassed: originalHomeTest.code === 0 && !originalHomeTest.timedOut,
      fixedCompatibilityAdapter: 'wrap original Home renders with QueryClientProvider; assertions unchanged',
      manualStatus: 'pending',
      qualityPassed: null,
      sourceTransplant: 'web/src',
    };
  }
  await rm(path.join(clean, 'httpie'), { recursive: true });
  await cp(path.join(workspace, 'httpie'), path.join(clean, 'httpie'), { recursive: true });
  const contract = await runCheck(process.execPath, [
    path.join(root, 'verifiers/httpie-download-integrity.cjs'),
    path.join(clean, '.venv/bin/http'),
  ], root, env);
  const python = path.join(clean, '.venv/bin/python');
  const downloads = await runCheck(python, ['-m', 'pytest', 'tests/test_downloads.py', '-q', '--disable-warnings'], clean, env);
  const full = await runCheck(python, ['-m', 'pytest', '-q', '--disable-warnings', '--tb=short'], clean, env, 180000);
  const automatedPassed = contract.code === 0 && !contract.timedOut &&
    downloads.code === 0 && !downloads.timedOut && fullSuiteAccepted(full);
  return {
    checks: { contract, downloads, full },
    knownUpstreamFailuresOnly: fullSuiteAccepted(full),
    automatedPassed,
    manualStatus: 'not-applicable',
    qualityPassed: automatedPassed,
    sourceTransplant: 'httpie',
  };
}

export async function runRealDevelopmentCase(root, run, output, dependencies = {}) {
  if (!realDevelopmentTasks[run.task] || !['baseline', 'ponytail'].includes(run.arm))
    throw new Error('Unknown real-development run');
  await mkdir(output, { mode: 0o700 });
  const summary = {
    ...run,
    kind: 'real-development',
    modelRequested: 'gpt-6-sol',
    resolvedModel: null,
    actualCostUsd: null,
    usage: null,
    status: 'setup-failed',
    qualityPassed: null,
    executionPassed: false,
  };
  try {
    const workspace = await prepareRealDevelopmentWorkspace(root, run.task, output);
    const prompt = await readFile(path.join(root, realDevelopmentTasks[run.task].prompt), 'utf8');
    const prepared = await instructionArm(root, run.arm);
    const args = buildRealDevelopmentArgs(workspace, run.arm, prepared.instructions);
    summary.toolSetup = prepared.evidence;
    await writeFile(path.join(output, 'prompt.txt'), prompt, { mode: 0o600 });
    if (prepared.instructions)
      await writeFile(path.join(output, 'instructions.txt'), prepared.instructions, { mode: 0o600 });
    await writeFile(path.join(output, 'invocation.json'), JSON.stringify({
      args: args.map((arg) => arg.startsWith('developer_instructions=')
        ? 'developer_instructions=<stored in instructions.txt>' : arg),
      timeoutSeconds: 600,
    }, null, 2), { mode: 0o600 });
    const env = {
      ...process.env,
      PYTHONPATH: workspace,
      PATH: path.join(workspace, '.venv/bin') + path.delimiter + process.env.PATH,
      XDG_CACHE_HOME: path.join(workspace, '.cache'),
    };
    const started = Date.now();
    const result = await (dependencies.agentExecute ?? execute)('codex', args, {
      cwd: workspace,
      env,
      input: prompt,
      timeoutMs: 600000,
      onStdout: (data) => appendFileSync(path.join(output, 'events.jsonl'), data, { mode: 0o600 }),
      onStderr: (data) => appendFileSync(path.join(output, 'stderr.log'), data, { mode: 0o600 }),
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
    summary.executionPassed = result.code === 0 && !result.timedOut &&
      !result.inputError && summary.status === 'completed';
    if (summary.executionPassed) {
      const verification = await (dependencies.verifier ?? verifyRealDevelopmentCase)(root, run.task, workspace, output);
      await writeFile(path.join(output, 'verification.json'), JSON.stringify(verification, null, 2), { mode: 0o600 });
      summary.qualityPassed = verification.qualityPassed;
      summary.automatedPassed = verification.automatedPassed;
      summary.manualStatus = verification.manualStatus;
    }
  } catch (error) {
    summary.runnerError = error.message;
  } finally {
    summary.failureCategory = failureCategory(summary);
    await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  }
  return summary;
}
