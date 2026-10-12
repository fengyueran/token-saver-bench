import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  createRealDevelopmentSchedule,
  preflightRealDevelopment,
  buildRealDevelopmentArgs,
} from '../src/real-development.js';
import { prepareRealDevelopmentWorkspace, runRealDevelopmentCase, fullSuiteAccepted, verifyRealDevelopmentCase } from '../src/real-development-runner.js';
import { applyMemosHomeTestAdapter } from '../src/memos-test-adapter.js';
import { rm, stat, realpath } from 'node:fs/promises';

const root = new URL('../', import.meta.url).pathname;

test('independent verification rejects unknown or mismatched task contracts before creating a checkout', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verifier-contract-'));
  try {
    for (const [task, contract] of [['memos', 'httpie-cookie-scope-repair'], ['httpie', 'memos-attachment-filename-search'], ['httpie', '../../other']])
      await assert.rejects(verifyRealDevelopmentCase(root, task, directory, directory, { contract }), /contract/);
    await assert.rejects(stat(path.join(directory, 'independent-verification')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real development schedule exactly matches eight balanced pairs', () => {
  const schedule = createRealDevelopmentSchedule();
  assert.equal(schedule.length, 16);
  assert.ok(schedule.every(run => run.model === 'gpt-5.6-sol' && run.reasoningEffort === 'medium'));
  const args = buildRealDevelopmentArgs('/tmp/calibration-workspace', 'baseline');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.6-sol');
  assert.deepEqual(schedule.slice(0, 4).map(({ id }) => id), [
    'm1-baseline', 'm1-ponytail', 'h1-ponytail', 'h1-baseline',
  ]);
  for (const task of ['memos', 'httpie']) {
    const pairs = [1, 2, 3, 4].map((repeat) =>
      schedule.filter(({ task: name, pair }) => name === task && pair === repeat)
        .map(({ arm }) => arm).join(','));
    assert.equal(pairs.filter((pair) => pair === 'baseline,ponytail').length, 2);
    assert.equal(pairs.filter((pair) => pair === 'ponytail,baseline').length, 2);
  }
  assert.equal(new Set(schedule.map(({ id }) => id)).size, 16);
});

test('offline preflight validates fixed inputs without invoking a model', async () => {
  const result = await preflightRealDevelopment(root);
  assert.equal(result.ready, true, JSON.stringify(result.checks.filter((check) => !check.ok)));
  assert.equal(result.formalReady, false);
  assert.equal(result.scope, 'codex-ponytail-subset');
  assert.equal(result.schedule.length, 16);
  assert.ok(result.identityHash);
  assert.equal(result.checks.find((check) => check.id === 'codex-version')?.ok, true);
});

test('offline preflight fails closed when a frozen prompt changes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'real-dev-test-'));
  const original = await readFile(path.join(root, 'prompts/httpie-download-integrity.txt'));
  await writeFile(path.join(directory, 'changed-prompt.txt'), Buffer.concat([original, Buffer.from('extra')]));
  const result = await preflightRealDevelopment(root, {
    promptOverrides: { httpie: path.join(directory, 'changed-prompt.txt') },
  });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((check) => check.id === 'httpie-prompt')?.ok, false);
});

test('offline preflight rejects the historical Python 3.9 environment', async () => {
  const result = await preflightRealDevelopment(root, {
    httpiePython: path.join(root, '.cache/candidate-httpie/.venv/bin/python'),
  });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find(({ id }) => id === 'httpie-python-dependencies').runtimeOk, false);
});

