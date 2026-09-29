import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSchedule,
  parseCodexRun,
  validateExperiment,
  codexArgs,
} from '../src/core.js';

const config = JSON.parse(
  await readFile(new URL('../config/experiment.json', import.meta.url), 'utf8'),
);

test('provider errors and global skill contamination remain visible in reports', () => {
  const events = [
    {
      type: 'item.completed',
      item: { type: 'error', message: 'Exceeded skills context budget' },
    },
    { type: 'error', message: 'model not supported' },
    { type: 'turn.failed', error: { message: 'model not supported' } },
  ];
  const result = parseCodexRun(events.map(JSON.stringify).join('\n'));
  assert.deepEqual(result.errors, [
    'Exceeded skills context budget',
    'model not supported',
  ]);
  assert.equal(result.status, 'failed');
});

test('six arms and six tasks repeated three times produce 108 paired runs', () => {
  const before = JSON.stringify(config);
  const plan = createSchedule(config);
  assert.equal(plan.length, 108);
  assert.equal(new Set(plan.map((row) => row.id)).size, 108);
  for (const task of config.tasks) {
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const block = plan.filter(
        (row) => row.task === task.id && row.repeat === repeat,
      );
      assert.equal(block.length, 6);
      assert.equal(block.filter((row) => row.arm === 'baseline').length, 1);
    }
  }
  assert.notEqual(plan[0].arm, plan[6].arm);
  assert.equal(JSON.stringify(config), before);
});

test('reject missing model, duplicate arms, traversal names and invalid repetitions', () => {
  assert.throws(() => validateExperiment({ ...config, model: '' }), /model/);
  assert.throws(
    () => validateExperiment({ ...config, repetitions: 0 }),
    /repetitions/,
  );
  assert.throws(
    () =>
      validateExperiment({ ...config, arms: [config.arms[0], config.arms[0]] }),
    /duplicate/,
  );
  assert.throws(
    () => validateExperiment({ ...config, id: '../outside' }),
    /id/,
  );
});

test('cached input is a subset of input, not an extra token charge', () => {
  const result = parseCodexRun(
    [
      { type: 'thread.started', thread_id: 'test-thread' },
      {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'READY' },
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 100,
          cached_input_tokens: 70,
          output_tokens: 12,
        },
      },
    ]
      .map(JSON.stringify)
      .join('\n'),
  );
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.usage, {
    inputTokens: 100,
    cachedInputTokens: 70,
    uncachedInputTokens: 30,
    outputTokens: 12,
    totalTokens: 112,
    reasoningTokens: null,
  });
  assert.equal(result.actualCostUsd, null);
  assert.equal(result.answer, 'READY');
});

test('missing usage remains unknown, and incomplete or failed runs cannot pass', () => {
  assert.equal(parseCodexRun('').status, 'incomplete');
  assert.equal(
    parseCodexRun('{"type":"turn.failed","error":{"message":"failure"}}')
      .status,
    'failed',
  );
  const result = parseCodexRun('{"type":"turn.completed"}');
  assert.equal(result.usage, null);
  assert.equal(result.actualCostUsd, null);
  assert.throws(() => parseCodexRun('not json'), /JSONL/);
});

test('multiple completed turns aggregate once per turn', () => {
  const event = JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 3 },
  });
  assert.equal(parseCodexRun(`${event}\n${event}`).usage.totalTokens, 26);
});

test('invalid counters fail instead of creating artificial savings', () => {
  assert.throws(
    () =>
      parseCodexRun(
        JSON.stringify({
          type: 'turn.completed',
          usage: {
            input_tokens: 10,
            cached_input_tokens: 20,
            output_tokens: 3,
          },
        }),
      ),
    /usage/,
  );
});

test('CLI invocation pins model and effort, disables ambient configuration and uses no shell', () => {
  const args = codexArgs(config, '/tmp/path with spaces');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-sol');
  assert.ok(args.includes('model_reasoning_effort="medium"'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('project_doc_max_bytes=0'));
  assert.ok(args.includes('skills.include_instructions=false'));
  assert.ok(args.includes('features.plugins=false'));
  assert.ok(args.includes('/tmp/path with spaces'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});
