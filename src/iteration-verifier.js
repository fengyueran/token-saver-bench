import { fullSuiteAccepted } from './real-development-runner.js';

const routes = ['gzip-full', 'plain-resume', 'range-ignored', 'bounded-resume', 'stalled-resume', 'gzip-resume'];
const initialRoutes = ['gzip-full', 'plain-resume', 'range-ignored', 'stalled-resume'];

function executionErrors(name, check) {
  if (!check || typeof check !== 'object') return [`${name}: missing check`];
  const errors = [];
  if (![0, 1].includes(check.code)) errors.push(`${name}: unexpected exit code`);
  if (check.timedOut !== false) errors.push(`${name}: timeout or missing timeout status`);
  if (check.inputError !== null && check.inputError !== undefined)
    errors.push(`${name}: input error`);
  if (typeof check.stdout !== 'string' || typeof check.stderr !== 'string')
    errors.push(`${name}: missing raw output`);
  return errors;
}

function contractResults(check) {
  const errors = executionErrors('contract', check);
  const results = [];
  if (errors.length) return { results, errors };
  for (const [stream, text] of [['stdout', check.stdout], ['stderr', check.stderr]]) {
    for (const line of text.split(/\r?\n/)) {
      if (!/^(PASS|FAIL):/.test(line)) continue;
      const match = stream === 'stdout' ? /^PASS: ([a-z-]+)$/.exec(line) : /^FAIL: ([a-z-]+): (.+)$/.exec(line);
      if (!match || !routes.includes(match[1])) {
        errors.push('contract: malformed or unknown route record');
        continue;
      }
      results.push({ route: match[1], passed: stream === 'stdout', detail: match[2] ?? null });
    }
  }
  for (const route of routes) {
    if (results.filter((result) => result.route === route).length !== 1)
      errors.push(`contract: missing or repeated route ${route}`);
  }
  const expectedCode = results.some((result) => !result.passed) ? 1 : 0;
  if (check.code !== expectedCode) errors.push('contract: exit code contradicts route results');
  return { results, errors };
}

function pytestErrors(name, check) {
  const errors = executionErrors(name, check);
  if (errors.length) return errors;
  const text = `${check.stdout}\n${check.stderr}`;
  if (/\b[1-9]\d* errors?\b|ERROR collecting|INTERNALERROR/.test(text))
    errors.push(`${name}: pytest execution error`);
  const failed = Number(check.stdout.match(/\b(\d+) failed\b/)?.[1] ?? 0);
  const failureLines = check.stdout.split(/\r?\n/).filter((line) => line.startsWith('FAILED '));
  if (failed !== failureLines.length) errors.push(`${name}: incomplete failure summary`);
  if (!/\b[1-9]\d* (?:passed|failed|skipped|xfailed|xpassed)\b/.test(check.stdout))
    errors.push(`${name}: missing pytest summary`);
  if ((check.code === 1 && failed === 0) || (check.code === 0 && failed > 0))
    errors.push(`${name}: exit code contradicts pytest summary`);
  return errors;
}

export function summarizeIterationVerification(stage, verification) {
  if (![1, 2, 3].includes(stage)) throw new Error('Iteration stage must be 1, 2 or 3');
  const checks = verification?.checks ?? {};
  const requiredRoutes = [...initialRoutes, ...(stage >= 2 ? ['bounded-resume'] : []),
    ...(stage >= 3 ? ['gzip-resume'] : [])];
  const contract = contractResults(checks.contract);
  const verificationErrors = [...contract.errors, ...pytestErrors('downloads', checks.downloads),
    ...pytestErrors('full', checks.full)];
  const complete = verificationErrors.length === 0;
  const knownUpstreamFailuresOnly = complete ? fullSuiteAccepted(checks.full) : null;
  const automatedPassed = complete ? requiredRoutes.every((route) =>
    contract.results.find((result) => result.route === route).passed) &&
    checks.downloads.code === 0 && knownUpstreamFailuresOnly : null;
  return {
    stage, requiredRoutes, routeResults: contract.results, checks,
    verificationStatus: complete ? 'complete' : 'error', verificationErrors,
    knownUpstreamFailuresOnly, automatedPassed, qualityPassed: automatedPassed,
    manualStatus: 'not-applicable',
  };
}
