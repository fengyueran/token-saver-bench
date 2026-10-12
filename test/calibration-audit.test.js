import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCalibrationSession } from '../src/calibration-audit.js';

const thread = '00000000-0000-4000-8000-000000000001';
const counters = (input, cache, output) => ({ input_tokens: input, cached_input_tokens: cache, output_tokens: output });
const log = (usage, extra = []) => [
  { type: 'session_meta', payload: { id: thread } },
  { type: 'turn_context', payload: { model: 'gpt-6-sol', effort: 'medium' } },
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage } } }, ...extra,
].map(JSON.stringify).join('\n');
test('calibration audit distinguishes per-turn and cumulative counters without billing inference', () => {
  const previous = counters(100, 40, 20);
  const total = counters(160, 70, 30);
  const result = auditCalibrationSession(log(total), thread, counters(60, 30, 10), previous);
  assert.equal(result.sessionModelMatches, true);
  assert.equal(result.usageMode, 'per-turn');
  assert.deepEqual(result.stageUsage, counters(60, 30, 10));
  assert.equal(result.actualCostUsd, null);
  assert.equal(auditCalibrationSession(log(total), thread, total, previous).usageMode, 'cumulative');
  assert.equal(auditCalibrationSession(log(total), thread, total).usageMode, 'initial-undetermined');
  const luna = log(total).replace('gpt-6-sol', 'gpt-5.6-luna');
  assert.equal(auditCalibrationSession(luna, thread, total).sessionModelMatches, false);
  assert.equal(auditCalibrationSession(luna, thread, total, null, 'gpt-5.6-luna').sessionModelMatches, true);
  const sol = log(total).replace('gpt-6-sol', 'gpt-5.6-sol');
  assert.equal(auditCalibrationSession(sol, thread, total, null, 'gpt-5.6-sol').sessionModelMatches, true);
  assert.equal(auditCalibrationSession(luna, thread, total, null, 'gpt-5.6-sol').sessionModelMatches, false);
  assert.throws(() => auditCalibrationSession(luna, thread, total, null, 'other'), /model/);
});
test('calibration audit fails closed on missing, drifting or inconsistent evidence', () => {
  const total = counters(160, 70, 30);
  assert.throws(() => auditCalibrationSession(log(total), 'other-thread', total), /session/);
  assert.throws(() => auditCalibrationSession(log(total), thread, total, counters(200, 0, 0)), /regressed/);
  assert.throws(() => auditCalibrationSession(log(counters(5, 6, 1)), thread, total), /counter/);
  assert.throws(() => auditCalibrationSession(log(counters(101, 50, 21)), thread,
    counters(1, 0, 1), counters(100, 40, 20)), /counter/);
  assert.equal(auditCalibrationSession(log(total), thread, counters(1, 0, 1)).usageMode, 'mismatch');
  assert.equal(auditCalibrationSession(log(total), thread, null).stageUsage, null);
  const changed = log(total, [{ type: 'turn_context', payload: { model: 'other', effort: 'medium' } }]);
  assert.equal(auditCalibrationSession(changed, thread, total).sessionModelMatches, false);
  assert.equal(auditCalibrationSession(log(total).replace('"medium"', '"high"'), thread, total).sessionModelMatches, false);
  assert.equal(auditCalibrationSession(log(total).replace('token_count', 'other'), thread, total).usageMode, 'missing');
});

test('a completed CLI response requires matching native counters before execution acceptance', async () => {
  const { assertCalibrationAudit } = await import('../src/calibration-audit.js');
  const total = counters(160, 70, 30);
  assert.doesNotThrow(() => assertCalibrationAudit(auditCalibrationSession(log(total), thread, total)));
  for (const audit of [
    auditCalibrationSession(log(total).replace('token_count', 'other'), thread, total),
    auditCalibrationSession(log(total), thread, counters(1, 0, 1)),
    auditCalibrationSession(log(total).replace('"medium"', '"high"'), thread, total),
  ]) assert.throws(() => assertCalibrationAudit(audit), /audit/);
});
