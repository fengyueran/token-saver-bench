import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const binary = path.join(root, 'bin/real-development.js');
test('live calibration CLI rejects missing or uncalibrated arms before dispatch', () => {
  for (const args of [['scenario-calibrate'], ['scenario-calibrate', 'httpie-iteration', 'rtk'],
    ['scenario-calibrate', 'httpie-diagnosis', 'baseline', 'extra']]) {
    assert.throws(() => execFileSync(process.execPath, [binary, ...args], { encoding: 'utf8', stdio: 'pipe' }),
      /Calibration requires|Unsupported live scenario arm/);
  }
});
test('scenario CLI previews candidates and runs an explicitly synthetic diagnosis', async () => {
  const plan = JSON.parse(execFileSync(process.execPath, [binary, 'scenario-plan'], { encoding: 'utf8' }));
  assert.equal(plan.formalReady, false);
  assert.equal(plan.scenarios.length, 2);
  const result = JSON.parse(execFileSync(process.execPath, [binary, 'scenario-check'], { encoding: 'utf8', timeout: 30000 }));
  assert.equal(result.mode, 'offline-simulation');
  assert.equal(result.modelInvoked, false);
  assert.equal(result.usage, null);
  assert.equal(result.actualCostUsd, null);
  assert.equal(result.qualityPassed, null);
  assert.ok(result.output.startsWith(path.join(root, 'runs/scenario-offline-')));
  try {
    const stored = JSON.parse(await readFile(path.join(result.output, 'summary.json')));
    assert.equal(stored.stages[0].manualStatus, 'pending');
    assert.ok(stored.stages[0].syntheticUsage);
  } finally { await rm(result.output, { recursive: true, force: true }); }
});
