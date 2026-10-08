import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCodexRun } from '../src/codex-events.js';

test('Codex usage counts cached input only inside total input', () => {
  const jsonl = [
    { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 12 } },
  ].map(JSON.stringify).join('\n');
  const result = parseCodexRun(jsonl);
  assert.equal(result.usage.totalTokens, 112);
  assert.equal(result.usage.uncachedInputTokens, 30);
  assert.equal(result.actualCostUsd, null);
  assert.equal(result.answer, 'Done');
});

test('Codex errors, missing usage, and invalid counters remain visible', () => {
  const errors = [
    { type: 'error', message: 'quota exceeded' },
    { type: 'turn.failed', error: { message: 'quota exceeded' } },
  ].map(JSON.stringify).join('\n');
  assert.deepEqual(parseCodexRun(errors).errors, ['quota exceeded']);
  assert.equal(parseCodexRun(errors).status, 'failed');
  assert.equal(parseCodexRun('{"type":"turn.completed"}').usage, null);
  assert.throws(() => parseCodexRun('{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":2,"output_tokens":1}}'), /usage/);
});
