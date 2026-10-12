import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScenarioEvents, sumStageUsage } from '../src/scenario-events.js';

const thread = '00000000-0000-4000-8000-000000000001';
const start = { type: 'thread.started', thread_id: thread };
const end = { type: 'turn.completed', turn_id: 'turn-1', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } };
const lines = (...events) => events.map(JSON.stringify).join('\n');
test('stage events deduplicate identified terminal events and keep cache inside input', () => {
  const result = parseScenarioEvents(lines(start, end, end), thread);
  assert.equal(result.threadId, thread);
  assert.equal(result.turnId, 'turn-1');
  assert.equal(result.usage.totalTokens, 12);
  assert.equal(result.usage.uncachedInputTokens, 6);
  assert.throws(() => parseScenarioEvents(lines(start, { ...end, turn_id: undefined }, { ...end, turn_id: undefined })), /Ambiguous/);
  assert.throws(() => parseScenarioEvents(lines(start, end, { ...end, usage: { ...end.usage, input_tokens: 11 } })), /Conflicting/);
});
test('stage events reject missing or changed sessions, unknown accounting and counter errors', () => {
  assert.throws(() => parseScenarioEvents(lines(end)), /thread/);
  assert.throws(() => parseScenarioEvents(lines(start, end), '00000000-0000-4000-8000-000000000002'), /continuity/);
  assert.throws(() => parseScenarioEvents(lines(start, end), null, 'guess'), /Unsupported usage mode/);
  assert.throws(() => parseScenarioEvents(lines(start, { ...end, usage: { input_tokens: 1, cached_input_tokens: 2, output_tokens: 0 } })), /Invalid usage/);
  assert.equal(parseScenarioEvents(lines(start, { ...end, usage: undefined })).usage, null);
  assert.throws(() => parseScenarioEvents(lines(start, { ...end, usage: {
    input_tokens: Number.MAX_SAFE_INTEGER, cached_input_tokens: 0, output_tokens: 2 } })), /overflow/);
});
test('cumulative stage usage subtracts the prior session counter and preserves raw totals', () => {
  const first = parseScenarioEvents(lines(start, end), null, 'cumulative');
  const next = { ...end, turn_id: 'turn-2', usage: { input_tokens: 25, cached_input_tokens: 12, output_tokens: 7 } };
  const second = parseScenarioEvents(lines(start, next), thread, 'cumulative', first.reportedUsage);
  assert.equal(second.reportedUsage.totalTokens, 32);
  assert.equal(second.usage.totalTokens, 20);
  assert.equal(second.usage.inputTokens, 15);
  assert.equal(second.usage.cachedInputTokens, 8);
  assert.equal(sumStageUsage([first.usage, second.usage]).totalTokens, 32);
  assert.equal(parseScenarioEvents(lines(start, next), thread, 'cumulative', null).usage, null);
  assert.throws(() => parseScenarioEvents(lines(start, end), thread, 'cumulative', second.reportedUsage), /regressed/);
  const invalid = { ...end, usage: { input_tokens: 11, cached_input_tokens: 8, output_tokens: 3 } };
  assert.throws(() => parseScenarioEvents(lines(start, invalid), thread, 'cumulative', first.reportedUsage), /cached/);
});
test('partial stage totals remain null and overflow is rejected', () => {
  const usage = parseScenarioEvents(lines(start, end)).usage;
  assert.equal(sumStageUsage([usage, usage]).totalTokens, 24);
  assert.equal(sumStageUsage([usage, null]), null);
  assert.equal(sumStageUsage([]), null);
  assert.throws(() => sumStageUsage([{ ...usage, inputTokens: Number.MAX_SAFE_INTEGER }, usage]), /overflow/);
});
