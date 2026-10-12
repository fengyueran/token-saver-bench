import { cp, mkdir, readFile, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';
import { prepareScenarioState } from './scenario-state.js';
import { parseScenarioEvents } from './scenario-events.js';
import { auditCalibrationSession, assertCalibrationAudit } from './calibration-audit.js';
import { realDevelopmentTasks, buildRealDevelopmentArgs } from './real-development.js';
import { instructionArm } from './arms.js';
import { execute } from './process.js';
import { transplantDecisionSource } from './decision-transplant.js';
import { parseCodexRun } from './codex-events.js';
import { failureCategory } from './failure.js';
import { applyMemosHomeTestAdapter } from './memos-test-adapter.js';
import { assertFormalExecution } from './formal-codex-adapter.js';

async function relocatePythonEntrypoints(source, target) {
  for (const entry of await readdir(path.join(target, 'bin'), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(target, 'bin', entry.name);
    const content = await readFile(file);
    if (!content.subarray(0, 2).equals(Buffer.from('#!')) && !entry.name.startsWith('activate')) continue;
    const text = content.toString('utf8');
    const relocated = text.split(source).join(target);
    if (relocated !== text) await writeFile(file, relocated);
  }
}

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
    const environment = path.join(root, '.cache/runtime/httpie-python311');
    await cp(environment, path.join(workspace, '.venv'), {
      recursive: true,
      preserveTimestamps: true,
    });
    await relocatePythonEntrypoints(environment, path.join(workspace, '.venv'));
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

export function isKnownUpstreamFailure(line) {
  const known = [
    'FAILED tests/test_encoding.py::test_terminal_output_response_charset_detection[big5-',
    'FAILED tests/test_encoding.py::test_terminal_output_request_charset_detection[big5-',
    'FAILED tests/test_output.py::TestQuietFlag::test_double_quiet_on_error',
  ];
  return typeof line === 'string' && known.some(prefix => line.startsWith(prefix));
}

export function fullSuiteAccepted(result) {
  if (result.code === 0 && !result.timedOut) return true;
  if (result.code !== 1 || result.timedOut) return false;
  const failures = result.stdout.split('\n')
    .filter((line) => line.startsWith('FAILED tests/'));
  const failureCount = Number(result.stdout.match(/\b(\d+) failed\b/)?.[1]);
  if (failureCount !== failures.length || /\b\d+ errors?\b/.test(result.stdout))
    return false;
  return failures.length > 0 && failures.length <= 3 &&
    failures.every(isKnownUpstreamFailure);
}

export async function verifyRealDevelopmentCase(root, taskName, workspace, output, options = {}) {
  const contractName = options.contract ?? 'original';
  const allowed = { memos: ['original', 'memos-attachment-filename-search'], httpie: ['original', 'httpie-cookie-scope-repair'] };
  if (!allowed[taskName]?.includes(contractName)) throw new Error('Unknown or mismatched task contract');
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
    let testIsolation = null;
    if (contractName === 'memos-attachment-filename-search')
      testIsolation = await transplantDecisionSource(path.join(workspace, 'web/src'), path.join(clean, 'web/src'));
    else {
      await rm(path.join(clean, 'web/src'), { recursive: true });
      await cp(path.join(workspace, 'web/src'), path.join(clean, 'web/src'), { recursive: true });
    }
    const web = path.join(clean, 'web');
    const binary = (name) => path.join(web, 'node_modules/.bin', name);
    const verifier = contractName === 'original' ? 'run-memos-bulk-archive.sh' : 'run-memos-attachment-filename-search.sh';
    const contract = await runCheck('bash', [path.join(root, 'verifiers', verifier), clean], root, env);
    const originalHomeTest = await runCheck(binary('vitest'), ['run', 'tests/home-loading-boundary.test.tsx'], web, env);
    await applyMemosHomeTestAdapter(path.join(web, 'tests/home-loading-boundary.test.tsx'));
    const tests = await runCheck(binary('vitest'), ['run'], web, env);
    const types = await runCheck(binary('tsc'), ['--noEmit', '--skipLibCheck'], web, env);
    const lint = await runCheck(binary('biome'), ['check', 'src', 'tests'], web, env);
    const build = await runCheck(binary('vite'), ['build'], web, env);
    const checks = { contract, originalHomeTest, tests, types, lint, build };
    const automatedPassed = [contract, tests, types, lint, build]
      .every((result) => result.code === 0 && !result.timedOut);
    return {
      checks,
      contractName,
      automatedPassed,
      originalHomeTestPassed: originalHomeTest.code === 0 && !originalHomeTest.timedOut,
      fixedCompatibilityAdapter: 'wrap original Home renders with QueryClientProvider and preserve actual i18n exports in partial mock; assertions unchanged',
      manualStatus: 'pending',
      qualityPassed: automatedPassed ? null : false,
      sourceTransplant: 'web/src',
      testIsolation,
    };
  }
  await rm(path.join(clean, 'httpie'), { recursive: true });
  await cp(path.join(workspace, 'httpie'), path.join(clean, 'httpie'), { recursive: true });
  const python = path.join(clean, '.venv/bin/python');
  const contract = contractName === 'httpie-cookie-scope-repair' ? await runCheck(python, [
    path.join(root, 'verifiers/httpie-cookie-scope.py'), path.join(clean, '.venv/bin/http'), clean,
  ], root, env) : await runCheck(process.execPath, [
    path.join(root, 'verifiers/httpie-download-integrity.cjs'),
    path.join(clean, '.venv/bin/http'),
  ], root, env);
  const downloads = await runCheck(python, ['-m', 'pytest', 'tests/test_downloads.py', '-q', '--disable-warnings'], clean, env);
  const full = await runCheck(python, ['-m', 'pytest', '-q', '--disable-warnings', '--tb=short'], clean, env, 180000);
  const automatedPassed = contract.code === 0 && !contract.timedOut &&
    downloads.code === 0 && !downloads.timedOut && fullSuiteAccepted(full);
  return {
    checks: { contract, downloads, full },
    contractName,
    knownUpstreamFailuresOnly: fullSuiteAccepted(full),
    automatedPassed,
    manualStatus: 'not-applicable',
    qualityPassed: automatedPassed,
    sourceTransplant: 'httpie',
  };
}

export async function runRealDevelopmentCase(root, run, output, dependencies = {}) {
  const formal=dependencies.formalContext?await assertFormalExecution(dependencies.formalContext,root,run,output,dependencies):null;
  if (!realDevelopmentTasks[run.task] || !['baseline', 'ponytail'].includes(run.arm))
    throw new Error('Unknown real-development run');
  if (run.model !== undefined && run.model !== 'gpt-5.6-sol') throw new Error('Unsupported current model');
  await mkdir(output, { mode: 0o700 });
  const state = await prepareScenarioState(output);
  const summary = {
    ...run,
    kind: 'real-development',
    modelRequested: 'gpt-5.6-sol',
    reasoningEffort: 'medium',
    executionMode: dependencies.agentExecute ? 'injected-executor' : 'real-codex',
    modelInvoked: false,
    formalReady: false,
    formalSample: false,
    resolvedModel: null,
    actualCostUsd: null,
    usage: null,
    status: 'setup-failed',
    qualityPassed: null,
    executionPassed: false,
    ...formal,
  };
  try {
    if (!dependencies.agentExecute || dependencies.authSource) {
      const source = dependencies.authSource ?? path.join(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'), 'auth.json');
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid authentication source');
      const auth = JSON.parse(await readFile(source, 'utf8'));
      if (auth.auth_mode !== 'chatgpt' || !auth.tokens || typeof auth.tokens !== 'object') throw new Error('Expected ChatGPT authentication');
      if (auth.last_refresh !== undefined && (typeof auth.last_refresh !== 'string' || !Number.isFinite(Date.parse(auth.last_refresh))))
        throw new Error('Invalid authentication refresh timestamp');
      await writeFile(path.join(state, 'auth.json'), JSON.stringify({ auth_mode: auth.auth_mode, tokens: auth.tokens,
        ...(auth.last_refresh === undefined ? {} : { last_refresh: auth.last_refresh }) }), { flag: 'wx', mode: 0o600 });
    }
    const workspace = await prepareRealDevelopmentWorkspace(root, run.task, output);
    const prompt = await readFile(path.join(root, realDevelopmentTasks[run.task].prompt), 'utf8');
    const prepared = await instructionArm(root, run.arm);
    const args = buildRealDevelopmentArgs(workspace, run.arm, prepared.instructions).filter(arg => arg !== '--ephemeral');
    args[args.indexOf('--model') + 1] = summary.modelRequested;
    args.splice(1, 0, '-c', 'cli_auth_credentials_store="file"');
    summary.toolSetup = prepared.evidence;
    await writeFile(path.join(output, 'prompt.txt'), prompt, { mode: 0o600 });
    if (prepared.instructions)
      await writeFile(path.join(output, 'instructions.txt'), prepared.instructions, { mode: 0o600 });
    await writeFile(path.join(output, 'invocation.json'), JSON.stringify({
      args: args.map((arg) => arg.startsWith('developer_instructions=')
        ? 'developer_instructions=<stored in instructions.txt>' : arg),
      timeoutMs: null,
      sessionState: state,
    }, null, 2), { mode: 0o600 });
    const env = {
      ...process.env,
      CODEX_HOME: state,
      PYTHONPATH: workspace,
      PATH: path.join(workspace, '.venv/bin') + path.delimiter + process.env.PATH,
      XDG_CACHE_HOME: path.join(workspace, '.cache'),
    };
    if(formal){
      await assertFormalExecution(dependencies.formalContext,root,run,output,dependencies);
      await writeFile(path.join(output,'manifest.json'),JSON.stringify({...summary,identityHash:dependencies.formalContext.plan.identityHash,stageTimeoutMs:null,totalTimeoutMs:null},null,2),{mode:0o600,flag:'wx'});
    }
    const started = Date.now();
    summary.modelInvoked = !dependencies.agentExecute;
    const result = await (dependencies.agentExecute ?? execute)('codex', args, {
      cwd: workspace,
      env,
      input: prompt,
      timeoutMs: null,
      onStdout: (data) => appendFileSync(path.join(output, 'events.jsonl'), data, { mode: 0o600 }),
      onStderr: (data) => appendFileSync(path.join(output, 'stderr.log'), data, { mode: 0o600 }),
    });
    summary.durationMs = Date.now() - started;
    summary.exitCode = result.code;
    summary.timedOut = result.timedOut;
    summary.inputError = result.inputError;
    try {
      Object.assign(summary, parseCodexRun(result.stdout));
      if (dependencies.agentExecute) {
        summary.syntheticUsage = summary.usage;
        summary.usage = null;
      } else {
        const parsed = parseScenarioEvents(result.stdout, null, 'cumulative');
        const files = (await readdir(path.join(state, 'sessions'), { recursive: true }))
          .filter(file => file.endsWith('.jsonl') && file.includes(parsed.threadId));
        if (files.length !== 1) throw new Error('Expected one private session log');
        const jsonl = await readFile(path.join(state, 'sessions', files[0]), 'utf8');
        const usage = parsed.reportedUsage;
        summary.sessionAudit = auditCalibrationSession(jsonl, parsed.threadId, usage ? {
          input_tokens: usage.inputTokens, cached_input_tokens: usage.cachedInputTokens, output_tokens: usage.outputTokens,
        } : null, null, summary.modelRequested);
        assertCalibrationAudit(summary.sessionAudit);
        if (parsed.resolvedModel !== null && parsed.resolvedModel !== summary.modelRequested)
          throw new Error('Resolved model mismatch');
        summary.usage = parsed.usage;
        await writeFile(path.join(output, 'session.jsonl'), jsonl, { mode: 0o600 });
        summary.threadId = parsed.threadId;
      }
    } catch (error) {
      summary.status = 'parse-failed';
      summary.runnerError = error.message;
      summary.usage = null;
    }
    summary.executionPassed = result.code === 0 && !result.timedOut &&
      !result.inputError && summary.status === 'completed';
    if (summary.executionPassed) {
      const verification = await (dependencies.verifier ?? verifyRealDevelopmentCase)(root, run.task, workspace, output);
      await writeFile(path.join(output, 'verification.json'), JSON.stringify(verification, null, 2), { mode: 0o600 });
      summary.qualityPassed = verification.automatedPassed === false ? false : verification.qualityPassed;
      summary.automatedPassed = verification.automatedPassed;
      summary.manualStatus = verification.manualStatus;
    }
  } catch (error) {
    summary.runnerError = error.message;
  } finally {
    await rm(path.join(state, 'auth.json'), { force: true });
    summary.credentialCopyRemoved = true;
    summary.failureCategory = failureCategory(summary);
    await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  }
  return summary;
}
