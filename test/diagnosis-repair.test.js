import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDiagnosisRepairArgs, summarizeDiagnosisRepair, reconcileDiagnosisRepairUsage, prepareDiagnosisRepairState } from '../src/diagnosis-repair.js';

const thread = '01a12108-85c3-7753-bb1d-0d690d82a63c';
test('resume state materializes only a frozen history and never copies absolute-path databases', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'repair-state-'));
  try {
    const source = path.join(root, 'session.jsonl'), state = path.join(root, 'child');
    const content = JSON.stringify({ type: 'session_meta', payload: { id: thread, timestamp: '2026-10-09T22:19:34.000Z' } }) + '\n';
    await writeFile(source, content);
    await writeFile(path.join(root, 'state_5.sqlite'), 'absolute original rollout paths');
    const prepared = await prepareDiagnosisRepairState(source, state, thread);
    assert.deepEqual(await readdir(state), ['sessions']);
    assert.equal(await readFile(prepared.sessionPath, 'utf8'), content);
    assert.equal((await stat(state)).mode & 0o777, 0o700);
    await assert.rejects(prepareDiagnosisRepairState(source, state, thread), /EEXIST/);
    await assert.rejects(prepareDiagnosisRepairState(source, path.join(root, 'wrong'), '00000000-0000-4000-8000-000000000001'), /identity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
const parentArgs = ['exec', '--json', '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="medium"',
  '-c', 'developer_instructions="Fixed original instructions"', '-c', 'mcp_servers.codegraph.args=["serve","--path","/parent/workspace"]',
  '--sandbox', 'read-only', '--cd', '/parent/workspace', '-'];
test('repair resumes the original session in a separate writable copy and preserves frozen instructions', () => {
  const before = [...parentArgs];
  const args = buildDiagnosisRepairArgs(parentArgs, '/parent', '/child', thread);
  assert.deepEqual(args.slice(-3), ['resume', thread, '-']);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.equal(args[args.indexOf('--cd') + 1], '/child/workspace');
  assert.ok(args.includes('developer_instructions="Fixed original instructions"'));
  assert.ok(args.some(x => x.includes('"/child/workspace"')));
  assert.deepEqual(parentArgs, before);
});
test('repair refuses changed models, effort, unsafe paths and a mismatched parent workspace', () => {
  assert.throws(() => buildDiagnosisRepairArgs(parentArgs.map(x => x === 'gpt-5.6-sol' ? 'gpt-5.6-luna' : x), '/parent', '/child', thread));
  assert.throws(() => buildDiagnosisRepairArgs(parentArgs.map(x => x === 'model_reasoning_effort="medium"' ? 'model_reasoning_effort="high"' : x), '/parent', '/child', thread));
  for (const child of ['/parent', '/parent/nested', '/other/../parent', 'relative'])
    assert.throws(() => buildDiagnosisRepairArgs(parentArgs, '/parent', child, thread));
  assert.throws(() => buildDiagnosisRepairArgs(parentArgs, '/different', '/child', thread));
  assert.throws(() => buildDiagnosisRepairArgs(parentArgs, '/parent', '/child', '--last'));
});
const usage = { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2, totalTokens: 12 };
test('resume accounting detects reported counter mode from native evidence and rejects model drift', () => {
  const counters = (input, cache, output) => ({ input_tokens: input, cached_input_tokens: cache, output_tokens: output });
  const previous = counters(100, 40, 20), total = counters(160, 70, 30);
  const session = [
    { type: 'session_meta', payload: { id: thread } },
    { type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'medium' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total } } },
  ].map(JSON.stringify).join('\n');
  const events = reported => [
    { type: 'thread.started', thread_id: thread },
    { type: 'turn.completed', usage: reported },
  ].map(JSON.stringify).join('\n');
  const perTurn = reconcileDiagnosisRepairUsage(events(counters(60, 30, 10)), session, thread, previous);
  const cumulative = reconcileDiagnosisRepairUsage(events(total), session, thread, previous);
  assert.equal(perTurn.audit.usageMode, 'per-turn');
  assert.equal(cumulative.audit.usageMode, 'cumulative');
  assert.deepEqual(perTurn.parsed.usage, cumulative.parsed.usage);
  assert.equal(perTurn.parsed.usage.totalTokens, 70);
  assert.equal(perTurn.parsed.usage.uncachedInputTokens, 30);
  assert.throws(() => reconcileDiagnosisRepairUsage(events(total), session.replace('gpt-5.6-sol', 'gpt-5.6-luna'), thread, previous), /audit/);
  assert.throws(() => reconcileDiagnosisRepairUsage(events(counters(1, 0, 1)), session, thread, previous), /audit/);
  assert.throws(() => reconcileDiagnosisRepairUsage(events(total), session, thread, null), /prior/);
});
test('whole-work cost includes diagnosis and each repair round while keeping the old diagnosis grade', () => {
  const parent = { quality: false, usage, agentDurationMs: 100 };
  const rounds = [{ index: 0, quality: false, usage, agentDurationMs: 200 }, { index: 1, quality: true, usage, agentDurationMs: 300 }];
  const result = summarizeDiagnosisRepair(parent, rounds);
  assert.equal(result.diagnosisQuality, false);
  assert.equal(result.repair.finalQuality, true);
  assert.equal(result.fullWorkflowUsage.totalTokens, 36);
  assert.equal(result.fullWorkflowUsage.uncachedInputTokens, 18);
  assert.equal(result.fullWorkflowAgentDurationMs, 600);
  assert.equal(result.humanInterventionMs, null);
  assert.equal(summarizeDiagnosisRepair({ ...parent, usage: null }, rounds).fullWorkflowUsage, null);
  assert.deepEqual(parent, { quality: false, usage, agentDurationMs: 100 });
});