test('CLI args isolate the workspace and add only Ponytail instructions in tool arm', () => {
  const workspace = '/tmp/real dev';
  const baseline = buildRealDevelopmentArgs(workspace, 'baseline', '');
  const ponytail = buildRealDevelopmentArgs(workspace, 'ponytail', 'FULL RULES');
  assert.equal(baseline[baseline.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(baseline.includes('--ignore-user-config'));
  assert.ok(baseline.includes('sandbox_workspace_write.network_access=true'));
  assert.ok(baseline.some((arg) => arg.includes('shell_environment_policy.set.PYTHONPATH=')));
  assert.ok(!baseline.some((arg) => arg.startsWith('developer_instructions=')));
  assert.ok(ponytail.includes('developer_instructions="FULL RULES"'));
  assert.equal(ponytail.at(-1), '-');
});

test('HTTPie preparation uses a clean fixed-commit copy and private dependencies', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'real-dev-workspace-'));
  const sharedPip = path.join(root, '.cache/runtime/httpie-python311/bin/pip');
  const originalPip = await readFile(sharedPip, 'utf8');
  try {
    const workspace = await prepareRealDevelopmentWorkspace(root, 'httpie', directory);
    assert.equal(workspace, path.join(directory, 'workspace'));
    assert.ok((await stat(path.join(workspace, '.venv/bin/python'))).isFile());
    const { execFileSync } = await import('node:child_process');
    const head = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(head, '5b604c37c6c67e18e7c3e9aee6c88a8c22b98345');
    assert.ok((await stat(path.join(workspace, '.cache'))).isDirectory());
    const identity = JSON.parse(execFileSync(path.join(workspace, '.venv/bin/python'),
      ['-c', 'import sys,httpie,json; print(json.dumps({"version":list(sys.version_info[:2]),"source":httpie.__file__}))'],
      { cwd: workspace, env: { ...process.env, PYTHONPATH: workspace }, encoding: 'utf8' }));
    assert.deepEqual(identity.version, [3, 11]);
    assert.equal(identity.source, await realpath(path.join(workspace, 'httpie/__init__.py')));
    const pipVersion = execFileSync(path.join(workspace, '.venv/bin/pip'), ['--version'], { encoding: 'utf8' });
    assert.ok(pipVersion.includes(path.join(workspace, '.venv/lib')));
    const probe = path.join(workspace, '.cache/relocation-test.py');
    await writeFile(probe, `import sys,os\ndef test_private_prefix():\n    assert os.path.realpath(sys.prefix) == ${JSON.stringify(await realpath(path.join(workspace, '.venv')))}\n`);
    execFileSync(path.join(workspace, '.venv/bin/pytest'), ['-q', probe], { cwd: directory, encoding: 'utf8' });
    assert.ok(!(await readFile(path.join(workspace, '.venv/bin/activate'), 'utf8')).includes('.cache/runtime/httpie-python311'));
    assert.equal(await readFile(sharedPip, 'utf8'), originalPip);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('new CLI previews and preflights only the new schedule', () => {
  const binary = path.join(root, 'bin/real-development.js');
  const plan = JSON.parse(execFileSync(process.execPath, [binary, 'plan'], { encoding: 'utf8' }));
  assert.equal(plan.length, 16);
  assert.ok(plan.every(({ task }) => ['memos', 'httpie'].includes(task)));
  const preflight = JSON.parse(execFileSync(process.execPath, [binary, 'preflight'], { encoding: 'utf8' }));
  assert.equal(preflight.ready, true);
  assert.equal(preflight.schedule.length, 16);
});

test('formal launch is blocked while runner only supports the Ponytail subset', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'blocked-launch-'));
  try {
    for (const mode of ['start', 'resume']) {
      const result = spawnSync(process.execPath,
        [path.join(root, 'bin/real-development.js'), mode], {
          encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: directory },
        });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Full benchmark implementation and calibration required/);
      assert.ok(!result.stdout.includes('campaign-started'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('run records one isolated slot and synthetic usage without a real model call', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'real-dev-run-'));
  const output = path.join(directory, 'h1-baseline');
  let calls = 0;
  try {
    const summary = await runRealDevelopmentCase(root, {
      id: 'h1-baseline', task: 'httpie', pair: 1, arm: 'baseline',
    }, output, {
      agentExecute: async (_binary, _args, options) => {
        calls += 1;
        assert.equal(_args[_args.indexOf('--model')+1],'gpt-5.6-sol');
        assert.ok(_args.includes('model_reasoning_effort="medium"'));
        assert.equal(options.timeoutMs,null);
        assert.equal(options.env.CODEX_HOME,path.join(output,'codex-home'));
        assert.equal((await stat(options.env.CODEX_HOME)).mode&0o777,0o700);
        assert.equal(options.input, await readFile(path.join(root, 'prompts/httpie-download-integrity.txt'), 'utf8'));
        const stdout = '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":7,"output_tokens":4}}\n';
        options.onStdout(Buffer.from(stdout));
        return { stdout, stderr: '', code: 0, timedOut: false, inputError: null };
      },
      verifier: async () => ({ automatedPassed: true, qualityPassed: true, manualStatus: 'not-applicable' }),
    });
    assert.equal(calls, 1);
    assert.equal(summary.usage,null);
    assert.equal(summary.syntheticUsage.totalTokens, 16);
    assert.equal(summary.syntheticUsage.uncachedInputTokens, 5);
    assert.equal(summary.modelInvoked,false);
    assert.equal(summary.executionMode,'injected-executor');
    assert.equal(summary.modelRequested,'gpt-5.6-sol');
    assert.equal(JSON.parse(await readFile(path.join(output,'invocation.json'))).timeoutMs,null);
    assert.equal(summary.qualityPassed, true);
    assert.equal((await readFile(path.join(output, 'events.jsonl'), 'utf8')).split('\n').length, 2);
    assert.equal(JSON.parse(await readFile(path.join(output, 'summary.json'))).actualCostUsd, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fixed Memos test adapter changes only the known Home test harness', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'memos-adapter-'));
  const source = path.join(root, '.cache/candidate-memos/web/tests/home-loading-boundary.test.tsx');
  const target = path.join(directory, 'home-loading-boundary.test.tsx');
  try {
    await writeFile(target, await readFile(source));
    await applyMemosHomeTestAdapter(target, { preserveTranslationExports: false });
    const adapted = await readFile(target, 'utf8');
    assert.equal((adapted.match(/vi.mock\("@\/hooks\/useMemoQueries"/g) ?? []).length, 0);
    assert.ok(adapted.includes('import { QueryClient, QueryClientProvider } from "@tanstack/react-query";'));
    assert.equal((adapted.match(/render\(\n      <QueryClientProvider client=\{new QueryClient\(\)\}>\n        <Home \/>\n      <\/QueryClientProvider>,\n    \);/g) ?? []).length, 3);
    await assert.rejects(applyMemosHomeTestAdapter(target), /source hash mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('revised Memos harness preserves real translation exports and original assertions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'memos-i18n-adapter-'));
  const target = path.join(directory, 'home-loading-boundary.test.tsx');
  const original = await readFile(path.join(root, '.cache/candidate-memos/web/tests/home-loading-boundary.test.tsx'), 'utf8');
  try {
    await writeFile(target, original);
    await applyMemosHomeTestAdapter(target);
    const revised = await readFile(target, 'utf8');
    assert.ok(revised.includes('...(await importOriginal<typeof import("@/utils/i18n")>()),'));
    assert.ok(revised.includes('useTranslate: () => (key: string) => key,'));
    assert.deepEqual(revised.split('\n').filter(line => line.trim().startsWith('expect(')),
      original.split('\n').filter(line => line.trim().startsWith('expect(')));
    await assert.rejects(applyMemosHomeTestAdapter(target, { preserveTranslationExports: true }), /source hash mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('HTTPie wide regression accepts only enumerated source failures', () => {
  const known = 'FAILED tests/test_output.py::TestQuietFlag::test_double_quiet_on_error - AssertionError';
  assert.equal(fullSuiteAccepted({ code: 1, timedOut: false,
    stdout: `${known}\n1 failed, 100 passed, 5 skipped` }), true);
  assert.equal(fullSuiteAccepted({ code: 1, timedOut: false,
    stdout: `${known}\nERROR tests/test_downloads.py::test_new\n1 failed, 1 error` }), false);
  assert.equal(fullSuiteAccepted({ code: 1, timedOut: false,
    stdout: 'FAILED tests/test_downloads.py::test_new\n1 failed, 100 passed' }), false);
  assert.equal(fullSuiteAccepted({ code: 0, timedOut: false, stdout: 'all passed' }), true);
});

test('Memos external verifier script preserves a failing Vitest exit code', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'memos-verifier-exit-'));
  const web = path.join(directory, 'web');
  try {
    await mkdir(path.join(web, 'node_modules/.bin'), { recursive: true });
    await mkdir(path.join(web, 'tests'));
    await writeFile(path.join(web, 'package.json'), '{}');
    const vitest = path.join(web, 'node_modules/.bin/vitest');
    await writeFile(vitest, '#!/bin/sh\nexit 7\n');
    await chmod(vitest, 0o755);
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('bash', [path.join(root, 'verifiers/run-memos-bulk-archive.sh'), directory]);
    assert.equal(result.status, 7);
    await rm(path.join(web, 'tests'), { recursive: true });
    const copyFailure = spawnSync('bash', [path.join(root, 'verifiers/run-memos-bulk-archive.sh'), directory]);
    assert.notEqual(copyFailure.status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('old task runner rejects wrong models and cleans isolated auth after executor failure',async()=>{
 const directory=await realpath(await mkdtemp(path.join(tmpdir(),'old-runner-auth-')));
 try{
  const run={task:'httpie',arm:'baseline',model:'gpt-6-sol'};
  await assert.rejects(runRealDevelopmentCase(root,run,path.join(directory,'rejected')),/model/);
  const authSource=path.join(directory,'auth.json');
  await writeFile(authSource,JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'fake-auth'},last_refresh:'2026-10-09T09:43:43.263770Z',extra:'must-not-copy'}),{mode:0o600});
  const output=path.join(directory,'probe');
  const summary=await runRealDevelopmentCase(root,{...run,model:'gpt-5.6-sol'},output,{
   authSource,agentExecute:async(_,__,options)=>{
    const auth=path.join(options.env.CODEX_HOME,'auth.json');
    assert.equal((await stat(auth)).mode&0o777,0o600);
    assert.equal(JSON.parse(await readFile(auth)).extra,undefined);
    assert.equal(JSON.parse(await readFile(auth)).last_refresh,'2026-10-09T09:43:43.263770Z');
    throw new Error('fixture executor failure');
   }
  });
  assert.equal(summary.modelInvoked,false);assert.equal(summary.usage,null);assert.equal(summary.credentialCopyRemoved,true);
  assert.match(summary.runnerError,/fixture executor failure/);
  await assert.rejects(stat(path.join(output,'codex-home/auth.json')),error=>error.code==='ENOENT');
  assert.equal(JSON.parse(await readFile(authSource)).extra,'must-not-copy');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('known automated failure cannot remain unknown in the task summary', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'known-quality-failure-'));
  try {
    const result = await runRealDevelopmentCase(root, { task: 'httpie', arm: 'baseline' }, path.join(directory, 'case'), {
      agentExecute: async () => ({ stdout: '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}\n', stderr: '', code: 0, timedOut: false, inputError: null }),
      verifier: async () => ({ automatedPassed: false, qualityPassed: null, manualStatus: 'pending' }),
    });
    assert.equal(result.executionPassed, true);
    assert.equal(result.qualityPassed, false);
    assert.equal(result.manualStatus, 'pending');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
