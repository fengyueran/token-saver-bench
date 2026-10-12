import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeIterationVerification } from '../src/iteration-verifier.js';

const routes = ['gzip-full', 'plain-resume', 'range-ignored', 'bounded-resume', 'stalled-resume', 'gzip-resume'];
const check = (stdout = '32 passed', code = 0, stderr = '') =>
  ({ stdout, stderr, code, timedOut: false, inputError: null });
function verification(failed = []) {
  return { checks: {
    contract: check(routes.filter((route) => !failed.includes(route)).map((route) => `PASS: ${route}`).join('\n'),
      failed.length ? 1 : 0, failed.map((route) => `FAIL: ${route}: output differs`).join('\n')),
    downloads: check(), full: check('1027 passed'),
  } };
}

test('stages require cumulative routes and retain future failures and original logs', () => {
  const input = verification(['bounded-resume', 'gzip-resume']);
  const result = summarizeIterationVerification(1, input);
  assert.equal(result.verificationStatus, 'complete');
  assert.equal(result.qualityPassed, true);
  assert.equal(result.manualStatus, 'not-applicable');
  assert.deepEqual(result.requiredRoutes, ['gzip-full', 'plain-resume', 'range-ignored', 'stalled-resume']);
  assert.equal(result.routeResults.length, 6);
  assert.equal(result.routeResults.find(({ route }) => route === 'bounded-resume').passed, false);
  assert.deepEqual(result.checks, input.checks);
  assert.equal(summarizeIterationVerification(2, input).qualityPassed, false);
  assert.equal(summarizeIterationVerification(2, verification(['gzip-resume'])).qualityPassed, true);
  assert.equal(summarizeIterationVerification(3, verification(['gzip-resume'])).qualityPassed, false);
  assert.equal(summarizeIterationVerification(3, verification()).qualityPassed, true);
});

test('missing, duplicate, conflicting, malformed or unknown contract records are errors', () => {
  for (const mutate of [
    (c) => { c.stdout = c.stdout.replace('PASS: gzip-full', ''); },
    (c) => { c.stdout += '\nPASS: gzip-full'; },
    (c) => { c.stderr = 'FAIL: gzip-full: conflict'; c.code = 1; },
    (c) => { c.stdout += '\nPASS: invented-route'; },
    (c) => { c.stdout += '\nPASS: gzip-full trailing'; },
    (c) => { c.stdout += '\nFAIL: gzip-full: wrong stream'; },
    (c) => { c.stderr += '\nPASS: gzip-full'; },
    (c) => { c.code = 1; },
    (c) => { c.code = 2; },
  ]) {
    const input = verification(); mutate(input.checks.contract);
    const result = summarizeIterationVerification(1, input);
    assert.equal(result.verificationStatus, 'error');
    assert.equal(result.qualityPassed, null);
    assert.equal(result.automatedPassed, null);
    assert.ok(result.verificationErrors.length > 0);
    assert.deepEqual(result.checks, input.checks);
  }
  const input = verification(['gzip-full']); input.checks.contract.code = 0;
  assert.equal(summarizeIterationVerification(1, input).qualityPassed, null);
});

test('all checks reject timeout, input errors, unexpected exits and pytest execution errors', () => {
  for (const name of ['contract', 'downloads', 'full']) {
    for (const patch of [{ timedOut: true }, { inputError: 'spawn failed' }, { code: null }, { code: 5 }]) {
      const input = verification(); Object.assign(input.checks[name], patch);
      assert.equal(summarizeIterationVerification(3, input).verificationStatus, 'error');
    }
  }
  for (const name of ['downloads', 'full']) {
    for (const output of ['1 error during collection', '1 failed, 1 error', 'nothing ran', '2 failed\nFAILED tests/example.py::one']) {
      const input = verification(); input.checks[name] = check(output, 1);
      assert.equal(summarizeIterationVerification(3, input).qualityPassed, null);
    }
    const input = verification(); input.checks[name] = check('no pytest summary');
    assert.equal(summarizeIterationVerification(3, input).qualityPassed, null);
  }
  assert.equal(summarizeIterationVerification(1, { checks: {} }).qualityPassed, null);
});

test('real pytest failures fail quality while the frozen upstream failure set is accepted', () => {
  const input = verification();
  input.checks.downloads = check('FAILED tests/test_downloads.py::test_regression\n1 failed, 31 passed', 1);
  assert.equal(summarizeIterationVerification(1, input).verificationStatus, 'complete');
  assert.equal(summarizeIterationVerification(1, input).qualityPassed, false);
  input.checks.downloads = check();
  input.checks.full = check('FAILED tests/test_output.py::TestQuietFlag::test_double_quiet_on_error\n1 failed, 1026 passed', 1);
  assert.equal(summarizeIterationVerification(3, input).qualityPassed, true);
  input.checks.full = check('FAILED tests/test_downloads.py::test_regression\n1 failed, 1026 passed', 1);
  assert.equal(summarizeIterationVerification(3, input).qualityPassed, false);
});

test('invalid stages are rejected and input is not mutated', () => {
  for (const stage of [0, 4, '1', null]) {
    assert.throws(() => summarizeIterationVerification(stage, verification()), /stage/i);
  }
  const input = verification(); const original = structuredClone(input);
  summarizeIterationVerification(1, input);
  assert.deepEqual(input, original);
});
