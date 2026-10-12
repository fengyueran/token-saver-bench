import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simulateScenario, buildScenarioArgs, scenarioPlan } from '../src/scenario-runner.js';

const root = new URL('../', import.meta.url).pathname;
const thread = '00000000-0000-4000-8000-000000000001';
function eventResult(stage, options = {}) {
  const events = [{ type: 'thread.started', thread_id: options.thread ?? thread },
    { type: 'item.completed', item: { type: 'agent_message', text: `synthetic stage ${stage}` } },
    { type: 'turn.completed', turn_id: `turn-${stage}`, usage: options.missingUsage ? undefined :
      { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } }];
  return { code: 0, timedOut: false, inputError: null, stdout: events.map(JSON.stringify).join('\n'), stderr: '', ...options };
}
const verification = (passed = true) => ({ verificationStatus: 'complete', qualityPassed: passed, manualStatus: 'not-applicable' });
async function inRun(fn) {
  const directory = await mkdtemp(path.join(tmpdir(), 'scenario-test-'));
  try { await fn(path.join(directory, 'run')); } finally { await rm(directory, { recursive: true, force: true }); }
}
test('scenario plan is separate from formal schedule and resume uses explicit session', () => {
  const plan = scenarioPlan();
  assert.equal(plan.formalReady, false);
  assert.equal(plan.scenarios.length, 2);
  const first = buildScenarioArgs('/tmp/scenario', 'httpie-iteration', 'baseline');
  assert.ok(!first.includes('--ephemeral'));
  const resume = buildScenarioArgs('/tmp/scenario', 'httpie-iteration', 'baseline', thread);
  assert.deepEqual(resume.slice(-3), ['resume', thread, '-']);
  assert.ok(!resume.includes('--last'));
  const luna = buildScenarioArgs('/tmp/scenario', 'httpie-iteration', 'baseline', thread, '', 'gpt-5.6-luna');
  assert.equal(luna[luna.indexOf('--model') + 1], 'gpt-5.6-luna');
  const sol = buildScenarioArgs('/tmp/scenario', 'httpie-iteration', 'baseline', thread, '', 'gpt-5.6-sol');
  assert.equal(sol[sol.indexOf('--model') + 1], 'gpt-5.6-sol');
  assert.deepEqual(luna.slice(-3), ['resume', thread, '-']);
  assert.throws(() => buildScenarioArgs('/tmp/scenario', 'httpie-iteration', 'baseline', null, '', 'other'), /model/);
  const diagnosis = buildScenarioArgs('/tmp/scenario', 'httpie-diagnosis', 'baseline');
  assert.equal(diagnosis[diagnosis.indexOf('--sandbox') + 1], 'read-only');
  assert.throws(() => buildScenarioArgs('/tmp/scenario', 'httpie-iteration', 'headroom'), /not calibrated/);
});
test('three stages share workspace and session, preserve snapshots and exclude hidden feedback', async () => inRun(async (output) => {
  const calls = [];
  const statePaths = [];
  const result = await simulateScenario(root, { scenario: 'httpie-iteration', arm: 'baseline' }, output, {
    agentExecute: async (_binary, args, options) => {
      const stage = calls.length + 1;
      assert.equal(options.input, await readFile(path.join(root, `prompts/httpie-download-iteration-stage-${stage}.txt`), 'utf8'));
      if (stage > 1) assert.deepEqual(args.slice(-3), ['resume', thread, '-']);
      assert.ok(!options.input.includes('HIDDEN-FAILURE'));
      assert.equal(options.env.CODEX_HOME, path.join(output, 'codex-home'));
      assert.ok(!options.env.CODEX_HOME.startsWith(options.cwd + path.sep));
      assert.equal((await stat(options.env.CODEX_HOME)).mode & 0o777, 0o700);
      statePaths.push(options.env.CODEX_HOME);
      calls.push(options.cwd);
      await writeFile(path.join(options.cwd, 'httpie/synthetic-sentinel.txt'), `stage ${stage}`);
      return eventResult(stage, { missingUsage: stage === 2 });
    },
    verifier: async (_root, _stage, snapshot) => {
      assert.ok((await stat(path.join(snapshot, 'httpie/synthetic-sentinel.txt'))).isFile());
      return { ...verification(false), hiddenDetail: 'HIDDEN-FAILURE' };
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls).size, 1);
  assert.equal(new Set(statePaths).size, 1);
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json')));
  assert.equal(manifest.sessionState.path, statePaths[0]);
  assert.equal(manifest.sessionState.authProvisioned, false);
  assert.equal(result.status, 'completed');
  assert.equal(result.stages[0].qualityPassed, false);
  assert.equal(result.usage, null);
  assert.equal(result.syntheticUsage, null);
  assert.equal(result.stages[0].syntheticUsage.totalTokens, 12);
  assert.equal(result.stages[1].syntheticUsage, null);
  assert.equal(await readFile(path.join(output, 'stage-1/snapshot/httpie/synthetic-sentinel.txt'), 'utf8'), 'stage 1');
  assert.equal(await readFile(path.join(output, 'stage-3/snapshot/httpie/synthetic-sentinel.txt'), 'utf8'), 'stage 3');
}));
test('session drift and stage timeout stop later stages and retain partial evidence', async () => {
  for (const mode of ['thread', 'timeout', 'quota', 'quota-completed', 'rate-limit-completed', 'duplicate-turn', 'snapshot-mutation']) await inRun(async (output) => {
    let calls = 0;
    const result = await simulateScenario(root, { scenario: 'httpie-iteration', arm: 'baseline' }, output, {
      agentExecute: async () => {
        calls += 1;
        if (mode === 'timeout') return eventResult(calls, { timedOut: true });
        if (mode === 'quota') return { ...eventResult(calls), code: 1, stdout: JSON.stringify({ type: 'thread.started', thread_id: thread }) + '\n' + JSON.stringify({ type: 'turn.failed', error: { message: 'quota exceeded' } }) };
        if (mode.endsWith('-completed')) {
          const result = eventResult(calls);
          return { ...result, stdout: JSON.stringify({ type: 'error', message: mode === 'quota-completed' ? 'quota exceeded' : '429 too many requests' }) + '\n' + result.stdout };
        }
        return eventResult(mode === 'duplicate-turn' ? 1 : calls, { thread: calls === 2 && mode === 'thread' ? '00000000-0000-4000-8000-000000000002' : thread });
      },
      verifier: async (_root, _stage, snapshot) => {
        if (mode === 'snapshot-mutation') await writeFile(path.join(snapshot, 'httpie/new-file.txt'), 'changed');
        return verification();
      },
    });
    assert.equal(result.status, 'stopped');
    assert.equal(calls, ['thread', 'duplicate-turn'].includes(mode) ? 2 : 1,
      JSON.stringify({ mode, stages: result.stages.map(({ status, runnerError }) => ({ status, runnerError })) }));
    assert.equal(result.stages.at(-1).status, 'not-run');
    assert.ok((await stat(path.join(output, 'stage-1/events.jsonl'))).isFile());
    assert.ok((await stat(path.join(output, 'stage-1/snapshot/httpie/downloads.py'))).isFile());
    if (mode === 'timeout') {
      assert.equal(result.stages[0].status, 'timeout');
      assert.equal(result.stages[0].syntheticUsage.totalTokens, 12);
      assert.equal(result.stages[0].threadId, thread);
      assert.equal(result.stages[0].executionPassed, false);
    }
    if (mode === 'snapshot-mutation') assert.equal(JSON.parse(await readFile(path.join(output, 'stage-1/verification.json'))).qualityPassed, true);
  });
});

test('state permission drift stops before another stage is dispatched', async () => inRun(async (output) => {
  let calls = 0;
  const result = await simulateScenario(root, { scenario: 'httpie-iteration', arm: 'baseline' }, output, {
    agentExecute: async () => eventResult(++calls),
    verifier: async () => {
      await chmod(path.join(output, 'codex-home'), 0o755);
      return verification();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'stopped');
  assert.match(result.stages[1].runnerError, /private directory/);
  assert.equal(result.stages[2].status, 'not-run');
  assert.equal(result.usage, null);
}));

test('iteration preserves durations beyond former stage and total limits without timing out', async () => inRun(async (output) => {
  let tick = 0;
  let calls = 0;
  const result = await simulateScenario(root, { scenario: 'httpie-iteration', arm: 'baseline' }, output, {
    now: () => tick,
    agentExecute: async (_binary, _args, options) => {
      assert.equal(options.timeoutMs, null);
      calls += 1; tick += 600001; return eventResult(calls);
    },
    verifier: async () => verification(),
  });
  assert.equal(calls, 3, JSON.stringify({status: result.status, failureCategory: result.failureCategory, stages: result.stages}));
  assert.equal(result.stages[0].agentDurationMs, 600001);
  assert.equal(result.status, 'completed');
  assert.equal(result.stages[0].timedOut, false);
  assert.equal(result.agentDurationMs, 1800003);
}));
test('diagnosis detects new business files, stays pending on manual quality and cannot launch without simulator', async () => {
  await inRun(async (output) => {
    const result = await simulateScenario(root, { scenario: 'httpie-diagnosis', arm: 'caveman' }, output, {
      agentExecute: async (_binary, args, options) => {
        assert.ok(args.some((arg) => arg.startsWith('developer_instructions=')));
        await writeFile(path.join(options.cwd, 'httpie/new-file.txt'), 'changed');
        return eventResult(1);
      },
    });
    assert.equal(result.stages[0].sourceUnchanged, false);
    assert.equal(result.stages[0].qualityPassed, false);
  });
  await inRun(async (output) => {
    const result = await simulateScenario(root, { scenario: 'httpie-diagnosis', arm: 'baseline' }, output,
      { agentExecute: async (_binary, _args, options) => {
        await writeFile(path.join(options.cwd, '.cache/synthetic space.txt'), 'runtime cache');
        return eventResult(1);
      } });
    assert.equal(result.stages[0].sourceUnchanged, true);
    assert.equal(result.stages[0].qualityPassed, null);
    assert.equal(result.stages[0].manualStatus, 'pending');
  });
  await inRun(async (output) => {
    await assert.rejects(simulateScenario(root, { scenario: 'httpie-iteration', arm: 'baseline' }, output), /simulator required/);
    await assert.rejects(stat(output), /ENOENT/);
  });
});
