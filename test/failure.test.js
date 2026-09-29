import test from 'node:test';
import assert from 'node:assert/strict';
import { failureCategory } from '../src/failure.js';
test('provider quota stops batches but quoted task content does not', () => {
  assert.equal(
    failureCategory({
      errors: ['You’ve hit your usage limit. Try again later.'],
    }),
    'quota',
  );
  assert.equal(
    failureCategory({ errors: ['429 Too Many Requests'] }),
    'rate-limit',
  );
  assert.equal(
    failureCategory({
      answer: 'The error says usage limit',
      qualityPassed: false,
    }),
    'verification',
  );
  assert.equal(failureCategory({ timedOut: true }), 'timeout');
  assert.equal(
    failureCategory({ status: 'completed', qualityPassed: true }),
    null,
  );
});
