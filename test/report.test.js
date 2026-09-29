import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCampaign } from '../src/report.js';

const row = (arm, task, repeat, totalTokens, qualityPassed = true) => ({
  arm,
  task,
  repeat,
  usage: totalTokens === null ? null : { totalTokens },
  qualityPassed,
  executionPassed: true,
  activation: { status: arm === 'baseline' ? 'not-applicable' : 'observed' },
});
test('report pairs by task and repetition, retains failures and missing usage', () => {
  const rows = [
    row('baseline', 'a', 0, 100),
    row('rtk', 'a', 0, 80),
    row('baseline', 'a', 1, 200),
    row('rtk', 'a', 1, 300, false),
    row('baseline', 'a', 2, 100),
    row('rtk', 'a', 2, null),
    row('rtk', 'b', 0, 10),
  ];
  const result = summarizeCampaign(rows, ['baseline', 'rtk']);
  const rtk = result.arms.find((arm) => arm.arm === 'rtk');
  assert.equal(rtk.runs, 4);
  assert.equal(rtk.qualityPassed, 3);
  assert.equal(rtk.pairedKnownUsage, 2);
  assert.equal(rtk.medianTotalTokenChangePercent, 15);
  assert.equal(rtk.missingUsage, 1);
  assert.equal(rtk.unpaired, 1);
  assert.equal(rtk.actualCostUsd, null);
});
test('no activation is reported, never silently removed', () => {
  const r = {
    ...row('rtk', 'a', 0, 50),
    activation: { status: 'not-observed' },
  };
  const result = summarizeCampaign(
    [row('baseline', 'a', 0, 100), r],
    ['baseline', 'rtk'],
  );
  assert.equal(result.arms[1].activationNotObserved, 1);
  assert.equal(result.arms[1].pairedKnownUsage, 1);
});
test('duplicate cells are rejected rather than selecting a favorable rerun', () => {
  assert.throws(
    () =>
      summarizeCampaign(
        [row('baseline', 'a', 0, 100), row('baseline', 'a', 0, 90)],
        ['baseline'],
      ),
    /Duplicate/,
  );
});
